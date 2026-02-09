
import React, { useState, useEffect } from 'react';
import { Check, Star, Clock, ArrowRight, Zap, ShieldCheck, FileText, Sparkles, Lock, Key, Copy, Share2, Database, Crown, Layout, LifeBuoy, Gift } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext'; // Import du contexte Auth

interface Props {
    onComplete: () => void;
}

export const OnboardingExperience: React.FC<Props> = ({ onComplete }) => {
    const { isDemoMode } = useAuth(); // Hook pour détecter le mode démo
    const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
    
    // Si on est en mode démo, on n'a que 3 étapes (Pas de cadeau de crédits)
    const maxSteps = isDemoMode ? 3 : 4;

    const handleNext = () => {
        if (step < maxSteps) {
            setStep(prev => (prev + 1) as any);
        } else {
            onComplete();
        }
    };
    
    return (
        <div className="fixed inset-0 z-[200] bg-white flex flex-col items-center justify-center animate-in fade-in duration-500 font-sans text-[#3D405B]">
            
            {/* PROGRESS BAR */}
            <div className="absolute top-0 left-0 w-full h-2 bg-stone-100">
                <div 
                    className="h-full bg-[#E07A5F] transition-all duration-700 ease-out"
                    style={{ width: `${(step / maxSteps) * 100}%` }}
                ></div>
            </div>

            <div className="w-full max-w-6xl px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center h-full lg:h-auto py-8 lg:py-0 overflow-y-auto lg:overflow-visible">
                
                {/* PARTIE VISUELLE (GAUCHE) */}
                <div className="hidden lg:flex flex-col items-center justify-center h-[600px] bg-stone-50 rounded-[40px] p-10 relative overflow-hidden shadow-inner order-2 lg:order-1">
                    <div className="absolute top-[-20%] left-[-20%] w-96 h-96 bg-[#E07A5F]/10 rounded-full blur-3xl"></div>
                    <div className="absolute bottom-[-20%] right-[-20%] w-96 h-96 bg-[#3D405B]/10 rounded-full blur-3xl"></div>
                    
                    {/* VISUEL ÉTAPE 1 : PROMESSE (Transformation) */}
                    {step === 1 && (
                        <div className="relative animate-in zoom-in-95 duration-700 flex flex-col items-center">
                            <div className="relative w-64 h-80">
                                {/* Carte Arrière (Scores) qui s'en va */}
                                <div className="absolute inset-0 bg-white border border-stone-200 shadow-lg rounded-2xl p-6 transform -rotate-6 opacity-60 scale-95 origin-bottom-left flex flex-col gap-3">
                                    <div className="flex justify-between">
                                        <div className="w-8 h-8 bg-stone-100 rounded"></div>
                                        <div className="w-16 h-4 bg-stone-100 rounded"></div>
                                    </div>
                                    <div className="space-y-2 mt-4">
                                        <div className="w-full h-2 bg-stone-100 rounded"></div>
                                        <div className="w-3/4 h-2 bg-stone-100 rounded"></div>
                                        <div className="w-1/2 h-2 bg-stone-100 rounded"></div>
                                    </div>
                                    <div className="mt-auto flex gap-2">
                                        <div className="w-8 h-8 bg-rose-100 rounded-full"></div>
                                        <div className="w-8 h-8 bg-amber-100 rounded-full"></div>
                                    </div>
                                </div>

                                {/* Carte Avant (Rédigée) qui arrive */}
                                <div className="absolute inset-0 bg-white border border-stone-100 shadow-2xl rounded-2xl p-6 transform rotate-3 flex flex-col z-10">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2 bg-[#E07A5F] text-white rounded-lg shadow-md shadow-orange-200">
                                            <Sparkles size={20} />
                                        </div>
                                        <div className="text-xs font-bold text-[#3D405B]">Rédaction IA</div>
                                    </div>
                                    <div className="space-y-3 flex-1">
                                        <div className="w-full h-2 bg-stone-100 rounded"></div>
                                        <div className="w-full h-2 bg-stone-100 rounded"></div>
                                        <div className="w-full h-2 bg-stone-100 rounded"></div>
                                        <div className="w-2/3 h-2 bg-stone-100 rounded"></div>
                                        <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg mt-2">
                                            <div className="w-full h-1.5 bg-emerald-200 rounded mb-1"></div>
                                            <div className="w-1/2 h-1.5 bg-emerald-200 rounded"></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Flèche de transformation */}
                                <div className="absolute top-1/2 -right-12 transform -translate-y-1/2 translate-x-1/2 z-20 bg-[#3D405B] text-white p-3 rounded-full shadow-xl">
                                    <ArrowRight size={24} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* VISUEL ÉTAPE 2 : SÉCURITÉ (Coffre-fort) */}
                    {step === 2 && (
                        <div className="relative animate-in slide-in-from-right duration-500 flex flex-col items-center">
                            <div className="w-64 h-64 bg-[#3D405B] rounded-[40px] shadow-2xl flex items-center justify-center relative border-4 border-[#4a4e69]">
                                <ShieldCheck size={100} className="text-[#81B29A]" />
                                <div className="absolute -bottom-6 -right-6 bg-white p-4 rounded-2xl shadow-lg border border-stone-100">
                                    <Lock size={32} className="text-[#E07A5F]" />
                                </div>
                            </div>
                            <div className="mt-8 flex items-center gap-3 bg-white px-4 py-2 rounded-full shadow-sm border border-stone-100">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                <span className="text-xs font-bold text-stone-500 uppercase tracking-widest">PIN 6 Chiffres = Clé unique</span>
                            </div>
                        </div>
                    )}

                    {/* VISUEL ÉTAPE 3 : COMMUNAUTÉ (Data) */}
                    {step === 3 && (
                        <div className="relative animate-in slide-in-from-right duration-500">
                            <div className="relative w-80 h-80">
                                {/* Central Node */}
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 bg-white rounded-full shadow-xl flex items-center justify-center z-20 border-4 border-[#E07A5F]">
                                    <Database size={40} className="text-[#3D405B]" />
                                </div>
                                
                                {/* Satellites */}
                                {[0, 72, 144, 216, 288].map((deg, i) => (
                                    <div 
                                        key={i}
                                        className="absolute w-12 h-12 bg-white rounded-full shadow-md flex items-center justify-center text-stone-400 border border-stone-100"
                                        style={{
                                            top: '50%',
                                            left: '50%',
                                            transform: `translate(-50%, -50%) rotate(${deg}deg) translate(120px) rotate(-${deg}deg)`
                                        }}
                                    >
                                        <FileText size={16} />
                                    </div>
                                ))}

                                {/* Connections */}
                                <svg className="absolute inset-0 w-full h-full pointer-events-none z-10 opacity-20">
                                    <circle cx="50%" cy="50%" r="120" stroke="#3D405B" strokeWidth="2" strokeDasharray="4 4" className="animate-spin-slow" />
                                </svg>
                            </div>
                            <div className="text-center mt-4">
                                {isDemoMode ? (
                                    <div className="inline-block bg-[#E07A5F] text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-orange-200">
                                        Données vérifiées
                                    </div>
                                ) : (
                                    <div className="inline-block bg-[#E07A5F] text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg shadow-orange-200">
                                        +1 Crédit / Contribution
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* VISUEL ÉTAPE 4 : LE CADEAU (3 Crédits) - SEULEMENT PROD */}
                    {step === 4 && (
                        <div className="relative animate-in slide-in-from-right duration-500 w-full max-w-md flex flex-col items-center">
                            <div className="relative">
                                {/* Effet de lueur */}
                                <div className="absolute inset-0 bg-[#E07A5F]/20 blur-2xl rounded-full"></div>
                                {/* Carte Cadeau */}
                                <div className="bg-white rounded-[32px] p-8 shadow-2xl border border-stone-100 relative z-10 w-80 text-center">
                                    <div className="w-20 h-20 bg-[#E07A5F] text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-orange-200 transform -rotate-6">
                                        <Gift size={40} />
                                    </div>
                                    <h3 className="font-serif font-bold text-2xl text-[#3D405B] mb-2">Offre de Bienvenue</h3>
                                    <div className="inline-block px-4 py-1 bg-stone-100 rounded-full text-xs font-bold text-stone-500 uppercase tracking-widest mb-6">
                                        Essai Gratuit
                                    </div>
                                    <div className="space-y-3 text-left">
                                        <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
                                            <div className="p-1.5 bg-white rounded-full shadow-sm text-[#E07A5F]"><Check size={14} strokeWidth={3}/></div>
                                            <span className="text-sm font-bold text-stone-600">3 Crédits Offerts</span>
                                        </div>
                                        <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-xl">
                                            <div className="p-1.5 bg-white rounded-full shadow-sm text-[#E07A5F]"><Check size={14} strokeWidth={3}/></div>
                                            <span className="text-sm font-bold text-stone-600">Valable 30 jours</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* PARTIE TEXTE & ACTIONS (DROITE) */}
                <div className="flex flex-col justify-center h-full order-1 lg:order-2">
                    
                    {/* --- ÉTAPE 1 : PROMESSE --- */}
                    {step === 1 && (
                        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="w-16 h-16 bg-[#3D405B] text-white rounded-2xl flex items-center justify-center shadow-xl shadow-[#3D405B]/20 mb-6">
                                <Sparkles size={32} />
                            </div>
                            
                            <h1 className="font-serif text-4xl md:text-5xl font-bold text-[#3D405B] leading-tight">
                                Votre demo clinique, en 3 minutes.
                            </h1>
                            
                            <p className="text-lg text-stone-500 leading-relaxed">
                                Importez un questionnaire, saisissez les tests, puis générez un bilan clair et structuré. Vous voyez tout, du calcul automatique au PDF final.
                            </p>

                            <div className="space-y-4 pt-4">
                                <div className="flex items-center gap-4 p-4 bg-white border border-stone-100 rounded-xl shadow-sm">
                                    <Clock className="text-[#81B29A]" size={24} />
                                    <div>
                                        <h4 className="font-bold text-[#3D405B]">Zero friction</h4>
                                        <p className="text-xs text-stone-400">Vous suivez un scenario complet, de l'anamnese au PDF.</p>
                                    </div>
                                </div>
                            </div>
                            
                            <button onClick={handleNext} className="w-full md:w-auto px-10 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-3 mt-4 group">
                                C'est parti <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform"/>
                            </button>
                        </div>
                    )}

                    {/* --- ÉTAPE 2 : SÉCURITÉ --- */}
                    {step === 2 && (
                        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                            <div className="w-16 h-16 bg-[#81B29A] text-white rounded-2xl flex items-center justify-center shadow-xl shadow-[#81B29A]/20 mb-6">
                                <Lock size={32} />
                            </div>

                            <h2 className="font-serif text-3xl md:text-4xl font-bold text-[#3D405B]">
                                Vous seul avez la clé.
                            </h2>
                            
                            <p className="text-stone-500 leading-relaxed">
                                Vos données patients sont chiffrées de bout en bout (E2EE). <strong className="text-[#3D405B]">Vous avez défini un code PIN à 6 chiffres</strong> qui servira de clé de déchiffrement unique.
                            </p>

                            <div className="bg-[#fffbfb] border border-stone-100 p-6 rounded-2xl shadow-inner">
                                <p className="text-sm font-medium text-stone-600 mb-2">
                                    <Key size={16} className="inline mr-2 text-[#E07A5F]" /> 
                                    Fonctionnement du coffre-fort :
                                </p>
                                <ul className="text-xs text-stone-500 space-y-2 ml-6 list-disc">
                                    <li>Votre mot de passe sert à vous connecter (Auth).</li>
                                    <li>Votre PIN sert à déverrouiller les données (Décryptage).</li>
                                    <li>Même nous ne pouvons pas lire vos bilans.</li>
                                </ul>
                            </div>

                            <button onClick={handleNext} className="w-full px-8 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-3">
                                <ShieldCheck size={20} /> J'ai compris
                            </button>
                        </div>
                    )}

                    {/* --- ÉTAPE 3 : COMMUNAUTÉ / BASE DE DONNÉES (Adapté Demo) --- */}
                    {step === 3 && (
                        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                             <div className="w-16 h-16 bg-[#F2CC8F] text-white rounded-2xl flex items-center justify-center shadow-xl shadow-[#F2CC8F]/20 mb-6">
                                <Share2 size={32} />
                            </div>

                            <h2 className="font-serif text-3xl md:text-4xl font-bold text-[#3D405B]">
                                {isDemoMode ? "Des normes prêtes a l'emploi" : "L'intelligence collective."}
                            </h2>

                            <p className="text-stone-500 leading-relaxed">
                                {isDemoMode ? 
                                    "Les conversions s'appliquent instantanement. Vous voyez l'impact des scores sur la synthese et les recommandations." : 
                                    "Accédez instantanément aux tables de conversion alimentées par la communauté. Gagnez des crédits bonus en contribuant à enrichir la base de données."}
                            </p>

                            <div className="space-y-3">
                                <div className="flex items-start gap-4 p-4 bg-stone-50 rounded-xl">
                                    <Database size={20} className="text-[#E07A5F] mt-1 shrink-0" />
                                    <div>
                                        <h4 className="font-bold text-[#3D405B] text-sm">Données à jour</h4>
                                        <p className="text-xs text-stone-400 leading-relaxed">Plus besoin de chercher dans vos manuels. Les conversions sont intégrées.</p>
                                    </div>
                                </div>
                                {!isDemoMode && (
                                    <div className="flex items-start gap-4 p-4 bg-stone-50 rounded-xl">
                                        <Zap size={20} className="text-[#E07A5F] mt-1 shrink-0" />
                                        <div>
                                            <h4 className="font-bold text-[#3D405B] text-sm">Gagnez des crédits</h4>
                                            <p className="text-xs text-stone-400 leading-relaxed">1 contribution validée = 1 crédit. Un modèle gagnant-gagnant.</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button onClick={handleNext} className="w-full px-8 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] transition-all flex items-center justify-center gap-3">
                                {isDemoMode ? "Accéder à l'espace démo" : "Suivant"} <ArrowRight size={20} />
                            </button>
                        </div>
                    )}

                    {/* --- ÉTAPE 4 : OFFRE DE BIENVENUE (3 CREDITS) - PROD SEULEMENT --- */}
                    {step === 4 && !isDemoMode && (
                        <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500 w-full">
                             <div className="mb-4">
                                <h2 className="font-serif text-3xl md:text-4xl font-bold text-[#3D405B] mb-4">
                                    Démarrez maintenant <br/> sans contrainte.
                                </h2>
                                <p className="text-lg text-stone-500 leading-relaxed">
                                    Nous avons crédité votre compte de <strong className="text-[#E07A5F]">3 bilans offerts</strong>. 
                                    Aucun engagement, aucune carte bancaire requise.
                                </p>
                             </div>

                             <div className="bg-amber-50 rounded-2xl p-6 border-l-4 border-amber-400 shadow-sm">
                                <div className="flex items-start gap-4">
                                    <div className="p-2 bg-white rounded-full shadow-sm text-amber-500 mt-1">
                                        <Clock size={24} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-amber-900 text-lg mb-1">Durée Limitée</h4>
                                        <p className="text-amber-800 leading-relaxed">
                                            Votre période d'essai est valable <strong>30 jours</strong>. <br/>
                                            Passé ce délai, les fonctionnalités premium seront verrouillées.
                                        </p>
                                    </div>
                                </div>
                             </div>

                             <div>
                                <button 
                                    onClick={onComplete}
                                    className="w-full px-8 py-4 bg-[#3D405B] text-white rounded-xl font-bold text-lg shadow-xl hover:bg-[#2c2e42] hover:scale-[1.01] transition-all flex items-center justify-center gap-3 group"
                                >
                                    Accéder à mon espace <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform"/>
                                </button>
                                <div className="mt-4 flex justify-between items-center px-2">
                                    <p className="text-xs text-stone-400 font-medium">Inscription en 2 minutes.</p>
                                </div>
                             </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};
