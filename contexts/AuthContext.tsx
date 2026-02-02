
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { SubscriptionService } from '../services/subscription';
import { PractitionerProfile, UserProfile, BrandingConfig } from '../types';
import { Logger } from '../utils/logger';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AuthContextType {
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  sessionKey: CryptoKey | null;
  authState: 'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated';
  isLoading: boolean;
  tempEmail: string | null;
  refreshProfile: () => Promise<void>;
  setSessionKey: (key: CryptoKey | null) => void;
  unlockSession: (key: CryptoKey) => void;
  lockSession: () => void;
  logout: () => void;
  updateUserProfile: (update: Partial<UserProfile>) => void;
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
  const [authState, setAuthState] = useState<'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated'>('unauthenticated');
  const [isLoading, setIsLoading] = useState(true);
  const [tempEmail, setTempEmail] = useState<string | null>(null);

  // Initialisation Session & Listener
  useEffect(() => {
    // 1. Check initial
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        Logger.info("Session found at startup:", session.user.id);
        await loadUser(session.user.id, session.user.email!);
      } else {
        Logger.info("No session found at startup.");
        setAuthState('unauthenticated');
        setIsLoading(false);
      }
    };
    initAuth();

    // 2. Abonnement aux changements
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        Logger.debug("Auth State Change:", event);
        
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
      const performLock = () => { if (authState === 'authenticated') lockSession(); };
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
      Logger.info("Performing local logout cleanup");
      setPractitioner(null);
      setSessionKey(null);
      setUserProfile(INITIAL_PROFILE);
      setAuthState('unauthenticated');
      setIsLoading(false);
  };

  const loadUser = async (userId: string, email: string) => {
      Logger.info("Loading user profile for:", userId);
      try {
          const { data: user, error } = await supabase.from('practitioners').select('*').eq('id', userId).maybeSingle();
          
          if (error) {
              Logger.error("Supabase error loading practitioner:", error);
              throw error;
          }

          if (user) {
              Logger.info("Practitioner profile found. Locking session.");
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
              Logger.warn("User authenticated but NO practitioner profile found. Redirecting to wizard.");
              setTempEmail(email);
              setAuthState('registering'); // -> Redirection vers Wizard Completion
          }
      } catch (e) {
          Logger.error("Critical Auth Load Error", e);
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
      
      Logger.debug("Refreshing profile data for:", targetId);
      const fullProfile = await SubscriptionService.getUserProfile(targetId);
      if (fullProfile) setUserProfile(fullProfile);
      
      // Abonnement Realtime aux crédits
      SubscriptionService.subscribeToCredits(targetId, (newCredits) => { 
          Logger.debug("Realtime credits update:", newCredits);
          setUserProfile(prev => ({ ...prev, credits: newCredits })); 
      });
  };

  const unlockSession = (key: CryptoKey) => {
      Logger.info("Session unlocked successfully");
      setSessionKey(key);
      setAuthState('authenticated');
  };

  const lockSession = () => {
      Logger.info("Session locked (timeout or manual)");
      setSessionKey(null);
      setAuthState('locked');
  };

  const logout = async () => {
      Logger.info("User requested logout");
      // Nettoyage immédiat de l'état local pour sécurité visuelle instantanée
      handleLocalLogout();
      // Puis appel serveur
      await supabase.auth.signOut();
  };

  const updateUserProfile = (update: Partial<UserProfile>) => {
      setUserProfile(prev => ({ ...prev, ...update }));
  };

  return (
    <AuthContext.Provider value={{ 
        userProfile, practitioner, sessionKey, authState, isLoading, tempEmail,
        refreshProfile, setSessionKey, unlockSession, lockSession, logout, updateUserProfile 
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
