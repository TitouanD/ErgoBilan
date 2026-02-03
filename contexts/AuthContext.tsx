
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { SubscriptionService } from '../services/subscription';
import { PractitionerProfile, UserProfile, BrandingConfig } from '../types';
import { unwrapKey, wrapKey, generateSymetricKey } from '../utils/crypto'; // Ajout import
import { Logger } from '../utils/logger';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AuthContextType {
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  sessionKey: CryptoKey | null; // MasterKey (PIN)
  orgKey: CryptoKey | null; // NOUVEAU: Clé du cabinet déchiffrée
  authState: 'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated';
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
  const [authState, setAuthState] = useState<'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated'>('unauthenticated');
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
          const { data: user, error } = await supabase.from('practitioners').select('*').eq('id', userId).maybeSingle();
          
          if (error) {
              Logger.error('AUTH', "Supabase error loading practitioner", error);
              // On ne jette pas l'erreur, on assume que le profil n'existe pas pour envoyer au wizard
          }

          if (user) {
              Logger.info('AUTH', "Practitioner profile found. Locking session.");
              setPractitioner({ 
                  id: user.id, 
                  email: user.email!, 
                  firstName: user.first_name!, 
                  lastName: user.last_name!, 
                  phonePro: user.phone_pro || '', 
                  siret: user.siret || '', 
                  addressPro: user.address_pro || '', 
                  encryptionSalt: user.encryption_salt!, 
                  encryptionValidator: user.encryption_validator! 
              });
              await refreshProfile(userId);
              setAuthState('locked'); // Profil trouvé -> Ecran PIN
          } else {
              // User authentifié chez Supabase mais pas de profil dans 'practitioners'
              Logger.warn('AUTH', "User authenticated but NO practitioner profile found. Redirecting to wizard.");
              setTempEmail(email);
              setAuthState('registering'); // -> Redirection vers Wizard Completion
          }
      } catch (e) {
          Logger.error('AUTH', "Critical Auth Load Error", e);
          // En cas d'erreur critique de chargement, on déconnecte pour éviter les états incohérents
          await supabase.auth.signOut();
          handleLocalLogout();
      } finally {
          setIsLoading(false);
      }
  };

  const refreshProfile = async (userId?: string) => {
      const targetId = userId || userProfile.id;
      if (!targetId) return;
      
      Logger.debug('DB', "Refreshing profile data", targetId);
      const fullProfile = await SubscriptionService.getUserProfile(targetId);
      if (fullProfile) setUserProfile(fullProfile);
      
      // Abonnement Realtime aux crédits
      SubscriptionService.subscribeToCredits(targetId, (newCredits) => { 
          Logger.debug('DB', "Realtime credits update received", newCredits);
          setUserProfile(prev => ({ ...prev, credits: newCredits })); 
      });
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

          // Tolérance zéro sur l'erreur DB
          if (error) throw error;

          if (memberData && memberData.encrypted_org_key) {
              // B. Déchiffrer la Org Key
              const [iv, content] = memberData.encrypted_org_key.split(':');
              const unwrappedOrgKey = await unwrapKey({ iv, content }, key);
              Logger.info('CRYPTO', "Organization Key successfully unwrapped.");
              
              setSessionKey(key); // Master Key
              setOrgKey(unwrappedOrgKey); // Org Key
              setAuthState('authenticated');
          } else {
              // CAS MIGRATION / INITIALISATION TARDIVE
              // Si l'utilisateur a un compte mais pas encore de clé d'orga chiffrée (ex: créé par le trigger SQL qui met NULL ou échec trigger)
              Logger.warn('CRYPTO', "No encrypted Org Key found. Lazy initialization.");
              
              // 1. Vérifier si l'organisation existe (sinon la créer)
              let orgId = memberData?.organization_id;
              if (!orgId) {
                  // Fallback ultime : création orga si manquant
                  const { data: newOrg } = await supabase.from('organizations').insert({ name: 'Mon Cabinet' }).select().single();
                  orgId = newOrg.id;
              }

              const newOrgKey = await generateSymetricKey();
              const wrapped = await wrapKey(newOrgKey, key);
              const wrappedStr = `${wrapped.iv}:${wrapped.content}`;
              
              // On met à jour la DB (Upsert pour gérer le cas où membre n'existait pas)
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
          // On ne déverrouille pas si la chaîne de confiance est brisée
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
