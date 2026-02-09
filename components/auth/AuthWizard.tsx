
import React, { useState, useEffect } from 'react';
import { User, Lock, Mail, Phone, MapPin, Building, ArrowRight, Check, ShieldCheck, Eye, EyeOff, Loader2 } from 'lucide-react';
import { setupPin, generateSymetricKey, wrapKey } from '../../utils/crypto';
import { PractitionerProfile } from '../../types';
import { supabase } from '../../services/db';
import { Logger } from '../../utils/logger';
import { useToast } from '../../contexts/ToastContext';

interface Props {
    onComplete: (profile: PractitionerProfile, key: CryptoKey) => void;
    onCancel: () => void;
    isProfileCompletion?: boolean; 
    initialEmail?: string;         
}

export const AuthWizard: React.FC<Props> = ({ onComplete, onCancel, isProfileCompletion = false, initialEmail = '' }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const toast = useToast();
    
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

    useEffect(() => {
        if (initialEmail) setFormData(prev => ({ ...prev, email: initialEmail }));
    }, [initialEmail]);

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

    /**
     * SÉCURISATION MAXIMALE DE L'INSCRIPTION (Optimistic Update Loop)
     * 1. On crée le user Auth.
     * 2. On génère les clés locales.
     * 3. On tente de mettre à jour la ligne 'practitioners' en boucle jusqu'à ce que le Trigger l'ait créée.
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

        setIsSubmitting(true);
        setStatusMessage("Initialisation sécurisée...");
        Logger.info('AUTH', "Starting Robust Registration Process");

        try {
            let userId = '';

            // --- ÉTAPE 1 : AUTHENTIFICATION ---
            if (isProfileCompletion) {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error("Session perdue. Veuillez vous reconnecter.");
                userId = user.id;
            } else {
                setStatusMessage("Création du compte utilisateur...");
                const { data: signupData, error: signupError } = await supabase.functions.invoke('signup', {
                    body: { email: formData.email, password: formData.password }
                });

                if (signupError) throw signupError;
                if (!signupData?.user) throw new Error("Échec de création du compte Auth.");

                // If email confirmation is required, no session is returned.
                // Stop here and ask the user to confirm before continuing.
                if (!signupData?.session) {
                    Logger.warn('AUTH', 'Sign-up completed without session. Awaiting email confirmation.');
                    toast.info("Compte créé. Vérifiez votre email pour confirmer, puis reconnectez-vous.");
                    return;
                }

                if (signupData.session?.access_token && signupData.session?.refresh_token) {
                    await supabase.auth.setSession({
                        access_token: signupData.session.access_token,
                        refresh_token: signupData.session.refresh_token
                    });
                }

                userId = signupData.user.id;
            }

            // --- ÉTAPE 2 : GÉNÉRATION DES CLÉS (Client-Side) ---
            setStatusMessage("Génération des clés de chiffrement...");
            const { key: masterKey, salt, validator } = await setupPin(formData.pin);
            const orgKey = await generateSymetricKey();
            const wrappedOrgKey = await wrapKey(orgKey, masterKey);
            const wrappedOrgKeyStr = `${wrappedOrgKey.iv}:${wrappedOrgKey.content}`;

            // --- ÉTAPE 3 : CRÉATION / MISE À JOUR ROBUSTE (Profil Praticien) ---
            setStatusMessage("Synchronisation avec la base de données...");

            const practitionerPayload = {
                id: userId,
                email: formData.email,
                first_name: formData.firstName,
                last_name: formData.lastName,
                phone_pro: formData.phone || '',
                siret: formData.siret || '',
                address_pro: formData.address || '',
                encryption_salt: salt,
                encryption_validator: validator
            };

            let profileUpdated = false;
            for (let i = 0; i < 5; i++) {
                const { data, error } = await supabase
                    .from('practitioners')
                    .upsert(practitionerPayload, { onConflict: 'id' })
                    .select();

                if (error) {
                    Logger.warn('AUTH', `Tentative Upsert Practitioner ${i + 1}/5 échouée:`, error.message);
                } else if (data && data.length > 0) {
                    profileUpdated = true;
                    Logger.info('AUTH', "Practitioner profile upserted successfully.");
                    break;
                }

                await new Promise(r => setTimeout(r, 1000));
            }

            if (!profileUpdated) {
                throw new Error("Délai d'attente dépassé : La création ou mise à jour du profil a échoué. Veuillez contacter le support.");
            }

            // --- ÉTAPE 4 : CRÉATION / MISE À JOUR ROBUSTE (Membre Organisation + Subscription) ---
            setStatusMessage("Configuration des clés du cabinet...");

            // Always call bootstrap to ensure org + membership + subscription exist
            const { data: bootstrappedOrgId, error: bootstrapError } = await supabase
                .rpc('bootstrap_org_for_user', { p_user_id: userId, p_org_name: 'Mon Cabinet' });

            if (bootstrapError) {
                Logger.warn('AUTH', 'Bootstrap RPC failed, trying fallback...', bootstrapError.message);
            }

            const orgId = bootstrappedOrgId || null;

            if (!orgId) {
                throw new Error('Failed to create or retrieve organization.');
            }

            {
                const { error: memberUpdateError } = await supabase
                    .from('organization_members')
                    .update({ encrypted_org_key: wrappedOrgKeyStr })
                    .eq('user_id', userId);

                if (memberUpdateError) throw memberUpdateError;
            }

            // --- SUCCÈS ---
            setStatusMessage("Terminé !");
            Logger.info('AUTH', "Registration flow completed.");
            
            const newPractitioner: PractitionerProfile = {
                id: userId, 
                email: formData.email,
                firstName: formData.firstName,
                lastName: formData.lastName,
                phonePro: formData.phone,
                siret: formData.siret,
                addressPro: formData.address,
                encryptionSalt: salt,
                encryptionValidator: validator
            };

            onComplete(newPractitioner, masterKey);

        } catch (e: unknown) {
            Logger.error('AUTH', "Registration Error", e);
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
            <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-stone-50 p-8 border-b border-stone-100">
                    <h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-6">
                        {isProfileCompletion ? "Finalisation du Profil" : "Création de compte"}
                    </h2>
                    
                    <div className="flex justify-between items-center relative px-4">
                        <div className="absolute top-1/2 left-0 w-full h-1 bg-stone-200 -z-0"></div>
                        <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${step >= 1 ? 'bg-[#E07A5F] text-white shadow-orange-200' : 'bg-stone-200 text-stone-400'}`}>1</div>
                        {!isProfileCompletion && (
                            <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${step >= 2 ? 'bg-[#E07A5F] text-white shadow-orange-200' : 'bg-stone-200 text-stone-400'}`}>2</div>
                        )}
                        <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all shadow-sm ${step >= 3 ? 'bg-[#E07A5F] text-white shadow-orange-200' : 'bg-stone-200 text-stone-400'}`}>
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
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Prénom</label>
                                    <input required name="firstName" value={formData.firstName} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="Jean" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Nom</label>
                                    <input required name="lastName" value={formData.lastName} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="Dupont" />
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Email Pro</label>
                                <div className="relative">
                                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300" size={20} />
                                    <input 
                                        required 
                                        type="email" 
                                        name="email" 
                                        value={formData.email} 
                                        onChange={handleChange} 
                                        disabled={isProfileCompletion} 
                                        className={`w-full pl-12 p-4 rounded-2xl border outline-none font-bold text-[#3D405B] transition-all ${isProfileCompletion ? 'bg-stone-100 border-stone-200 text-stone-500 cursor-not-allowed' : 'bg-stone-50 border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10'}`} 
                                        placeholder="jean.dupont@ergo.com" 
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Téléphone Pro</label>
                                    <div className="relative">
                                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300" size={20} />
                                        <input name="phone" value={formData.phone} onChange={handleChange} className="w-full pl-12 p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="06..." />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">SIRET (Optionnel)</label>
                                    <div className="relative">
                                        <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300" size={20} />
                                        <input name="siret" value={formData.siret} onChange={handleChange} className="w-full pl-12 p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="123 456 789..." />
                                    </div>
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Adresse Cabinet</label>
                                <div className="relative">
                                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-300" size={20} />
                                    <input name="address" value={formData.address} onChange={handleChange} className="w-full pl-12 p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="10 Rue de la Santé, 75000 Paris" />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-4">
                                <button type="button" onClick={onCancel} className="text-stone-400 font-bold hover:text-stone-600 text-sm px-4">Annuler</button>
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
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Mot de passe</label>
                                    <div className="relative">
                                        <input required type={showPassword ? "text" : "password"} name="password" value={formData.password} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="••••••••" />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 hover:text-[#E07A5F]">
                                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-stone-400 ml-2 mt-1">Minimum 6 caractères.</p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-2 tracking-wider">Confirmer Mot de passe</label>
                                    <input required type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-2xl border border-transparent focus:bg-white focus:border-[#E07A5F] focus:ring-4 focus:ring-[#E07A5F]/10 outline-none font-bold text-[#3D405B] transition-all" placeholder="••••••••" />
                                </div>
                            </div>
                            <div className="flex justify-between items-center pt-8">
                                <button type="button" onClick={() => setStep(1)} className="text-stone-400 font-bold hover:text-stone-600 text-sm px-4">Retour</button>
                                <button type="submit" className="bg-[#3D405B] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-[#3D405B]/20 hover:bg-[#2c2e42] transition-all flex items-center gap-2">Suivant <ArrowRight size={20}/></button>
                            </div>
                        </form>
                    )}

                    {step === 3 && (
                        <form onSubmit={handleFinalSubmit} className="space-y-8 animate-in slide-in-from-right duration-300">
                            <div className="bg-[#F9F9F9] p-8 rounded-2xl border border-stone-200 text-center">
                                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-stone-100">
                                    <ShieldCheck size={32} className="text-[#E07A5F]" />
                                </div>
                                <h3 className="font-bold text-[#3D405B] text-lg mb-2">Code PIN de Déchiffrement</h3>
                                <p className="text-sm text-stone-500 leading-relaxed mb-4 max-w-xs mx-auto">
                                    Définissez un code PIN à 6 chiffres. Ce code servira de clé unique pour lire vos dossiers.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-1 block text-center mb-2 tracking-wider">Code PIN</label>
                                    <input required type="password" inputMode="numeric" maxLength={6} name="pin" value={formData.pin} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-2xl border-2 border-stone-200 outline-none focus:border-[#E07A5F] font-mono text-2xl text-center tracking-[0.5em] text-[#3D405B] focus:bg-white transition-all" placeholder="••••••" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-stone-400 uppercase ml-1 block text-center mb-2 tracking-wider">Confirmer PIN</label>
                                    <input required type="password" inputMode="numeric" maxLength={6} name="confirmPin" value={formData.confirmPin} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-2xl border-2 border-stone-200 outline-none focus:border-[#E07A5F] font-mono text-2xl text-center tracking-[0.5em] text-[#3D405B] focus:bg-white transition-all" placeholder="••••••" />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-4">
                                <button type="button" onClick={() => setStep(isProfileCompletion ? 1 : 2)} className="text-stone-400 font-bold hover:text-stone-600 text-sm px-4">Retour</button>
                                <button type="submit" disabled={isSubmitting} className="bg-[#E07A5F] text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center gap-2 disabled:opacity-50">
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
