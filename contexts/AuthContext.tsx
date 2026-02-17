import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase, ensureFreshSession } from '../services/db';
import { SubscriptionService } from '../services/subscription';
import { StorageService } from '../services/storage';
import type { PractitionerProfile, UserProfile, BrandingConfig } from '../types';
import { unwrapKey, wrapKey, generateSymetricKey } from '../utils/crypto'; 
import { Logger } from '../utils/logger';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

type AuthState = 'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated' | 'subscription_locked' | 'network_error' | 'error';

interface AuthContextType {
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  sessionKey: CryptoKey | null; // MasterKey (PIN)
  orgKey: CryptoKey | null; // NOUVEAU: Clé du cabinet déchiffrée
  orgId: string | null; // Organization ID for filtering
  // Ajout de 'subscription_locked' : Utilisateur reconnu mais sans droits d'accès valides
    authState: AuthState;
  isLoading: boolean;
  tempEmail: string | null;
  isDemoMode: boolean; // NOUVEAU : Flag UI
  
  refreshProfile: () => Promise<void>;
    reloadUserFromSession: () => Promise<AuthState | null>;
  setSessionKey: (key: CryptoKey | null) => void;
  unlockSession: (key: CryptoKey) => Promise<void>; 
  lockSession: () => void;
  logout: () => void;
  updateUserProfile: (update: Partial<UserProfile>) => void;
  setOrgKey: (key: CryptoKey | null) => void; 
  startDemo: () => Promise<void>; // NOUVEAU : Entrée en mode démo
  verifyAdminAccess: () => Promise<boolean>; // NOUVEAU : Vérification serveur
  setWizardActive: (active: boolean) => void; // Lock pour empêcher loadUser pendant le wizard
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_BRANDING: BrandingConfig = {
    isEnabled: false,
    primaryColor: '#3D405B',
    secondaryColor: '#E07A5F',
    fontFamily: 'Merriweather',
    headerTemplate: 'classic',
    titleStyle: 'simple',
    headerLayout: 'row',
    headerAlignment: 'left',
    logoSize: 'medium',
    cornerStyle: 'rounded',
    cabinetName: "Cabinet d'Ergothérapie",
    brandSubtitle: "",
    documentTitle: "Bilan d'Ergothérapie",
    patientBlockStyle: 'modern',
    practitionerName: "",
    address: "",
    siret: "",
    footerText: "Document confidentiel - Bilan Ergothérapique",
    showPageNumbers: true
};

const INITIAL_PROFILE: UserProfile = {
    id: '', email: '', credits: 0, subscriptionPlan: 'free', status: 'active',
    totalBilansGenerated: 0, hasAcceptedResponsibility: false, isAdmin: false,
    isTrial: false, trialDaysRemaining: 0, branding: DEFAULT_BRANDING
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [practitioner, setPractitioner] = useState<PractitionerProfile | null>(null);
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null);
  const [orgKey, setOrgKey] = useState<CryptoKey | null>(null); 
  const [orgId, setOrgId] = useState<string | null>(null); 
    const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [isLoading, setIsLoading] = useState(true);
  const [tempEmail, setTempEmail] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // MUTEX & REFS : Empêche loadUser de tourner en double et résout le Stale Closure
  const isLoadingProfileRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
  const wizardActiveRef = useRef(false);
  const initCompleteRef = useRef(false);
  const isInitializingRef = useRef(false); // Synchronous guard against duplicate loadUser from StrictMode
  const refreshInFlightRef = useRef(false);

  const setWizardActive = (active: boolean) => {
      wizardActiveRef.current = active;
      Logger.info('AUTH', `Wizard active lock: ${active}`);
  };

