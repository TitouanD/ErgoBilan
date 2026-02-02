
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../services/db';
import { SubscriptionService } from '../services/subscription';
import { PractitionerProfile, UserProfile, BrandingConfig } from '../types';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

interface AuthContextType {
  userProfile: UserProfile;
  practitioner: PractitionerProfile | null;
  sessionKey: CryptoKey | null;
  authState: 'unauthenticated' | 'registering' | 'authenticating' | 'locked' | 'authenticated';
  isLoading: boolean;
  tempEmail: string | null; // Pour passer l'email au Wizard en cas de registering
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
        await loadUser(session.user.id, session.user.email!);
      } else {
        setAuthState('unauthenticated');
        setIsLoading(false);
      }
    };
    initAuth();

    // 2. Abonnement aux changements (Login/Logout/Signup depuis n'importe où)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user) {
            // Éviter de recharger si on est déjà dans un état stable pour cet user
            if (practitioner?.id !== session.user.id) {
                setAuthState('authenticating'); // UI Feedback immédiat
                await loadUser(session.user.id, session.user.email!);
            }
        } else {
            // Logout
            setPractitioner(null);
            setSessionKey(null);
            setUserProfile(INITIAL_PROFILE);
            setAuthState('unauthenticated');
            setIsLoading(false);
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

  const loadUser = async (userId: string, email: string) => {
      try {
          const { data: user } = await supabase.from('practitioners').select('*').eq('id', userId).maybeSingle();
          
          if (user) {
              setPractitioner({ 
                  id: user.id, email: user.email!, firstName: user.first_name!, 
                  lastName: user.last_name!, phonePro: user.phone_pro || '', 
                  siret: user.siret || '', addressPro: user.address_pro || '', 
                  encryptionSalt: user.encryption_salt!, encryptionValidator: user.encryption_validator! 
              });
              await refreshProfile(userId);
              setAuthState('locked'); // Profil trouvé -> Ecran PIN
          } else {
              // User authentifié chez Supabase mais pas de profil dans 'practitioners'
              setTempEmail(email);
              setAuthState('registering'); // -> Redirection vers Wizard Completion
          }
      } catch (e) {
          console.error("Auth Load Error", e);
          setAuthState('unauthenticated');
      } finally {
          setIsLoading(false);
      }
  };

  const refreshProfile = async (userId?: string) => {
      const targetId = userId || userProfile.id;
      if (!targetId) return;
      
      const fullProfile = await SubscriptionService.getUserProfile(targetId);
      if (fullProfile) setUserProfile(fullProfile);
      
      // Abonnement Realtime aux crédits
      SubscriptionService.subscribeToCredits(targetId, (newCredits) => { 
          setUserProfile(prev => ({ ...prev, credits: newCredits })); 
      });
  };

  const unlockSession = (key: CryptoKey) => {
      setSessionKey(key);
      setAuthState('authenticated');
  };

  const lockSession = () => {
      setSessionKey(null);
      setAuthState('locked');
  };

  const logout = async () => {
      await supabase.auth.signOut();
      // Le state sera nettoyé par le listener onAuthStateChange
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
