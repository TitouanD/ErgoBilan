
import React, { useState, useEffect } from 'react';
import { User, Lock, Mail, Phone, MapPin, Building, ArrowRight, Check, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { setupPin } from '../../utils/crypto';
import { PractitionerProfile } from '../../types';
import { supabase } from '../../services/db';

interface Props {
    onComplete: (profile: PractitionerProfile, key: CryptoKey) => void;
    onCancel: () => void;
    isProfileCompletion?: boolean; // NOUVEAU: Mode complétion
    initialEmail?: string;         // NOUVEAU: Email pré-rempli
}

export const AuthWizard: React.FC<Props> = ({ onComplete, onCancel, isProfileCompletion = false, initialEmail = '' }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    
    // Form Data
    const [formData, setFormData] = useState({
        firstName: '', lastName: '', email: initialEmail,
        phone: '', siret: '', address: '',
        password: '', confirmPassword: '',
        pin: '', confirmPin: ''
    });

    const [showPassword, setShowPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Si on est en mode complétion, l'email est figé
    useEffect(() => {
        if (initialEmail) setFormData(prev => ({ ...prev, email: initialEmail }));
    }, [initialEmail]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleStep1Submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.firstName.trim() || !formData.lastName.trim()) {
            alert("Veuillez renseigner votre nom et prénom.");
            return;
        }
        // Validation Email basique
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.email)) {
            alert("Veuillez entrer une adresse email valide.");
            return;
        }
        
        // Si complétion de profil (utilisateur déjà loggé), on saute l'étape Mot de Passe (Step 2)
        if (isProfileCompletion) {
            setStep(3);
        } else {
            setStep(2);
        }
    };

    const handleStep2Submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.password.length < 6) {
            alert("Le mot de passe doit contenir au moins 6 caractères.");
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            alert("Les mots de passe ne correspondent pas.");
            return;
        }
        setStep(3);
    };

    const handleFinalSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (formData.pin.length !== 6) {
            alert("Le PIN doit faire exactement 6 chiffres.");
            return;
        }
        if (formData.pin !== formData.confirmPin) {
            alert("Les codes PIN ne correspondent pas.");
            return;
        }

        setIsSubmitting(true);
        try {
            let userId = '';

            if (isProfileCompletion) {
                // Mode Complétion : On récupère l'utilisateur déjà connecté
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error("Session perdue. Veuillez vous reconnecter.");
                userId = user.id;
            } else {
                // Mode Inscription : On crée le compte Auth
                const { data: authData, error: authError } = await supabase.auth.signUp({
                    email: formData.email,
                    password: formData.password,
                });
                
                if (authError) throw authError;
                
                // Si l'utilisateur existe déjà mais n'est pas confirmé ou autre cas
                if (!authData.user) {
                    // Cas rare : user null sans erreur (peut arriver si confirm email requis et rate limit silencieux ?)
                    throw new Error("L'inscription a échoué. L'utilisateur existe peut-être déjà.");
                }
                
                userId = authData.user.id;
            }

            // 2. Crypto Setup (PIN) - Génération des clés
            const { key, salt, validator } = await setupPin(formData.pin);

            // 3. Création Profil dans la table 'practitioners'
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

            const { error: dbError } = await supabase.from('practitioners').insert({
                id: newPractitioner.id,
                email: newPractitioner.email,
                first_name: newPractitioner.firstName,
                last_name: newPractitioner.lastName,
                phone_pro: newPractitioner.phonePro || '',
                siret: newPractitioner.siret || '',
                address_pro: newPractitioner.addressPro || '',
                encryption_salt: newPractitioner.encryptionSalt,
                encryption_validator: newPractitioner.encryptionValidator
            });

            if (dbError) throw dbError;

            // 4. Callback Succès
            onComplete(newPractitioner, key);

        } catch (e: any) {
            console.error("Erreur inscription/complétion", e);
            let msg = e.message || "Une erreur est survenue.";
            
            // Traduction des erreurs Supabase courantes
            if (msg.includes("Password should be at least")) msg = "Le mot de passe est trop court (min 6 caractères).";
            if (msg.includes("Email address") && msg.includes("invalid")) msg = "L'adresse email est invalide ou non autorisée.";
            if (msg.includes("already registered") || msg.includes("unique")) msg = "Cette adresse email est déjà utilisée. Essayez de vous connecter.";
            if (msg.includes("security purposes") && msg.includes("after")) msg = "Trop de tentatives. Veuillez attendre une minute avant de réessayer.";
            if (msg.includes("Rate limit exceeded")) msg = "Trop de requêtes. Veuillez patienter.";

            alert("Erreur : " + msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-[#3D405B]/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="bg-stone-50 p-8 border-b border-stone-100">
                    <h2 className="font-serif font-bold text-2xl text-[#3D405B] mb-6">
                        {isProfileCompletion ? "Finalisation du Profil" : "Création de compte Cloud"}
                    </h2>
                    
                    {/* Indicateur d'étape adaptatif */}
                    <div className="flex justify-between items-center relative">
                        <div className="absolute top-1/2 left-0 w-full h-1 bg-stone-200 -z-0"></div>
                        
                        {/* Etape 1 */}
                        <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step >= 1 ? 'bg-[#E07A5F] text-white' : 'bg-stone-200 text-stone-400'}`}>1</div>
                        
                        {/* Etape 2 (Masquée ou Grisée en mode complétion car sautée) */}
                        {!isProfileCompletion && (
                            <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step >= 2 ? 'bg-[#E07A5F] text-white' : 'bg-stone-200 text-stone-400'}`}>2</div>
                        )}
                        
                        {/* Etape 3 (Devient la 2ème étape visuelle en mode complétion) */}
                        <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${step >= 3 ? 'bg-[#E07A5F] text-white' : 'bg-stone-200 text-stone-400'}`}>
                            {isProfileCompletion ? '2' : '3'}
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                    {step === 1 && (
                        <form onSubmit={handleStep1Submit} className="space-y-5 animate-in slide-in-from-right duration-300">
                            {isProfileCompletion && (
                                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4 rounded-r-lg">
                                    <p className="text-xs text-amber-700 font-bold">
                                        Compte Auth détecté. Veuillez configurer votre profil praticien et votre code PIN sécurisé.
                                    </p>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-stone-400 uppercase ml-1">Prénom</label>
                                    <input required name="firstName" value={formData.firstName} onChange={handleChange} className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] font-bold text-[#3D405B]" placeholder="Jean" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-stone-400 uppercase ml-1">Nom</label>
                                    <input required name="lastName" value={formData.lastName} onChange={handleChange} className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] font-bold text-[#3D405B]" placeholder="Dupont" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-stone-400 uppercase ml-1">Email Pro</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-300" size={18} />
                                    <input 
                                        required 
                                        type="email" 
                                        name="email" 
                                        value={formData.email} 
                                        onChange={handleChange} 
                                        disabled={isProfileCompletion} // Bloqué si déjà loggé
                                        className={`w-full pl-10 p-3 rounded-xl border outline-none font-medium text-[#3D405B] ${isProfileCompletion ? 'bg-stone-100 border-stone-200 text-stone-500 cursor-not-allowed' : 'bg-stone-50 border-stone-200 focus:border-[#E07A5F]'}`} 
                                        placeholder="jean.dupont@ergo.com" 
                                    />
                                </div>
                            </div>
                            <div className="flex justify-between items-center pt-4">
                                <button type="button" onClick={onCancel} className="text-stone-400 font-bold hover:text-stone-600 text-sm">Annuler</button>
                                <button type="submit" className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center gap-2">
                                    Suivant <ArrowRight size={18}/>
                                </button>
                            </div>
                        </form>
                    )}

                    {step === 2 && !isProfileCompletion && (
                        <form onSubmit={handleStep2Submit} className="space-y-6 animate-in slide-in-from-right duration-300">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-stone-400 uppercase ml-1">Mot de passe</label>
                                    <div className="relative">
                                        <input required type={showPassword ? "text" : "password"} name="password" value={formData.password} onChange={handleChange} className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] font-bold text-[#3D405B]" placeholder="••••••••" />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-[#E07A5F]">
                                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-stone-400 ml-1 mt-1">Minimum 6 caractères.</p>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-stone-400 uppercase ml-1">Confirmer Mot de passe</label>
                                    <input required type="password" name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} className="w-full p-3 bg-stone-50 rounded-xl border border-stone-200 outline-none focus:border-[#E07A5F] font-bold text-[#3D405B]" placeholder="••••••••" />
                                </div>
                            </div>
                            <div className="flex justify-between items-center pt-4">
                                <button type="button" onClick={() => setStep(1)} className="text-stone-400 font-bold hover:text-stone-600 text-sm">Retour</button>
                                <button type="submit" className="bg-[#3D405B] text-white px-8 py-3 rounded-xl font-bold shadow-lg hover:bg-[#2c2e42] transition-all flex items-center gap-2">Suivant <ArrowRight size={18}/></button>
                            </div>
                        </form>
                    )}

                    {step === 3 && (
                        <form onSubmit={handleFinalSubmit} className="space-y-6 animate-in slide-in-from-right duration-300">
                            <div className="bg-[#F9F9F9] p-6 rounded-2xl border border-stone-200 text-center">
                                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm border border-stone-100">
                                    <ShieldCheck size={32} className="text-[#E07A5F]" />
                                </div>
                                <h3 className="font-bold text-[#3D405B] text-lg mb-2">Code PIN de Déchiffrement</h3>
                                <p className="text-sm text-stone-500 leading-relaxed mb-4">
                                    Définissez un code PIN à 6 chiffres. Ce code servira de clé unique pour lire vos dossiers.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="text-xs font-bold text-stone-400 uppercase ml-1 block text-center mb-2">Code PIN</label>
                                    <input required type="password" inputMode="numeric" maxLength={6} name="pin" value={formData.pin} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-xl border-2 border-stone-200 outline-none focus:border-[#E07A5F] font-mono text-2xl text-center tracking-[0.5em] text-[#3D405B]" placeholder="••••••" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-stone-400 uppercase ml-1 block text-center mb-2">Confirmer PIN</label>
                                    <input required type="password" inputMode="numeric" maxLength={6} name="confirmPin" value={formData.confirmPin} onChange={handleChange} className="w-full p-4 bg-stone-50 rounded-xl border-2 border-stone-200 outline-none focus:border-[#E07A5F] font-mono text-2xl text-center tracking-[0.5em] text-[#3D405B]" placeholder="••••••" />
                                </div>
                            </div>

                            <div className="flex justify-between items-center pt-8">
                                <button type="button" onClick={() => setStep(isProfileCompletion ? 1 : 2)} className="text-stone-400 font-bold hover:text-stone-600 text-sm">Retour</button>
                                <button type="submit" disabled={isSubmitting} className="bg-[#E07A5F] text-white px-10 py-4 rounded-xl font-bold shadow-xl shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all flex items-center gap-2 disabled:opacity-50">
                                    {isSubmitting ? "Création..." : "Terminer et Accéder"} <Check size={20} strokeWidth={3}/>
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};
