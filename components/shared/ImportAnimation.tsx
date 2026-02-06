
import React, { useEffect, useState } from 'react';
import { Mail, FileText, ArrowRight, Loader2, CheckCircle2, UserCheck, Stethoscope, GraduationCap } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onComplete: () => void;
}

export const ImportAnimation: React.FC<Props> = ({ isOpen, onComplete }) => {
    const [step, setStep] = useState(0);

    useEffect(() => {
        if (!isOpen) return;
        setStep(0);

        const timeline = async () => {
            await new Promise(r => setTimeout(r, 500));
            setStep(1); // Ouverture enveloppe
            await new Promise(r => setTimeout(r, 800));
            setStep(2); // Extraction
            await new Promise(r => setTimeout(r, 1200));
            setStep(3); // Remplissage
            await new Promise(r => setTimeout(r, 1000));
            onComplete();
        };
        timeline();
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-[#3D405B]/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
            <div className="relative w-full max-w-lg p-10 flex flex-col items-center">
                
                {/* ZONE D'ANIMATION CENTRALE */}
                <div className="relative h-40 w-full mb-12 flex items-center justify-center">
                    
                    {/* GAUCHE : SOURCE (FAMILLE) */}
                    <div className={`absolute left-10 transition-all duration-700 ${step >= 2 ? 'opacity-0 -translate-x-10' : 'opacity-100'}`}>
                        <div className="w-24 h-20 bg-white rounded-lg shadow-xl flex items-center justify-center relative border border-stone-200">
                            <Mail size={40} className="text-[#3D405B]" />
                            <div className="absolute -top-2 -right-2 bg-[#E07A5F] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                Reçu
                            </div>
                        </div>
                        <p className="text-center text-white/60 text-xs mt-3 font-bold uppercase tracking-wider">Questionnaire</p>
                    </div>

                    {/* FLUX DE DONNÉES (PARTICULES) */}
                    {step === 1 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                <div className="h-full bg-[#E07A5F] w-1/3 animate-[shimmer_1s_infinite]"></div>
                            </div>
                        </div>
                    )}

                    {/* DROITE : CIBLE (DOSSIER) */}
                    <div className={`absolute right-10 transition-all duration-700 ${step < 1 ? 'opacity-0 translate-x-10' : 'opacity-100'}`}>
                        <div className="w-24 h-28 bg-white rounded-xl shadow-2xl flex flex-col items-center pt-4 relative border-2 border-transparent transition-all duration-300 overflow-hidden">
                            {step >= 3 ? (
                                <div className="absolute inset-0 bg-emerald-50 flex flex-col items-center justify-center animate-in zoom-in">
                                    <CheckCircle2 size={40} className="text-emerald-500 mb-2" />
                                    <span className="text-[10px] font-bold text-emerald-700">Complet</span>
                                </div>
                            ) : (
                                <>
                                    <div className="w-12 h-12 rounded-full bg-stone-100 mb-2 animate-pulse"></div>
                                    <div className="w-16 h-2 bg-stone-100 rounded mb-1"></div>
                                    <div className="w-10 h-2 bg-stone-100 rounded"></div>
                                    
                                    {/* Items qui rentrent */}
                                    {step === 2 && (
                                        <>
                                            <div className="absolute top-10 left-[-40px] text-[#3D405B] animate-[flyIn_0.4s_ease-out_forwards]"><UserCheck size={16}/></div>
                                            <div className="absolute top-14 left-[-60px] text-[#E07A5F] animate-[flyIn_0.5s_ease-out_0.2s_forwards]"><GraduationCap size={16}/></div>
                                            <div className="absolute top-18 left-[-30px] text-[#81B29A] animate-[flyIn_0.6s_ease-out_0.4s_forwards]"><Stethoscope size={16}/></div>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                        <p className="text-center text-white/60 text-xs mt-3 font-bold uppercase tracking-wider">Dossier Patient</p>
                    </div>
                </div>

                {/* TEXTE D'ÉTAT */}
                <div className="text-center space-y-2 h-16">
                    <h2 className="text-2xl font-serif font-bold text-white transition-all">
                        {step === 0 && "Connexion sécurisée..."}
                        {step === 1 && "Lecture du questionnaire..."}
                        {step === 2 && "Extraction des données..."}
                        {step === 3 && "Création du dossier..."}
                    </h2>
                    <p className="text-white/60 text-sm">
                        {step >= 2 && "Anamnèse • Scolarité • Motif • Vie Quotidienne"}
                    </p>
                </div>

            </div>
        </div>
    );
};
