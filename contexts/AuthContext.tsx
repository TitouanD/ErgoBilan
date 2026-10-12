/**
 * AuthContext — authentication state machine.
 *
 * unauthenticated → authenticating → registering (PIN not set up yet, wizard)
 *                                  → locked (PIN screen) → authenticated
 *
 * Phase 1 (`loadUser`, "fast-lock") only reads the practitioner row so the PIN
 * screen shows after one round-trip. Phase 2 (`hydrateProfile`) runs after the
 * PIN unlock: organization bootstrap + subscription/credits/branding.
 */

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, ensureFreshSession } from '../services/db';
import { ProfileService } from '../services/profile';
import { StorageService } from '../services/storage';
import type { PractitionerProfile, UserProfile, BrandingConfig } from '../types';
import type { Tables } from '../types/supabase';
import { DEFAULT_BRANDING } from '../data/brandingDefaults';
import { generateSymetricKey } from '../utils/crypto';
import { Logger } from '../utils/logger';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const HEARTBEAT_MS = 4 * 60 * 1000;
const SAFETY_TIMEOUT_MS = 8_000;
const BRANDING_SAVE_DEBOUNCE_MS = 800;
const FORCE_PASSWORD_REAUTH_DAYS = Number(import.meta.env.VITE_FORCE_PASSWORD_REAUTH_DAYS ?? 2);
const FORCE_PASSWORD_REAUTH_MS =
  Number.isFinite(FORCE_PASSWORD_REAUTH_DAYS) && FORCE_PASSWORD_REAUTH_DAYS > 0 ? FORCE_PASSWORD_REAUTH_DAYS * 24 * 60 * 60 * 1000 : 0;

const PRACTITIONER_COLUMNS =
  'id, email, first_name, last_name, phone_pro, siret, address_pro, encryption_salt, encryption_validator, ai_style_preferences' as const;

type PractitionerRow = Pick<
  Tables<'practitioners'>,
  | 'id'
  | 'email'
  | 'first_name'
  | 'last_name'
  | 'phone_pro'
  | 'siret'
  | 'address_pro'
  | 'encryption_salt'
  | 'encryption_validator'
  | 'ai_style_preferences'
>;

const toPractitionerProfile = (row: PractitionerRow): PractitionerProfile => ({
  id: row.id,
  email: row.email || '',
  firstName: row.first_name || '',
  lastName: row.last_name || '',
  phonePro: row.phone_pro || '',
  siret: row.siret || '',
  addressPro: row.address_pro || '',
  encryptionSalt: row.encryption_salt || '',
  encryptionValidator: row.encryption_validator || '',
  aiStylePreferences: row.ai_style_preferences || undefined,
});

/** PIN not configured yet → the signup wizard must complete the profile. */
const needsPinSetup = (p: PractitionerProfile) =>
  !p.encryptionSalt || !p.encryptionValidator || p.encryptionSalt === 'pending' || p.encryptionValidator === 'pending';

const shouldForcePasswordReauth = (session: Session | null): boolean => {
  if (!session?.user || FORCE_PASSWORD_REAUTH_MS <= 0) return false;
  const lastSignInMs = Date.parse(session.user.last_sign_in_at ?? '');
  return Number.isFinite(lastSignInMs) && Date.now() - lastSignInMs >= FORCE_PASSWORD_REAUTH_MS;
};

