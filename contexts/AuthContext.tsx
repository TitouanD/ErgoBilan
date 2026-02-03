
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { SubscriptionService } from '../services/subscription';
import { PractitionerProfile, UserProfile, BrandingConfig } from '../types';
import { unwrapKey, wrapKey, generateSymetricKey } from '../utils/crypto'; // Ajout import
import { Logger } from '../utils/logger';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const SUBSCRIPTION_CHECK_TIMEOUT_MS = 5000; // 5 secondes max pour vérifier l'abo

interface AuthContextType {
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  sessionKey: CryptoKey | null; // MasterKey (PIN)
  orgKey: CryptoKey | null; // NOUVEAU: Clé du cabinet déchiffrée
  // Ajout de 'subscription_locked' : Utilisateur reconnu mais sans droits d'accès valides
  authState: 'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated' | 'subscription_locked';
  isLoading: boolean;
  tempEmail: string | null;
  refreshProfile: () => Promise<void>;
  setSessionKey: (key: CryptoKey | null) => void;
  unlockSession: (key: CryptoKey) => Promise<void>; // Devient async
  lockSession: () => void;
  logout: () => void;
  updateUserProfile: (update: Partial<UserProfile>) => void;
  setOrgKey: (key: CryptoKey | null) => void; // Setter manuel si besoin (ex: après création)
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_BRANDING: BrandingConfig = {
    isEnabled: false,
    primaryColor: '#3D405B',
    secondaryColor: '#E07A5F',
    fontFamily: 'Merriweather',
    headerLayout: 'row',
    headerAlignment: 'left',
    logoSize: 'medium',
    cornerStyle: 'rounded',
    cabinetName: "Cabinet d'Ergothérapie",
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
  const [orgKey, setOrgKey] = useState<CryptoKey | null>(null); // NOUVEAU
  const [authState, setAuthState] = useState<'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated' | 'subscription_locked'>('unauthenticated');
  const [isLoading, setIsLoading] = useState(true);
  const [tempEmail, setTempEmail] = useState<string | null>(null);

  // Initialisation Session & Listener
  useEffect(() => {
    // 1. Check initial
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        Logger.info('AUTH', "Session found at startup", session.user.id);
        await loadUser(session.user.id, session.user.email!);
      } else {
        Logger.info('AUTH', "No session found at startup.");
        setAuthState('unauthenticated');
        setIsLoading(false);
      }
    };
    initAuth();

    // 2. Abonnement aux changements
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        Logger.debug('AUTH', `Auth State Change: ${event}`);
        
        if (event === 'SIGNED_OUT') {
            handleLocalLogout();
        } else if (session?.user) {
            // Éviter de recharger si on est déjà dans un état stable pour cet user
            if (practitioner?.id !== session.user.id) {
                setAuthState('authenticating');
                await loadUser(session.user.id, session.user.email!);
            }
        }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auto-Lock (Sécurité Inactivité)
  useEffect(() => {
      let idleTimer: ReturnType<typeof setTimeout>;
      const performLock = () => { 
          if (authState === 'authenticated') {
              Logger.warn('AUTH', 'Idle timeout reached. Locking session.');
              lockSession(); 
          }
      };
      const resetIdleTimer = () => { 
          if (authState !== 'authenticated') return; 
          clearTimeout(idleTimer); 
          idleTimer = setTimeout(performLock, IDLE_TIMEOUT_MS); 
      };
      
      if (authState === 'authenticated') { 
          window.addEventListener('mousemove', resetIdleTimer); 
          window.addEventListener('keydown', resetIdleTimer); 
          resetIdleTimer(); 
      }
      return () => { 
          clearTimeout(idleTimer); 
          window.removeEventListener('mousemove', resetIdleTimer); 
          window.removeEventListener('keydown', resetIdleTimer); 
      };
  }, [authState]);

  const handleLocalLogout = () => {
      Logger.info('AUTH', "Performing local logout cleanup");
      setPractitioner(null);
      setSessionKey(null);
      setOrgKey(null); // Cleanup OrgKey
      setUserProfile(INITIAL_PROFILE);
      setAuthState('unauthenticated');
      setIsLoading(false);
  };

  const loadUser = async (userId: string, email: string) => {
      Logger.info('AUTH', "Loading user profile", userId);
      try {
          // 1. Charger le Praticien (Rapide)
          const { data: user, error } = await supabase.from('practitioners').select('*').eq('id', userId).maybeSingle();
          
          if (error) Logger.error('AUTH', "Supabase error loading practitioner", error);

          if (user) {
              const profile: PractitionerProfile = { 
                  id: user.id, 
                  email: user.email!, 
                  firstName: user.first_name || '', 
                  lastName: user.last_name || '', 
                  phonePro: user.phone_pro || '', 
                  siret: user.siret || '', 
                  addressPro: user.address_pro || '', 
                  encryptionSalt: user.encryption_salt!, 
                  encryptionValidator: user.encryption_validator! 
              };
              
              setPractitioner(profile);

              // 2. CHECK ABONNEMENT BLOQUANT AVEC TIMEOUT
              // On attend la réponse, mais pas plus de 5 secondes.
              Logger.debug('AUTH', "Checking subscription status (Blocking with Timeout)...");
              
              let fullProfile: UserProfile | null = null;
              
              try {
                  fullProfile = await Promise.race([
                      SubscriptionService.getUserProfile(userId),
                      new Promise<null>((_, reject) => 
                          setTimeout(() => reject(new Error("Subscription check timed out")), SUBSCRIPTION_CHECK_TIMEOUT_MS)
                      )
                  ]);
              } catch (subError) {
                  Logger.error('AUTH', "Critical: Subscription check failed/timeout", subError);
                  // Si le check échoue, on ne laisse PAS passer. Sécurité d'abord.
                  // On simule un profil null pour déclencher le verrouillage
                  fullProfile = null;
              }

              if (fullProfile) {
                  setUserProfile(fullProfile);
                  
                  // Abonnement Realtime aux crédits (Non bloquant)
                  SubscriptionService.subscribeToCredits(userId, (newCredits) => { 
                      setUserProfile(prev => ({ ...prev, credits: newCredits })); 
                  });

                  // VALIDATION STRICTE DE L'ACCÈS
                  // Accès autorisé si : (Plan Payant Actif) OU (Essai Valide)
                  const hasValidAccess = fullProfile.status === 'active' || (fullProfile.isTrial && fullProfile.trialDaysRemaining >= 0);

                  if (!hasValidAccess) {
                      Logger.warn('AUTH', `Access Denied. Status: ${fullProfile.status}, TrialDays: ${fullProfile.trialDaysRemaining}`);
                      setAuthState('subscription_locked'); // -> UI Paywall Bloquant
                  } else if (profile.encryptionValidator === 'pending') {
                      Logger.warn('AUTH', "Profile found but PIN is pending. Redirecting to setup.");
                      setTempEmail(email); 
                      setAuthState('registering'); 
                  } else {
                      Logger.info('AUTH', "Access Granted. Locking session (waiting for PIN).");
                      setAuthState('locked'); // -> UI PIN
                  }

              } else {
                  // Echec récupération profil abonnement (Timeout ou Erreur réseau grave)
                  Logger.error('AUTH', "Impossible to verify subscription. Locking access.");
                  // On peut mettre un message d'erreur spécifique dans l'UI via un Toast si besoin, 
                  // mais ici on verrouille par sécurité.
                  setAuthState('subscription_locked'); 
              }

          } else {
              // User authentifié chez Supabase mais pas de profil dans 'practitioners'
              Logger.warn('AUTH', "User authenticated but NO practitioner profile found. Redirecting to wizard.");
              setTempEmail(email);
              setAuthState('registering'); 
          }
      } catch (e) {
          Logger.error('AUTH', "Critical Auth Load Error", e);
          await supabase.auth.signOut();
          handleLocalLogout();
      } finally {
          setIsLoading(false);
      }
  };

  const refreshProfile = async (userId?: string) => {
      const targetId = userId || userProfile.id;
      if (!targetId) return;
      try {
          const fullProfile = await SubscriptionService.getUserProfile(targetId);
          if (fullProfile) setUserProfile(fullProfile);
      } catch (e) {
          Logger.warn('DB', "Failed to refresh profile details", e);
      }
  };

  /**
   * PROCESSUS DE DÉVERROUILLAGE HIÉRARCHIQUE (CRITIQUE)
   * 1. Reçoit la MasterKey (dérivée du PIN).
   * 2. Récupère la OrgKey chiffrée depuis la table organization_members.
   * 3. Déchiffre la OrgKey avec la MasterKey.
   * 4. Stocke les deux en mémoire.
   */
  const unlockSession = async (key: CryptoKey) => {
      if (!practitioner) return;
      Logger.info('CRYPTO', "Starting Hierarchical Unlock Process");

      try {
          // A. Récupérer le membre et la clé chiffrée
          const { data: memberData, error } = await supabase
              .from('organization_members')
              .select('encrypted_org_key, organization_id')
              .eq('user_id', practitioner.id)
              .maybeSingle();

          if (error) throw error;

          if (memberData && memberData.encrypted_org_key) {
              const [iv, content] = memberData.encrypted_org_key.split(':');
              const unwrappedOrgKey = await unwrapKey({ iv, content }, key);
              Logger.info('CRYPTO', "Organization Key successfully unwrapped.");
              
              setSessionKey(key); 
              setOrgKey(unwrappedOrgKey); 
              setAuthState('authenticated');
          } else {
              // Fallback (Migration/Init)
              Logger.warn('CRYPTO', "No encrypted Org Key found. Lazy initialization.");
              let orgId = memberData?.organization_id;
              if (!orgId) {
                  const { data: newOrg } = await supabase.from('organizations').insert({ name: 'Mon Cabinet' }).select().single();
                  orgId = newOrg.id;
              }

              const newOrgKey = await generateSymetricKey();
              const wrapped = await wrapKey(newOrgKey, key);
              const wrappedStr = `${wrapped.iv}:${wrapped.content}`;
              
              const { error: upsertError } = await supabase
                  .from('organization_members')
                  .upsert({ 
                      organization_id: orgId,
                      user_id: practitioner.id,
                      role: 'owner',
                      encrypted_org_key: wrappedStr
                  });

              if (upsertError) throw upsertError;
                  
              Logger.info('CRYPTO', "New Organization Key generated and saved.");
              setSessionKey(key);
              setOrgKey(newOrgKey);
              setAuthState('authenticated');
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
      setAuthState('locked');
  };

  const logout = async () => {
      Logger.info('AUTH', "User requested logout");
      handleLocalLogout();
      await supabase.auth.signOut();
  };

  const updateUserProfile = (update: Partial<UserProfile>) => {
      setUserProfile(prev => ({ ...prev, ...update }));
  };

  return (
    <AuthContext.Provider value={{ 
        userProfile, practitioner, sessionKey, orgKey, authState, isLoading, tempEmail,
        refreshProfile, setSessionKey, setOrgKey, unlockSession, lockSession, logout, updateUserProfile 
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