  const withTimeout = async <T,>(promise: PromiseLike<T>, ms: number): Promise<{ timedOut: boolean; value?: T }> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
      });
      try {
          const value = await Promise.race([promise, timeout]);
          return { timedOut: false, value: value as T };
      } catch (e) {
          if (e instanceof Error && e.message === 'TIMEOUT') {
              return { timedOut: true };
          }
          throw e;
      } finally {
          if (timer) clearTimeout(timer);
      }
  };

  const forceLogout = async (reason: string) => {
      Logger.warn('AUTH', `Forcing logout: ${reason}`);
      handleLocalLogout();
      try {
          await supabase.auth.signOut();
      } catch (e) {
          Logger.warn('AUTH', 'SignOut failed during forced logout', e);
      }
  };

  const refreshSessionIfNeeded = async (reason: string, forceRefresh = false) => {
      if (isDemoMode || authState === 'unauthenticated') return;
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
          const { session, refreshed, error } = await ensureFreshSession({ forceRefresh });
          if (error) {
              Logger.warn('AUTH', `Session refresh failed (${reason})`, error);
          } else if (refreshed) {
              Logger.debug('AUTH', `Session refreshed (${reason})`, session?.user?.id);
          }
      } finally {
          refreshInFlightRef.current = false;
      }
  };

  // ─── SINGLE AUTH INITIALIZATION ───────────────────────────────────
  // ONE effect does everything: check local session → loadUser → done.
  // onAuthStateChange only handles subsequent events (login, logout, token refresh).
  // No network call (getUser) on the init path — trust the local JWT.
  // Supabase auto-refreshes expired tokens via autoRefreshToken: true.
  useEffect(() => {
    Logger.info('AUTH', 'Initializing Auth...');
    let cancelled = false; // React strict-mode guard
    isInitializingRef.current = true; // Synchronous flag — set BEFORE any async work

    // ── 1. Bootstrap from cached session (instant, no network) ──
    const initFromSession = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            Logger.debug('AUTH', 'Local session check', session?.user?.id ?? 'none');

            if (cancelled) return;

            if (!session?.user) {
                Logger.info('AUTH', 'No session found — unauthenticated');
                setIsLoading(false);
                return;
            }

            currentUserIdRef.current = session.user.id;
            setAuthState('authenticating');
            await loadUser(session.user.id, session.user.email || '');
        } catch (e) {
            Logger.error('AUTH', 'Init failed', e);
            if (!cancelled) setIsLoading(false);
        } finally {
            isInitializingRef.current = false;
            initCompleteRef.current = true;
        }
    };

    initFromSession();

    // ── 2. Listen for subsequent auth changes ──
    // CRITICAL: During init, onAuthStateChange fires SIGNED_IN for token recovery.
    // We MUST skip those to avoid racing with initFromSession.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (cancelled) return;
        Logger.debug('AUTH', `Auth event: ${event}`, session?.user?.id);

        // Ignore INITIAL_SESSION — we handle init ourselves
        if (event === 'INITIAL_SESSION') return;

        if (event === 'SIGNED_OUT' || !session) {
            Logger.info('AUTH', 'Signed out event');
            handleLocalLogout();
            return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (!session?.user) return;

            // Block ALL auth events while init is still running (prevents StrictMode duplicate)
            if (isInitializingRef.current) {
                Logger.debug('AUTH', `Skipping ${event} — init still in progress`);
                return;
            }

            // Skip token refreshes for current user (no state change needed)
            if (currentUserIdRef.current === session.user.id && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
                Logger.debug('AUTH', `Skipping ${event} — same user already loaded`);
                return;
            }

            if (wizardActiveRef.current) {
                Logger.info('AUTH', 'Wizard active — deferring loadUser');
                currentUserIdRef.current = session.user.id;
                setIsLoading(false);
                return;
            }

            // Truly new user (different account signed in)
            if (currentUserIdRef.current !== session.user.id) {
                Logger.info('AUTH', 'New user signed in', session.user.id);
                currentUserIdRef.current = session.user.id;
                setAuthState('authenticating');
                await loadUser(session.user.id, session.user.email || '');
            }
        }
    });

    // ── 3. Safety timeout: never stay stuck on the loading screen ──
    // Reduced from 12s to 8s — Phase 1 is now a single fetch, so this is generous.
    // If it fires, show network_error screen with retry instead of infinite loader.
    const safetyTimer = setTimeout(() => {
        if (!cancelled) {
            setIsLoading(prev => {
                if (prev) {
                    Logger.warn('AUTH', 'Safety timeout — showing network error screen');
                    setAuthState('network_error');
                }
                return false;
            });
        }
    }, 8_000);

    return () => {
        cancelled = true;
        isInitializingRef.current = false;
        clearTimeout(safetyTimer);
        subscription.unsubscribe();
    };
  }, []);

  // Periodic JWT heartbeat — keep token fresh during long active clinical sessions.
  // The Supabase SDK's built-in auto-refresh timer can be throttled by the browser,
  // so this interval acts as a safety net (every 4 minutes).
  useEffect(() => {
      if (isDemoMode || authState !== 'authenticated') return;
      const HEARTBEAT_MS = 4 * 60 * 1000; // 4 minutes
      const heartbeat = setInterval(() => {
          refreshSessionIfNeeded('heartbeat');
      }, HEARTBEAT_MS);
      return () => clearInterval(heartbeat);
  }, [authState, isDemoMode]);

  // Auto-Lock (Sécurité Inactivité)
  useEffect(() => {
      let idleTimer: ReturnType<typeof setTimeout>;
      const performLock = () => { 
          if (authState === 'authenticated' && !isDemoMode) { 
              Logger.warn('AUTH', 'Idle timeout reached. Locking session.');
              lockSession(); 
          }
      };
      const resetIdleTimer = () => { 
          if (authState !== 'authenticated' || isDemoMode) return; 
          clearTimeout(idleTimer); 
          idleTimer = setTimeout(performLock, IDLE_TIMEOUT_MS); 
      };
      
      if (authState === 'authenticated' && !isDemoMode) { 
          window.addEventListener('mousemove', resetIdleTimer); 
          window.addEventListener('keydown', resetIdleTimer); 
          resetIdleTimer(); 
      }
      return () => { 
          clearTimeout(idleTimer); 
          window.removeEventListener('mousemove', resetIdleTimer); 
          window.removeEventListener('keydown', resetIdleTimer); 
      };
  }, [authState, isDemoMode]);

  // Keep JWT fresh when the app regains focus or becomes visible.
  useEffect(() => {
      if (isDemoMode) return;
      const onFocus = () => {
          if (authState !== 'unauthenticated') {
              refreshSessionIfNeeded('focus');
          }
      };
      const onVisibility = () => {
          if (document.visibilityState === 'visible') onFocus();
      };
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
          window.removeEventListener('focus', onFocus);
          document.removeEventListener('visibilitychange', onVisibility);
      };
  }, [authState, isDemoMode]);

  const handleLocalLogout = () => {
      Logger.info('AUTH', "Performing local logout cleanup");
      setPractitioner(null);
      setSessionKey(null);
      setOrgKey(null);
      setOrgId(null); 
      setUserProfile(INITIAL_PROFILE);
      setAuthState('unauthenticated');
      setIsDemoMode(false);
      StorageService.setDemoMode(false); 
      setIsLoading(false);
      
      // Reset des Refs
      isLoadingProfileRef.current = false; 
      currentUserIdRef.current = null;
      isInitializingRef.current = false;
  };

  const startDemo = async () => {
      setIsLoading(true);
      Logger.info('AUTH', "Starting Demo Mode...");
      StorageService.setDemoMode(true);
      setIsDemoMode(true);

      const mockPractitioner: PractitionerProfile = {
          id: 'demo-practitioner',
          email: 'demo@ergobilan.com',
          firstName: 'Invité',
          lastName: 'Démo',
          phonePro: '01 02 03 04 05',
          siret: '123 456 789 00012',
          addressPro: '10 Rue de la Démo, 75000 Paris',
          encryptionSalt: 'mock-salt',
          encryptionValidator: 'mock-validator',
          organizationRole: 'owner'
      };
      setPractitioner(mockPractitioner);

      // CONFIGURATION BRANDING DÉMO
      // On pré-active le branding pour que l'utilisateur voit directement le résultat "Pro"
      const demoBranding: BrandingConfig = {
          ...DEFAULT_BRANDING,
          isEnabled: true,
          cabinetName: "Cabinet d'Ergothérapie Martin",
          brandSubtitle: "Pédiatrie & Réadaptation",
          practitionerName: "Sophie MARTIN",
          address: "12 Avenue de la République, 75011 Paris",
          email: "cabinet.martin@sante.fr",
          phone: "01 44 55 66 77",
          siret: "800 123 456 00012",
          // Style par défaut plus "Corporate" pour impressionner
          headerTemplate: 'corporate',
          primaryColor: '#264653', // Bleu Canard Profond
          secondaryColor: '#E9C46A', // Or/Moutarde
          fontFamily: 'Open Sans',
          logoUrl: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png' // Puzzle Brain Icon
      };

      const mockUser: UserProfile = {
          id: 'demo-practitioner',
          email: 'demo@ergobilan.com',
          credits: 99, 
          subscriptionPlan: 'expert', // On met Expert pour débloquer toutes les features UI
          status: 'active',
          isAdmin: false,
          isTrial: true,
          trialDaysRemaining: 30,
          totalBilansGenerated: 12,
          hasAcceptedResponsibility: false,
          branding: demoBranding
      };
      setUserProfile(mockUser);

      const dummyKey = await generateSymetricKey();
      setSessionKey(dummyKey);
      setOrgKey(dummyKey);
      setOrgId(null);

      setAuthState('authenticated');
      setIsLoading(false);
  };

    // ─── PHASE 1: FAST-LOCK ─────────────────────────────────────────
    // Only fetches the practitioner row. Sets authState='locked' + practitioner
    // ASAP so PinUnlock renders within ~1 network round-trip.
    // Subscription/org checks are deferred to Phase 2 inside unlockSession().
    const loadUser = async (userId: string, email: string): Promise<AuthState> => {
      if (isLoadingProfileRef.current) {
          Logger.warn('AUTH', 'loadUser skipped: operation already in progress.');
          return authState;
      }
      
      isLoadingProfileRef.current = true; // LOCK
      Logger.info('AUTH', "Loading practitioner (fast-lock)", userId);
      
      try {
          const buildProfile = (user: Record<string, string | boolean | null>): PractitionerProfile => ({
              id: user.id as string,
              email: (user.email as string) || '',
              firstName: (user.first_name as string) || '',
              lastName: (user.last_name as string) || '',
              phonePro: (user.phone_pro as string) || '',
              siret: (user.siret as string) || '',
              addressPro: (user.address_pro as string) || '',
              encryptionSalt: (user.encryption_salt as string) || '',
              encryptionValidator: (user.encryption_validator as string) || ''
          });

          // 1. Charger le Praticien (seul appel réseau bloquant)
          // Select only required columns: identity, crypto setup, contact fields
          const userResult = await withTimeout(
              supabase.from('practitioners').select('id, email, first_name, last_name, phone_pro, siret, address_pro, encryption_salt, encryption_validator').eq('id', userId).maybeSingle(),
              15000
          );
          if (userResult.timedOut) {
              Logger.warn('AUTH', 'Practitioner fetch timed out; showing network error');
              setUserProfile(prev => ({ ...prev, id: userId, email }));
              setAuthState('network_error');
              return 'network_error';
          }

          const { data: user, error } = userResult.value!;
          
          if (error) Logger.error('AUTH', "Supabase error loading practitioner", error);

          if (user) {
              const profile = buildProfile(user as Record<string, string | boolean | null>);
              
              setPractitioner(profile);

              const needsRegistration = !profile.encryptionSalt || !profile.encryptionValidator || profile.encryptionValidator === 'pending';
              if (needsRegistration) {
                  Logger.warn('AUTH', 'Incomplete crypto setup detected. Redirecting to wizard.');
                  setTempEmail(email);
                  setAuthState('registering');
                  return 'registering';
              }

              // Fast-lock: PIN screen renders immediately.
              // Org bootstrap + subscription check happen AFTER PIN unlock (Phase 2).
              Logger.info('AUTH', 'Fast-locked — ready for PIN');
              setAuthState('locked');
              return 'locked';

          } else {
              Logger.warn('AUTH', "User authenticated but NO practitioner profile found. Redirecting to wizard.");
              const repairResult = await withTimeout(
                  supabase.rpc('bootstrap_practitioner_for_user', { p_user_id: userId, p_email: email }),
                  5000
              );
              if (!repairResult.timedOut && !repairResult.value?.error) {
                  const retryResult = await withTimeout(
                      supabase.from('practitioners').select('id, email, first_name, last_name, phone_pro, siret, address_pro, encryption_salt, encryption_validator').eq('id', userId).maybeSingle(),
                      5000
                  );
                  if (!retryResult.timedOut && retryResult.value?.data) {
                      const profile = buildProfile(retryResult.value.data as Record<string, string | boolean | null>);
                      setPractitioner(profile);

                      const needsRegistration = !profile.encryptionSalt || !profile.encryptionValidator || profile.encryptionValidator === 'pending';
                      if (needsRegistration) {
                          Logger.warn('AUTH', 'Incomplete crypto setup detected after bootstrap. Redirecting to wizard.');
                          setTempEmail(email);
                          setAuthState('registering');
                          return 'registering';
                      }
                  }
              } else {
                  Logger.warn('AUTH', 'Practitioner bootstrap timed out or failed');
              }
              setTempEmail(email);
              setAuthState('registering');
              return 'registering';
          }
      } catch (e) {
          Logger.error('AUTH', "Critical Auth Load Error", e);
          setAuthState('error');
          return 'error';
      } finally {
          isLoadingProfileRef.current = false; // UNLOCK
          setIsLoading(false);
      }
  };

  const refreshProfile = async (userId?: string) => {
      const targetId = userId || userProfile.id;
      if (!targetId || isDemoMode) return; 
      try {
          const fullProfile = await SubscriptionService.getUserProfile(targetId);
          if (fullProfile) setUserProfile(fullProfile);
      } catch (e) {
          Logger.warn('DB', "Failed to refresh profile details", e);
      }
  };

  const reloadUserFromSession = async (): Promise<AuthState | null> => {
      if (isDemoMode) return null;
      const { data: { user }, error } = await supabase.auth.getUser();
      if (error || !user) return null;

      // Reset wizard lock — si on est appelé depuis handleWizardComplete,
      // le wizard a fini son travail et loadUser peut maintenant tourner normalement
      wizardActiveRef.current = false;

      setIsLoading(true);
      setAuthState('authenticating');
      currentUserIdRef.current = user.id;

      let attempts = 0;
      while (isLoadingProfileRef.current && attempts < 10) {
          await new Promise(resolve => setTimeout(resolve, 150));
          attempts += 1;
      }

      return loadUser(user.id, user.email || '');
  };

  // NOUVEAU : Vérification stricte serveur pour Admin
  const verifyAdminAccess = async (): Promise<boolean> => {
      if (isDemoMode) return false;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Requête directe qui contourne le state local
      const { data, error } = await supabase
          .from('practitioners')
          .select('is_admin')
          .eq('id', user.id)
          .single();

      if (error || !data) {
          Logger.error('AUTH', "Admin verification failed", error);
          return false;
      }

      return data.is_admin === true;
  };

  // ─── PHASE 2: HYDRATE PROFILE (runs inside unlockSession, after PIN) ──
  // Org bootstrap + subscription check run in parallel after key derivation.
  // If subscription is invalid → authState='subscription_locked' → paywall.
  const hydrateProfile = async (userId: string): Promise<AuthState> => {
      Logger.info('AUTH', 'Hydrating profile (Phase 2 — post-unlock)');
      try {
          // Run org bootstrap and subscription fetch in parallel
          const [bootstrapSettled, profileSettled] = await Promise.allSettled([
              withTimeout(
                  Promise.resolve(supabase.rpc('bootstrap_org_for_user', { p_user_id: userId, p_org_name: 'Mon Cabinet' })),
                  5000
              ),
              withTimeout(
                  SubscriptionService.getUserProfile(userId),
                  8000
              )
          ]);

          // Handle bootstrap result (non-blocking)
          if (bootstrapSettled.status === 'rejected') {
              Logger.warn('AUTH', 'Bootstrap org RPC failed during hydration', bootstrapSettled.reason);
          } else if (bootstrapSettled.value.timedOut) {
              Logger.warn('AUTH', 'Bootstrap org RPC timed out during hydration');
          } else if ((bootstrapSettled.value.value as any)?.error) {
              Logger.warn('AUTH', 'Bootstrap RPC error during hydration', (bootstrapSettled.value.value as any).error);
          }

          // Handle subscription profile result
          if (profileSettled.status === 'rejected') {
              Logger.warn('AUTH', 'Profile fetch failed during hydration', profileSettled.reason);
              // Graceful degradation — user can work, profile reloads on next action
              return 'authenticated';
          }

          const profileResult = profileSettled.value;

          if (profileResult.timedOut) {
              Logger.warn('AUTH', 'Profile fetch timed out during hydration; continuing authenticated');
              // Fire-and-forget late resolve
              SubscriptionService.getUserProfile(userId)
                  .then((laterProfile) => {
                      if (laterProfile) {
                          Logger.info('AUTH', 'Profile fetched after hydration timeout', laterProfile.status);
                          setUserProfile(laterProfile);
                      }
                  })
                  .catch((e) => Logger.warn('AUTH', 'Profile fetch failed after hydration timeout', e));
              return 'authenticated';
          }

          const fullProfile = profileResult.value ?? null;

          if (fullProfile) {
              Logger.info('AUTH', 'Profile hydrated successfully', fullProfile.status);
              setUserProfile(fullProfile);

              SubscriptionService.subscribeToCredits(userId, (newCredits) => {
                  setUserProfile(prev => ({ ...prev, credits: newCredits }));
              });

              const hasValidAccess = fullProfile.status === 'active'
                  || fullProfile.status === 'trialing'
                  || (fullProfile.isTrial && fullProfile.trialDaysRemaining >= 0);

              if (!hasValidAccess) {
                  Logger.warn('AUTH', 'Subscription invalid — showing paywall');
                  return 'subscription_locked';
              }
              return 'authenticated';
          } else {
              Logger.warn('AUTH', 'Subscription Service returned null during hydration');
              return 'authenticated'; // Graceful degradation
          }
      } catch (e) {
          Logger.error('AUTH', 'Hydration error', e);
          return 'authenticated'; // Graceful degradation — don't block user
      }
  };

  const unlockSession = async (key: CryptoKey) => {
      if (!practitioner) return;
      Logger.info('CRYPTO', "Starting Hierarchical Unlock Process");

      try {
          if (!isDemoMode) {
              const { session, error } = await ensureFreshSession({ forceRefresh: true });
              if (!session) {
                  Logger.warn('AUTH', 'Session expired during unlock', error);
                  await forceLogout('Session expired');
                  return;
              }
          }
          const { data: memberData, error } = await supabase
              .from('organization_members')
              .select('encrypted_org_key, organization_id')
              .eq('user_id', practitioner.id)
              .maybeSingle();

          if (error) throw error;

          if (memberData && memberData.encrypted_org_key) {
              const [iv, content] = memberData.encrypted_org_key.split(':');
              const unwrappedOrgKey = await unwrapKey({ iv, content }, key);
              
              setSessionKey(key); 
              setOrgKey(unwrappedOrgKey);
              setOrgId(memberData.organization_id || null);

              // Phase 2: Hydrate subscription profile in parallel after key derivation
              const finalState = await hydrateProfile(practitioner.id);
              setAuthState(finalState);
          } else {
              Logger.warn('CRYPTO', "No encrypted Org Key found. Lazy initialization.");
              let orgIdVal = memberData?.organization_id;
              if (!orgIdVal) {
                  // Use SECURITY DEFINER RPC to bypass RLS on organizations table
                  const { data: newOrgId, error: orgErr } = await supabase.rpc('bootstrap_org_for_user', { p_user_id: practitioner.id, p_org_name: 'Mon Cabinet' });
                  if (orgErr || !newOrgId) throw orgErr || new Error('Failed to bootstrap organization');
                  orgIdVal = newOrgId;
              }

              const newOrgKey = await generateSymetricKey();
              const wrapped = await wrapKey(newOrgKey, key);
              const wrappedStr = `${wrapped.iv}:${wrapped.content}`;
              
              const { error: updateError } = await supabase
                  .from('organization_members')
                  .update({ encrypted_org_key: wrappedStr })
                  .eq('user_id', practitioner.id);

              if (updateError) throw updateError;
                  
              setSessionKey(key);
              setOrgKey(newOrgKey);
              setOrgId(orgIdVal || null);

              // Phase 2: Hydrate subscription profile after lazy init
              const finalState = await hydrateProfile(practitioner.id);
              setAuthState(finalState);
          }

      } catch (e) {
          Logger.error('CRYPTO', "Failed to unlock session/org key", e);
          alert("Erreur critique de déchiffrement. Veuillez vérifier votre PIN ou contacter le support.");
      }
  };

  const lockSession = () => {
      Logger.info('CRYPTO', "Locking session (Clearing keys)");
      setSessionKey(null);
      setOrgKey(null);
      setOrgId(null);
      setAuthState('locked');
  };

  const logout = async () => {
      Logger.info('AUTH', "User requested logout");
      handleLocalLogout();
      if (!isDemoMode) await supabase.auth.signOut(); 
  };

  const updateUserProfile = (update: Partial<UserProfile>) => {
      setUserProfile(prev => ({ ...prev, ...update }));
  };

  return (
    <AuthContext.Provider value={{ 
        userProfile, practitioner, sessionKey, orgKey, orgId, authState, isLoading, tempEmail, isDemoMode,
        refreshProfile, reloadUserFromSession, setSessionKey, setOrgKey, unlockSession, lockSession, logout, updateUserProfile, startDemo, verifyAdminAccess, setWizardActive
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};







