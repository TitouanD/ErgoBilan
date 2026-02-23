
import React, { useState, useEffect } from 'react';
import { User, Lock, Mail, Phone, MapPin, Building, ArrowRight, Check, ShieldCheck, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import { setupPin, generateSymetricKey, wrapKey } from '../../utils/crypto';
import type { PractitionerProfile } from '../../types';
import { supabase } from '../../services/db';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

const SIGNUP_DRAFT_STORAGE_KEY = 'ergobilan.signupDraft';

type SignupDraft = {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    siret: string;
    address: string;
};

const readSignupDraft = (): SignupDraft | null => {
    try {
        const raw = window.localStorage.getItem(SIGNUP_DRAFT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SignupDraft>;
        return {
            firstName: typeof parsed.firstName === 'string' ? parsed.firstName : '',
            lastName: typeof parsed.lastName === 'string' ? parsed.lastName : '',
            email: typeof parsed.email === 'string' ? parsed.email : '',
            phone: typeof parsed.phone === 'string' ? parsed.phone : '',
            siret: typeof parsed.siret === 'string' ? parsed.siret : '',
            address: typeof parsed.address === 'string' ? parsed.address : '',
        };
    } catch {
        return null;
    }
};

const writeSignupDraft = (draft: SignupDraft) => {
    try {
        window.localStorage.setItem(SIGNUP_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
        // Ignore storage failures.
    }
};

const clearSignupDraft = () => {
    try {
        window.localStorage.removeItem(SIGNUP_DRAFT_STORAGE_KEY);
    } catch {
        // Ignore storage failures.
    }
};

interface Props {
    onComplete: (profile: PractitionerProfile, key: CryptoKey) => void;
    onCancel: () => void;
    isProfileCompletion?: boolean; 
    initialEmail?: string;
    onEmailConfirmationRequired?: (email: string) => void;
}

export const AuthWizard: React.FC<Props> = ({ onComplete, onCancel, isProfileCompletion = false, initialEmail = '', onEmailConfirmationRequired }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const toast = useToast();
    const { setWizardActive } = useAuth();
    const turnstileSiteKey = (import.meta.env.VITE_SUPABASE_TURNSTILE_SITE_KEY || import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
    const shouldUseCaptcha = !isProfileCompletion && turnstileSiteKey.length > 0;
    
    // Form Data
    const [formData, setFormData] = useState({
        firstName: '', lastName: '', email: initialEmail,
        phone: '', siret: '', address: '',
        password: '', confirmPassword: '',
        pin: '', confirmPin: ''
    });

    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState("");
    const [captchaToken, setCaptchaToken] = useState('');
    const [captchaResetNonce, setCaptchaResetNonce] = useState(0);

    useEffect(() => {
        if (initialEmail) setFormData(prev => ({ ...prev, email: initialEmail }));
    }, [initialEmail]);

    useEffect(() => {
        const draft = readSignupDraft();
        if (!draft) return;

        const initialEmailNormalized = initialEmail.trim().toLowerCase();
        const draftEmailNormalized = draft.email.trim().toLowerCase();
        const emailMatches = !initialEmailNormalized || !draftEmailNormalized || initialEmailNormalized === draftEmailNormalized;

        if (!emailMatches) return;

        setFormData(prev => ({
            ...prev,
            firstName: draft.firstName || prev.firstName,
            lastName: draft.lastName || prev.lastName,
            email: initialEmail || draft.email || prev.email,
            phone: draft.phone || prev.phone,
            siret: draft.siret || prev.siret,
            address: draft.address || prev.address,
        }));
    }, [initialEmail]);

    useEffect(() => {
        const hasAnyProfessionalField = [
            formData.firstName,
            formData.lastName,
            formData.email,
            formData.phone,
            formData.siret,
            formData.address,
        ].some((value) => value.trim().length > 0);

        if (!hasAnyProfessionalField) return;

        writeSignupDraft({
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email,
            phone: formData.phone,
            siret: formData.siret,
            address: formData.address,
        });
    }, [formData.firstName, formData.lastName, formData.email, formData.phone, formData.siret, formData.address]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleStep1Submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.firstName.trim() || !formData.lastName.trim()) {
            toast.error("Veuillez renseigner votre nom et prénom.");
            return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.email)) {
            toast.error("Veuillez entrer une adresse email valide.");
            return;
        }
        
        if (isProfileCompletion) {
            setStep(3);
        } else {
            setStep(2);
        }
    };

    const handleStep2Submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.password.length < 8) {
            toast.error("Le mot de passe doit contenir au moins 8 caractères.");
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            toast.error("Les mots de passe ne correspondent pas.");
            return;
        }
        setStep(3);
    };

    const parseInvokeErrorMessage = (invokeError: unknown, fallback: string) => {
        const errorWithContext = invokeError as { message?: string; context?: { body?: unknown } };
        const contextBody = errorWithContext?.context?.body;
        if (contextBody) {
            try {
                const parsed = typeof contextBody === 'string' ? JSON.parse(contextBody) : contextBody;
                const parsedMessage = (parsed as { message?: string; error?: string })?.message
                    || (parsed as { message?: string; error?: string })?.error;
                if (parsedMessage) return parsedMessage;
            } catch {
                if (typeof contextBody === 'string') return contextBody;
            }
        }
        return errorWithContext?.message || fallback;
    };

    /**
     * Flow:
     * 1. Supabase Auth signUp/signIn context.
     * 2. Local PIN/key generation.
     * 3. Authenticated signup edge onboarding (practitioner/org/subscription setup).
     */
    const handleFinalSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.pin.length !== 6) {
            toast.error("Le PIN doit faire exactement 6 chiffres.");
            return;
        }
        if (formData.pin !== formData.confirmPin) {
            toast.error("Les codes PIN ne correspondent pas.");
            return;
        }
        if (shouldUseCaptcha && !captchaToken) {
            toast.error("Veuillez compléter le CAPTCHA avant de continuer.");
            return;
        }

        setIsSubmitting(true);
        setStatusMessage("Initialisation sécurisée...");
        Logger.info('AUTH', "Starting registration/onboarding process");

        try {
            let userId = '';
            const professionalEmail = formData.email.trim().toLowerCase();

            // --- ÉTAPE 1 : AUTHENTIFICATION ---
            if (isProfileCompletion) {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error("Session perdue. Veuillez vous reconnecter.");
                userId = user.id;
            } else {
                setStatusMessage("Création du compte utilisateur...");
                // CRITICAL: activer le lock AVANT signUp pour éviter onAuthStateChange
                // pendant que le profil/PIN n'est pas encore initialisé.
                setWizardActive(true);

                const signUpPayload = shouldUseCaptcha
                    ? {
                        email: formData.email.trim(),
                        password: formData.password,
                        options: { captchaToken }
                    }
                    : {
                        email: formData.email.trim(),
                        password: formData.password
                    };

                const { data: signUpData, error: signUpError } = await supabase.auth.signUp(signUpPayload);

                if (signUpError) {
                    const signUpMessage = signUpError.message || "Erreur d'inscription. Veuillez réessayer.";
                    if (!shouldUseCaptcha && /captcha|turnstile|hcaptcha/i.test(signUpMessage)) {
                        throw new Error("Le CAPTCHA Supabase semble activé. Configurez VITE_SUPABASE_TURNSTILE_SITE_KEY côté frontend.");
                    }
                    if (shouldUseCaptcha) {
                        setCaptchaToken('');
                        setCaptchaResetNonce(prev => prev + 1);
                    }
                    throw new Error(signUpMessage);
                }

                if (!signUpData?.user) {
                    throw new Error("Échec de création du compte Auth.");
                }

                userId = signUpData.user.id;

                // If email confirmation is required, no tokens are returned.
                // Stop here and ask the user to confirm before continuing.
                if (!signUpData.session) {
                    Logger.warn('AUTH', 'Sign-up completed without session. Awaiting email confirmation.');
                    setWizardActive(false);
                    if (onEmailConfirmationRequired) {
                        onEmailConfirmationRequired(professionalEmail);
                    } else {
                        toast.info("Compte créé. Vérifiez votre email pour confirmer, puis reconnectez-vous.");
                        onCancel();
                    }
                    return;
                }

                const { error: sessionError } = await supabase.auth.setSession({
                    access_token: signUpData.session.access_token,
                    refresh_token: signUpData.session.refresh_token
                });
                if (sessionError) throw sessionError;
            }

            // --- ÉTAPE 2 : GÉNÉRATION DES CLÉS (Client-Side) ---
            setStatusMessage("Génération des clés de chiffrement...");
            const { key: masterKey, salt, validator } = await setupPin(formData.pin);
            const orgKey = await generateSymetricKey();
            const wrappedOrgKey = await wrapKey(orgKey, masterKey);
            const wrappedOrgKeyStr = `${wrappedOrgKey.iv}:${wrappedOrgKey.content}`;

            // --- ÉTAPE 3 : ONBOARDING CÔTÉ EDGE (profil + org + subscription) ---
            setStatusMessage("Configuration du compte praticien...");

            const { data: onboardingData, error: onboardingError } = await supabase.functions.invoke('signup', {
                body: {
                    email: professionalEmail,
                    firstName: formData.firstName.trim(),
                    lastName: formData.lastName.trim(),
                    phone: formData.phone.trim(),
                    siret: formData.siret.trim(),
                    address: formData.address.trim(),
                    encryptionSalt: salt,
                    encryptionValidator: validator,
                    encryptedOrgKey: wrappedOrgKeyStr,
                    orgName: 'Mon Cabinet'
                }
            });

            if (onboardingError) {
                Logger.error('AUTH', 'Signup onboarding edge error', onboardingError);
                throw new Error(parseInvokeErrorMessage(onboardingError, "Erreur d'initialisation du compte."));
            }

            if (onboardingData?.ok === false) {
                throw new Error(onboardingData.message || "Initialisation du compte impossible.");
            }

            const onboardingPayload = onboardingData?.data || onboardingData;
            if (!onboardingPayload?.organization_id) {
                Logger.warn('AUTH', 'Onboarding completed without organization_id in payload.');
            }

            // --- SUCCÈS ---
            setStatusMessage("Terminé !");
            Logger.info('AUTH', "Registration flow completed.");
            
            const newPractitioner: PractitionerProfile = {
                id: userId, 
                email: professionalEmail,
                firstName: formData.firstName,
                lastName: formData.lastName,
                phonePro: formData.phone,
                siret: formData.siret,
                addressPro: formData.address,
                encryptionSalt: salt,
                encryptionValidator: validator
            };

            clearSignupDraft();
            onComplete(newPractitioner, masterKey);

        } catch (e: unknown) {
            Logger.error('AUTH', "Registration Error", e);
            // En cas d'erreur, libérer le lock pour permettre au flow normal de reprendre
            setWizardActive(false);
            let msg = e instanceof Error ? e.message : "Une erreur est survenue.";
            if (msg.includes("violates row-level security")) msg = "Erreur de sécurité DB. Vos droits ne sont pas encore actifs.";
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
            setStatusMessage("");
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-[#3D405B]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-[var(--card-bg)] w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-[var(--card-bg-raised)] p-8 border-b border-[var(--border-color)]">
                    <h2 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-6">
                        {isProfileCompletion ? "Finalisation du Profil" : "Création de compte"}
                    </h2>
                    
                    <div className="flex justify-between items-center relative px-4">
                        <div className="absolute top-1/2 left-0 w-full h-1 bg-[var(--border-color)] -z-0"></div>
                        <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${step >= 1 ? 'bg-[#E07A5F] text-white shadow-orange-200 dark:shadow-black/30' : 'bg-[var(--progress-bg)] text-[var(--text-secondary)]'}`}>1</div>
                        {!isProfileCompletion && (
                            <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${step >= 2 ? 'bg-[#E07A5F] text-white shadow-orange-200 dark:shadow-black/30' : 'bg-[var(--progress-bg)] text-[var(--text-secondary)]'}`}>2</div>
                        )}
                        <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${step >= 3 ? 'bg-[#E07A5F] text-white shadow-orange-200 dark:shadow-black/30' : 'bg-[var(--progress-bg)] text-[var(--text-secondary)]'}`}>
                            {isProfileCompletion ? '2' : '3'}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                    {step === 1 && (
                        <form onSubmit={handleStep1Submit} className="space-y-6 animate-in slide-in-from-right duration-300">
                            {isProfileCompletion && (
                                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4 rounded-r-lg">
                                    <p className="text-xs text-amber-700 font-bold">
                                        Compte authentifié détecté. Veuillez configurer vos informations professionnelles.
                                    </p>
                                </div>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Prénom</label>
                                    <input required name="firstName" value={formData.firstName} onChange={handleChange} className="w-full p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="Jean" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Nom</label>
                                    <input required name="lastName" value={formData.lastName} onChange={handleChange} className="w-full p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="Dupont" />
                                </div>
                            </div>
                            
                            <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Email Pro</label>
                                    <div className="relative">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={20} />
                                        <input 
                                            required 
                                            type="email" 
                                            name="email" 
                                            value={formData.email} 
                                            onChange={handleChange} 
                                            className="w-full pl-12 p-4 rounded-2xl border outline-none font-bold text-[var(--text-main)] transition-all bg-[var(--input-bg)] border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Téléphone Pro</label>
                                    <div className="relative">
                                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={20} />
                                        <input name="phone" value={formData.phone} onChange={handleChange} className="w-full pl-12 p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="06..." />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">SIRET (Optionnel)</label>
                                    <div className="relative">
                                        <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={20} />
                                        <input name="siret" value={formData.siret} onChange={handleChange} className="w-full pl-12 p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="123 456 789..." />
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Adresse Cabinet</label>
                                <div className="relative">
                                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-disabled)]" size={20} />
                                    <input name="address" value={formData.address} onChange={handleChange} className="w-full pl-12 p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="10 Rue de la Santé, 75000 Paris" />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-4">
                                <button type="button" onClick={onCancel} className="text-[var(--text-secondary)] font-bold hover:text-[var(--text-main)] text-sm px-4">Annuler</button>
                                <button type="submit" className="bg-[#3D405B] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] transition-all flex items-center gap-2">
                                    Suivant <ArrowRight size={20}/>
                                </button>
                            </div>
                        </form>
                    )}

                    {step === 2 && !isProfileCompletion && (
                        <form onSubmit={handleStep2Submit} className="space-y-6 animate-in slide-in-from-right duration-300">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Mot de passe</label>
                                    <div className="relative">
                                        <input required type={showPassword ? "text" : "password"} name="password" value={formData.password} onChange={handleChange} className="w-full p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="••••••••" />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[#E07A5F]">
                                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-[var(--text-secondary)] ml-2 mt-1">Minimum 8 caractères.</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-2 tracking-wider">Confirmer Mot de passe</label>
                                    <input required type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full p-4 bg-[var(--input-bg)] rounded-2xl border border-transparent focus:bg-[var(--card-bg)] focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[var(--text-main)] transition-all" placeholder="••••••••" />
                                </div>
                            </div>
                            <div className="flex justify-between items-center pt-8">
                                <button type="button" onClick={() => setStep(1)} className="text-[var(--text-secondary)] font-bold hover:text-[var(--text-main)] text-sm px-4">Retour</button>
                                <button type="submit" className="bg-[#3D405B] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] transition-all flex items-center gap-2">Suivant <ArrowRight size={20}/></button>
                            </div>
                        </form>
                    )}

                    {step === 3 && (
                        <form onSubmit={handleFinalSubmit} className="space-y-8 animate-in slide-in-from-right duration-300">
                            <div className="bg-[var(--card-bg-raised)] p-8 rounded-2xl border border-[var(--border-color)] text-center">
                                <div className="w-16 h-16 bg-[var(--card-bg)] rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-[var(--border-color)]">
                                    <ShieldCheck size={32} className="text-[#E07A5F]" />
                                </div>
                                <h3 className="font-bold text-[var(--text-heading)] text-lg mb-2">Code PIN de Déchiffrement</h3>
                                <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4 max-w-xs mx-auto">
                                    Définissez un code PIN à 6 chiffres. Ce code servira de clé unique pour lire vos dossiers.
                                </p>
                            </div>

                            {shouldUseCaptcha && (
                                <div className="bg-[var(--card-bg-raised)] p-6 rounded-2xl border border-[var(--border-color)]">
                                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                                        Vérification de sécurité
                                    </p>
                                    <Turnstile
                                        key={`turnstile-${captchaResetNonce}`}
                                        siteKey={turnstileSiteKey}
                                        onSuccess={(token) => setCaptchaToken(token)}
                                        onError={() => setCaptchaToken('')}
                                        onExpire={() => setCaptchaToken('')}
                                    />
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 block text-center mb-2 tracking-wider">Code PIN</label>
                                    <input required type="password" inputMode="numeric" maxLength={6} name="pin" value={formData.pin} onChange={handleChange} className="w-full p-4 bg-[var(--input-bg)] rounded-2xl border-2 border-[var(--input-border)] outline-none focus:border-[#E07A5F] font-mono text-2xl text-center tracking-[0.5em] text-[var(--text-main)] focus:bg-[var(--card-bg)] transition-all" placeholder="••••••" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase ml-1 block text-center mb-2 tracking-wider">Confirmer PIN</label>
                                    <input required type="password" inputMode="numeric" maxLength={6} name="confirmPin" value={formData.confirmPin} onChange={handleChange} className="w-full p-4 bg-[var(--input-bg)] rounded-2xl border-2 border-[var(--input-border)] outline-none focus:border-[#E07A5F] font-mono text-2xl text-center tracking-[0.5em] text-[var(--text-main)] focus:bg-[var(--card-bg)] transition-all" placeholder="••••••" />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-4">
                                <button type="button" onClick={() => setStep(isProfileCompletion ? 1 : 2)} className="text-[var(--text-secondary)] font-bold hover:text-[var(--text-main)] text-sm px-4">Retour</button>
                                <button type="submit" disabled={isSubmitting} className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 dark:shadow-black/30 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center gap-2 disabled:opacity-50">
                                    {isSubmitting ? <Loader2 size={20} className="animate-spin" /> : <Check size={20} strokeWidth={3}/>}
                                    {isSubmitting ? statusMessage : "Terminer et Accéder"}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

