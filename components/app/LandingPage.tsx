/**
 * LandingPage — public home page with the practitioner sign-in / sign-up modal,
 * the family portal entry and the demo entry.
 */

import React, { Suspense, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Mail, Sparkles, User, X } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import type { PractitionerProfile } from '../../types';
import type { AuthState } from '../../contexts/AuthContext';
import { supabase } from '../../services/db';
import { useToast } from '../../contexts/ToastContext';
import { AuthWizard } from '../auth/AuthWizard';
import { ThemeToggle } from '../shared/ThemeToggle';

import type { LegalTab } from '../../utils/legalLink';
const LegalModal = React.lazy(() => import('../shared/LegalModal').then((m) => ({ default: m.LegalModal })));

const TURNSTILE_SITE_KEY = (import.meta.env.VITE_SUPABASE_TURNSTILE_SITE_KEY || import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();

interface Props {
  authState: AuthState;
  tempEmail: string | null;
  /** The session is locked (PIN) or active: go straight to the app instead of the sign-in modal. */
  onEnterApp: () => void;
  onOpenPortal: () => void;
  onStartDemo: () => void;
  onWizardComplete: (profile: PractitionerProfile, key: CryptoKey) => Promise<void>;
}

type AuthModalMode = 'login' | 'register' | 'confirm_email';

const inputClass =
  'w-full p-4 bg-[var(--input-bg)] border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 rounded-2xl outline-none font-bold text-[var(--text-main)] transition-all';

export const LandingPage: React.FC<Props> = ({ authState, tempEmail, onEnterApp, onOpenPortal, onStartDemo, onWizardComplete }) => {
  const toast = useToast();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode>('login');
  const [pendingEmail, setPendingEmail] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [legalTab, setLegalTab] = useState<LegalTab | null>(null);

  // The wizard must open when the account exists but the PIN is not configured yet.
  useEffect(() => {
    if (authState === 'registering') setShowAuthModal(true);
    if (authState === 'locked' || authState === 'authenticated') setShowAuthModal(false);
    if (authState !== 'authenticating') setIsLoggingIn(false);
  }, [authState]);

  const closeModal = () => {
    setShowAuthModal(false);
    setAuthMode('login');
    setPendingEmail('');
    setCaptchaToken('');
  };

  const handleLogin = async (email: string, password: string) => {
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      toast.error('Veuillez compléter le CAPTCHA.');
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    setIsLoggingIn(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
      ...(TURNSTILE_SITE_KEY ? { options: { captchaToken } } : {}),
    });
    if (!error) return; // AuthContext takes over on SIGNED_IN
    if (/email not confirmed/i.test(error.message)) {
      setPendingEmail(normalizedEmail);
      setAuthMode('confirm_email');
    } else {
      if (TURNSTILE_SITE_KEY) {
        setCaptchaToken('');
        setCaptchaNonce((n) => n + 1);
      }
      toast.error(error.message);
    }
    setIsLoggingIn(false);
  };

  const handleWizardComplete = async (profile: PractitionerProfile, key: CryptoKey) => {
    // Close before reloading to avoid flashing the wizard while authState passes through 'authenticating'
    closeModal();
    await onWizardComplete(profile, key);
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      <div className="absolute top-6 right-6 z-10">
        <ThemeToggle />
      </div>
      <div className="absolute inset-0 bg-gradient-to-br from-[#E07A5F]/5 to-[#3D405B]/5 pointer-events-none" />
      <div className="text-center space-y-8 z-10 animate-in fade-in zoom-in-95 duration-700">
        <div className="flex justify-center">
          <div className="w-24 h-24 bg-[var(--card-bg)] rounded-[32px] shadow-xl shadow-[var(--shadow)] flex items-center justify-center text-[#E07A5F] transform rotate-3 transition-transform hover:rotate-0">
            <Sparkles size={48} fill="currentColor" className="text-[#E07A5F]/20" stroke="currentColor" />
            <Sparkles size={48} className="absolute text-[#E07A5F]" />
          </div>
        </div>
        <div>
          <h1 className="text-5xl md:text-7xl font-serif font-bold text-[var(--text-main)] mb-2">
            ErgoBilan<span className="text-[#E07A5F]">.</span>
          </h1>
          <p className="text-lg text-[var(--text-light)] font-medium">L'assistant clinique intelligent pour Ergothérapeutes.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-4 mt-8 justify-center">
          <button
            onClick={() => (authState === 'locked' ? onEnterApp() : setShowAuthModal(true))}
            className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center justify-center gap-2 group"
          >
            Accès Praticien <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </button>
          <button
            onClick={onOpenPortal}
            className="bg-[var(--card-bg)] text-[var(--text-main)] px-10 py-4 rounded-2xl font-bold shadow-md hover:shadow-lg border border-[var(--border-color)] hover:border-[#E07A5F]/30 transition-all flex items-center justify-center gap-2"
          >
            Espace Famille <User size={20} />
          </button>
        </div>
        <p className="mt-8 text-[var(--text-light)] text-sm">
          Pas encore de compte ?{' '}
          <button
            onClick={onStartDemo}
            className="font-bold text-[var(--text-main)] hover:text-[#E07A5F] underline underline-offset-2 transition-colors"
          >
            Explorer l'interface sans inscription
          </button>
        </p>
      </div>

      <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 text-[10px] text-[var(--text-disabled)] z-10">
        <button onClick={() => setLegalTab('cgu')} className="hover:text-[var(--text-secondary)] transition-colors">
          Conditions Générales
        </button>
        <span>·</span>
        <button onClick={() => setLegalTab('cgv')} className="hover:text-[var(--text-secondary)] transition-colors">
          Conditions de Vente
        </button>
        <span>·</span>
        <button onClick={() => setLegalTab('privacy')} className="hover:text-[var(--text-secondary)] transition-colors">
          Politique de Confidentialité
        </button>
        <span>·</span>
        <span>© {new Date().getFullYear()} ErgoBilan</span>
      </div>

      {legalTab && (
        <Suspense fallback={null}>
          <LegalModal initialTab={legalTab} onClose={() => setLegalTab(null)} />
        </Suspense>
      )}

      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-[#3D405B]/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          {authState === 'registering' || authMode === 'register' ? (
            <AuthWizard
              onCancel={closeModal}
              onComplete={handleWizardComplete}
              isProfileCompletion={authState === 'registering'}
              initialEmail={tempEmail || ''}
              onEmailConfirmationRequired={(email) => {
                setPendingEmail(email.trim().toLowerCase());
                setAuthMode('confirm_email');
              }}
            />
          ) : authMode === 'confirm_email' ? (
            <div className="bg-[var(--card-bg)] p-10 rounded-[40px] w-full max-w-md relative shadow-2xl border border-[var(--border-color)] animate-in zoom-in-95 duration-300">
              <button
                onClick={closeModal}
                className="absolute top-6 right-6 p-2 bg-[var(--hover-bg)] rounded-full hover:bg-[var(--border-color)] text-[var(--text-light)]"
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
              <div className="w-16 h-16 rounded-full bg-[#E07A5F]/10 text-[#E07A5F] flex items-center justify-center mx-auto mb-6">
                <Mail size={30} />
              </div>
              <div className="text-center space-y-3">
                <h2 className="text-3xl font-serif font-bold text-[var(--text-main)]">Confirmer le mail</h2>
                <p className="text-sm text-[var(--text-light)] font-medium">Confirmez votre adresse email puis reconnectez-vous.</p>
                {pendingEmail && (
                  <p className="text-xs text-[var(--text-secondary)] bg-[var(--card-bg-raised)] border border-[var(--border-color)] rounded-xl px-3 py-2">
                    Adresse : <span className="font-bold text-[var(--text-main)]">{pendingEmail}</span>
                  </p>
                )}
              </div>
              <div className="mt-8 flex flex-col gap-3">
                <button
                  onClick={() => setAuthMode('login')}
                  className="w-full py-3 bg-[#3D405B] text-white rounded-2xl font-bold shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] transition-all"
                >
                  J'ai confirmé, me connecter
                </button>
                <button
                  onClick={closeModal}
                  className="w-full py-3 rounded-2xl font-bold text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--hover-bg)] transition-all"
                >
                  Retour à l'accueil
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--card-bg)] p-10 rounded-[40px] w-full max-w-md relative shadow-2xl border border-[var(--border-color)] animate-in zoom-in-95 duration-300">
              <button
                onClick={closeModal}
                className="absolute top-6 right-6 p-2 bg-[var(--hover-bg)] rounded-full hover:bg-[var(--border-color)] text-[var(--text-light)]"
                aria-label="Fermer"
              >
                <X size={20} />
              </button>
              <div className="text-center mb-8">
                <h2 className="text-3xl font-serif font-bold text-[var(--text-main)]">Connexion</h2>
                <p className="text-[var(--text-light)] text-sm font-medium mt-1">Heureux de vous revoir.</p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void handleLogin(String(fd.get('email') ?? ''), String(fd.get('pass') ?? ''));
                }}
                className="space-y-5"
              >
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-light)] uppercase tracking-wider ml-2">Email</label>
                  <input name="email" type="email" placeholder="votre@email.com" className={inputClass} required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[var(--text-light)] uppercase tracking-wider ml-2">Mot de passe</label>
                  <input name="pass" type="password" placeholder="••••••••" className={inputClass} required />
                </div>
                {TURNSTILE_SITE_KEY && (
                  <div className="mt-4 flex justify-center">
                    <Turnstile
                      key={`turnstile-${captchaNonce}`}
                      siteKey={TURNSTILE_SITE_KEY}
                      onSuccess={setCaptchaToken}
                      onError={() => setCaptchaToken('')}
                      onExpire={() => setCaptchaToken('')}
                    />
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full py-4 bg-[#3D405B] text-white rounded-2xl font-bold text-lg shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] hover:shadow-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-70 mt-4"
                >
                  {isLoggingIn ? <Loader2 size={24} className="animate-spin" /> : 'Se connecter'}
                </button>
              </form>
              <div className="mt-8 text-center pt-6 border-t border-[var(--border-color)]">
                <p className="text-xs text-[var(--text-light)] font-medium mb-2">Pas encore de compte ?</p>
                <button
                  onClick={() => {
                    setAuthMode('register');
                    setPendingEmail('');
                    setCaptchaToken('');
                  }}
                  className="text-[#E07A5F] font-bold hover:underline"
                >
                  Créer un compte praticien
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