const withTimeout = async <T,>(promise: PromiseLike<T>, ms: number): Promise<{ timedOut: boolean; value?: T }> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  });
  try {
    return { timedOut: false, value: await Promise.race([promise, timeout]) };
  } catch (e) {
    if (e instanceof Error && e.message === 'TIMEOUT') return { timedOut: true };
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export type AuthState = 'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated' | 'network_error' | 'error';

interface AuthContextType {
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  /**
   * Key derived from the PIN (PBKDF2). Used to wrap portal questionnaire keys and
   * as the idle-lock gate. It does NOT encrypt local patient data (docs/TECH_DEBT.md P0-1).
   */
  sessionKey: CryptoKey | null;
  authState: AuthState;
  isLoading: boolean;
  tempEmail: string | null;
  isDemoMode: boolean;

  /** Reload credits/subscription/branding and the AI style preferences. */
  refreshProfile: () => Promise<void>;
  reloadUserFromSession: () => Promise<AuthState | null>;
  setSessionKey: (key: CryptoKey | null) => void;
  unlockSession: (key: CryptoKey) => Promise<void>;
  lockSession: () => void;
  logout: () => Promise<void>;
  /** Update the report branding and persist it (debounced) to the practitioner profile. */
  updateBranding: (branding: BrandingConfig) => void;
  startDemo: () => Promise<void>;
  /** Server-side admin check (never trust the cached profile for this). */
  verifyAdminAccess: () => Promise<boolean>;
  /** Blocks loadUser while the signup wizard is working. */
  setWizardActive: (active: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INITIAL_PROFILE: UserProfile = {
  id: '',
  email: '',
  credits: 0,
  monthlyCredits: 0,
  purchasedCredits: 0,
  subscriptionPlan: 'free',
  status: 'active',
  billingSource: null,
  currentPeriodEnd: null,
  trialDenied: false,
  totalBilansGenerated: 0,
  hasAcceptedResponsibility: false,
  isAdmin: false,
  isTrial: false,
  trialDaysRemaining: 0,
  branding: DEFAULT_BRANDING,
};

const DEMO_PRACTITIONER: PractitionerProfile = {
  id: 'demo-practitioner',
  email: 'demo@ergobilan.com',
  firstName: 'Invité',
  lastName: 'Démo',
  phonePro: '01 02 03 04 05',
  siret: '123 456 789 00012',
  addressPro: '10 Rue de la Démo, 75000 Paris',
  encryptionSalt: 'mock-salt',
  encryptionValidator: 'mock-validator',
  organizationRole: 'owner',
};

/** Demo profile: Solo plan with a customized branding so every feature is visible. */
const DEMO_PROFILE: UserProfile = {
  id: 'demo-practitioner',
  email: 'demo@ergobilan.com',
  credits: 99,
  monthlyCredits: 30,
  purchasedCredits: 69,
  subscriptionPlan: 'solo',
  status: 'active',
  billingSource: null,
  currentPeriodEnd: null,
  trialDenied: false,
  isAdmin: false,
  isTrial: true,
  trialDaysRemaining: 30,
  totalBilansGenerated: 12,
  hasAcceptedResponsibility: false,
  branding: {
    ...DEFAULT_BRANDING,
    isEnabled: true,
    cabinetName: "Cabinet d'Ergothérapie Martin",
    brandSubtitle: 'Pédiatrie & Réadaptation',
    practitionerName: 'Sophie MARTIN',
    address: '12 Avenue de la République, 75011 Paris',
    email: 'cabinet.martin@sante.fr',
    phone: '01 44 55 66 77',
    siret: '800 123 456 00012',
    headerTemplate: 'corporate',
    primaryColor: '#264653',
    secondaryColor: '#E9C46A',
    fontFamily: 'Open Sans',
  },
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_PROFILE);
  const [practitioner, setPractitioner] = useState<PractitionerProfile | null>(null);
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null);
  const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [isLoading, setIsLoading] = useState(true);
  const [tempEmail, setTempEmail] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Guards against concurrent/duplicate loads (StrictMode double effects, auth events during init)
  const isLoadingProfileRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);
  const wizardActiveRef = useRef(false);
  const isInitializingRef = useRef(false);
  const refreshInFlightRef = useRef(false);
  const brandingSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setWizardActive = (active: boolean) => {
    wizardActiveRef.current = active;
    Logger.info('AUTH', `Wizard active lock: ${active}`);
  };

  const handleLocalLogout = () => {
    Logger.info('AUTH', 'Performing local logout cleanup');
    if (brandingSaveTimerRef.current) clearTimeout(brandingSaveTimerRef.current);
    StorageService.reset();
    StorageService.setDemoMode(false);
    setPractitioner(null);
    setSessionKey(null);
    setUserProfile(INITIAL_PROFILE);
    setAuthState('unauthenticated');
    setIsDemoMode(false);
    setIsLoading(false);
    isLoadingProfileRef.current = false;
    currentUserIdRef.current = null;
    isInitializingRef.current = false;
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

  const refreshSessionIfNeeded = async (reason: string) => {
    if (isDemoMode || authState === 'unauthenticated' || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      const { session, refreshed, error } = await ensureFreshSession();
      if (error) Logger.warn('AUTH', `Session refresh failed (${reason})`, error);
      else if (refreshed) Logger.debug('AUTH', `Session refreshed (${reason})`, session?.user?.id);
    } finally {
      refreshInFlightRef.current = false;
    }
  };

  // ─── Phase 1: fast-lock ─────────────────────────────────────────────────
  const loadUser = async (userId: string, email: string): Promise<AuthState> => {
    if (isLoadingProfileRef.current) {
      Logger.warn('AUTH', 'loadUser skipped: operation already in progress.');
      return authState;
    }
    isLoadingProfileRef.current = true;
    Logger.info('AUTH', 'Loading practitioner (fast-lock)', userId);

    const fetchPractitioner = (timeoutMs: number) =>
      withTimeout(supabase.from('practitioners').select(PRACTITIONER_COLUMNS).eq('id', userId).maybeSingle(), timeoutMs);

    const toRegistration = (): AuthState => {
      setTempEmail(email);
      setAuthState('registering');
      return 'registering';
    };

    try {
      const result = await fetchPractitioner(15_000);
      if (result.timedOut) {
        Logger.warn('AUTH', 'Practitioner fetch timed out; showing network error');
        setUserProfile((prev) => ({ ...prev, id: userId, email }));
        setAuthState('network_error');
        return 'network_error';
      }
      if (result.value?.error) Logger.error('AUTH', 'Supabase error loading practitioner', result.value.error);

      let row = result.value?.data ?? null;
      if (!row) {
        // Signup trigger may have failed: repair the practitioner row, then retry once.
        Logger.warn('AUTH', 'No practitioner profile found — bootstrapping');
        const repair = await withTimeout(supabase.rpc('bootstrap_practitioner_for_user', { p_user_id: userId, p_email: email }), 5_000);
        if (!repair.timedOut && !repair.value?.error) {
          const retry = await fetchPractitioner(5_000);
          row = retry.timedOut ? null : (retry.value?.data ?? null);
        } else {
          Logger.warn('AUTH', 'Practitioner bootstrap timed out or failed');
        }
      }
      if (!row) return toRegistration();

      const profile = toPractitionerProfile(row);
      setPractitioner(profile);
      if (needsPinSetup(profile)) {
        Logger.warn('AUTH', 'PIN not configured — redirecting to wizard');
        return toRegistration();
      }
      Logger.info('AUTH', 'Fast-locked — ready for PIN');
      setAuthState('locked');
      return 'locked';
    } catch (e) {
      Logger.error('AUTH', 'Critical Auth Load Error', e);
      setAuthState('error');
      return 'error';
    } finally {
      isLoadingProfileRef.current = false;
      setIsLoading(false);
    }
  };

  // ─── Phase 2: hydrate profile after the PIN unlock ─────────────────────
  const hydrateProfile = async (userId: string): Promise<AuthState> => {
    Logger.info('AUTH', 'Hydrating profile (post-unlock)');
    try {
      const [bootstrap, profile] = await Promise.allSettled([
        withTimeout(supabase.rpc('bootstrap_org_for_user', { p_user_id: userId, p_org_name: 'Mon Cabinet' }), 5_000),
        withTimeout(ProfileService.getUserProfile(userId), 8_000),
      ]);

      if (bootstrap.status === 'rejected') Logger.warn('AUTH', 'Bootstrap org RPC failed', bootstrap.reason);
      else if (bootstrap.value.timedOut) Logger.warn('AUTH', 'Bootstrap org RPC timed out');
      else if (bootstrap.value.value?.error) Logger.warn('AUTH', 'Bootstrap org RPC error', bootstrap.value.value.error);

      // Profile failures degrade gracefully: the practitioner can keep working.
      if (profile.status === 'rejected') {
        Logger.warn('AUTH', 'Profile fetch failed during hydration', profile.reason);
        return 'authenticated';
      }
      if (profile.value.timedOut) {
        Logger.warn('AUTH', 'Profile fetch timed out; continuing authenticated');
        ProfileService.getUserProfile(userId)
          .then((later) => later && setUserProfile(later))
          .catch((e) => Logger.warn('AUTH', 'Late profile fetch failed', e));
        return 'authenticated';
      }
      const fullProfile = profile.value.value ?? null;
      if (!fullProfile) return 'authenticated';

      // No plan never locks the app: only AI generation needs a credit (ADR 0002).
      setUserProfile(fullProfile);
      return 'authenticated';
    } catch (e) {
      Logger.error('AUTH', 'Hydration error', e);
      return 'authenticated';
    }
  };

  // ─── Initialization (single effect) ─────────────────────────────────────
  useEffect(() => {
    Logger.info('AUTH', 'Initializing Auth...');
    let cancelled = false;
    isInitializingRef.current = true;

    const initFromSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) return;
        if (!session?.user) {
          setIsLoading(false);
          return;
        }
        if (shouldForcePasswordReauth(session)) {
          Logger.info('AUTH', `Password reauth required (>${FORCE_PASSWORD_REAUTH_DAYS} days since last sign-in)`);
          await supabase.auth.signOut().catch((e) => Logger.warn('AUTH', 'Forced periodic sign-out failed', e));
          if (!cancelled) {
            setAuthState('unauthenticated');
            setIsLoading(false);
          }
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
      }
    };
    initFromSession();

    // Subsequent auth events. INITIAL_SESSION and events fired during init are handled by initFromSession.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled || event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT' || !session) {
        handleLocalLogout();
        return;
      }
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED' && event !== 'USER_UPDATED') return;
      if (isInitializingRef.current) return;
      if (currentUserIdRef.current === session.user.id) return;
      if (wizardActiveRef.current) {
        Logger.info('AUTH', 'Wizard active — deferring loadUser');
        currentUserIdRef.current = session.user.id;
        setIsLoading(false);
        return;
      }
      Logger.info('AUTH', 'New user signed in', session.user.id);
      currentUserIdRef.current = session.user.id;
      setAuthState('authenticating');
      await loadUser(session.user.id, session.user.email || '');
    });

    // Never stay stuck on the loader: show the network error screen with a retry.
    const safetyTimer = setTimeout(() => {
      if (cancelled) return;
      setIsLoading((prev) => {
        if (prev) {
          Logger.warn('AUTH', 'Safety timeout — showing network error screen');
          setAuthState('network_error');
        }
        return false;
      });
    }, SAFETY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      isInitializingRef.current = false;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  // JWT heartbeat: the SDK auto-refresh timer can be throttled by the browser during long sessions.
  useEffect(() => {
    if (isDemoMode || authState !== 'authenticated') return;
    const heartbeat = setInterval(() => refreshSessionIfNeeded('heartbeat'), HEARTBEAT_MS);
    return () => clearInterval(heartbeat);
  }, [authState, isDemoMode]);

  // Auto-lock after inactivity
  useEffect(() => {
    if (authState !== 'authenticated' || isDemoMode) return;
    let idleTimer: ReturnType<typeof setTimeout>;
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        Logger.warn('AUTH', 'Idle timeout reached. Locking session.');
        lockSession();
      }, IDLE_TIMEOUT_MS);
    };
    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);
    resetIdleTimer();
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('mousemove', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, [authState, isDemoMode]);

  // Refresh the JWT when the app regains focus
  useEffect(() => {
    if (isDemoMode) return;
    const onFocus = () => {
      if (authState !== 'unauthenticated') refreshSessionIfNeeded('focus');
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

  const startDemo = async () => {
    setIsLoading(true);
    Logger.info('AUTH', 'Starting Demo Mode...');
    StorageService.setDemoMode(true);
    setIsDemoMode(true);
    setPractitioner(DEMO_PRACTITIONER);
    setUserProfile(DEMO_PROFILE);
    setSessionKey(await generateSymetricKey());
    StorageService.setCurrentUser(DEMO_PRACTITIONER.id);
    setAuthState('authenticated');
    setIsLoading(false);
  };

  const refreshProfile = async () => {
    const targetId = userProfile.id || practitioner?.id;
    if (!targetId || isDemoMode) return;
    try {
      const [fullProfile, aiStylePreferences] = await Promise.all([
        ProfileService.getUserProfile(targetId),
        ProfileService.getAiStylePreferences(targetId),
      ]);
      if (fullProfile) setUserProfile(fullProfile);
      setPractitioner((prev) => (prev ? { ...prev, aiStylePreferences } : prev));
    } catch (e) {
      Logger.warn('DB', 'Failed to refresh profile details', e);
    }
  };

  const reloadUserFromSession = async (): Promise<AuthState | null> => {
    if (isDemoMode) return null;
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;

    // Called when the wizard is done: loadUser can run normally again.
    wizardActiveRef.current = false;
    setIsLoading(true);
    setAuthState('authenticating');
    currentUserIdRef.current = user.id;

    for (let attempt = 0; isLoadingProfileRef.current && attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return loadUser(user.id, user.email || '');
  };

  const verifyAdminAccess = async (): Promise<boolean> => {
    if (isDemoMode) return false;
    const { data, error } = await supabase.rpc('admin_check');
    if (error) {
      Logger.error('AUTH', 'Admin verification failed', error);
      return false;
    }
    return data === true;
  };

  const unlockSession = async (key: CryptoKey) => {
    if (!practitioner) return;
    Logger.info('CRYPTO', 'Unlocking session');
    try {
      const { session, error } = await ensureFreshSession({ minValidityMs: 10_000 });
      if (!session) {
        Logger.warn('AUTH', 'Session expired during unlock', error);
        await forceLogout('Session expired');
        return;
      }
      setSessionKey(key);
      StorageService.setCurrentUser(practitioner.id);
      setAuthState(await hydrateProfile(practitioner.id));
    } catch (e) {
      Logger.error('CRYPTO', 'Failed to unlock session', e);
      setAuthState('error');
    }
  };

  const lockSession = () => {
    Logger.info('CRYPTO', 'Locking session (clearing key, closing local database)');
    StorageService.reset();
    setSessionKey(null);
    setAuthState('locked');
  };

  const logout = async () => {
    Logger.info('AUTH', 'User requested logout');
    const wasDemo = isDemoMode;
    handleLocalLogout();
    if (!wasDemo) await supabase.auth.signOut();
  };

  const updateBranding = (branding: BrandingConfig) => {
    setUserProfile((prev) => ({ ...prev, branding }));
    if (isDemoMode || !userProfile.id) return;
    const userId = userProfile.id;
    if (brandingSaveTimerRef.current) clearTimeout(brandingSaveTimerRef.current);
    brandingSaveTimerRef.current = setTimeout(() => {
      ProfileService.saveBranding(userId, branding).catch((e) => Logger.error('DB', 'Branding save failed', e));
    }, BRANDING_SAVE_DEBOUNCE_MS);
  };

  return (
    <AuthContext.Provider
      value={{
        userProfile,
        practitioner,
        sessionKey,
        authState,
        isLoading,
        tempEmail,
        isDemoMode,
        refreshProfile,
        reloadUserFromSession,
        setSessionKey,
        unlockSession,
        lockSession,
        logout,
        updateBranding,
        startDemo,
        verifyAdminAccess,
        setWizardActive,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
