
import React, { useEffect, useState } from 'react';
import { Lock, Unlock, ShieldCheck, FileKey, Database, Cpu } from 'lucide-react';

interface Props {
    isOpen: boolean;
    onComplete: () => void;
}

const HASH_CHARS = "ABCDEF0123456789";

export const DecryptionModal: React.FC<Props> = ({ isOpen, onComplete }) => {
    const [progress, setProgress] = useState(0);
    const [currentHash, setCurrentHash] = useState("");
    const [step, setStep] = useState(0); // 0: Handshake, 1: Decrypt, 2: Unlock

    useEffect(() => {
        if (!isOpen) return;

        // Reset state
        setProgress(0);
        setStep(0);

        // Hash Animation
        const hashInterval = setInterval(() => {
            let hash = "0x";
            for (let i = 0; i < 40; i++) {
                hash += HASH_CHARS[Math.floor(Math.random() * HASH_CHARS.length)];
            }
            setCurrentHash(hash);
        }, 50);

        // Sequence Logic
        const timeline = async () => {
            // Step 0: Handshake (0-1s)
            await new Promise(r => setTimeout(r, 800));
            setStep(1);

            // Step 1: Decryption Progress (1s - 2.5s)
            const steps = 50;
            for (let i = 0; i <= steps; i++) {
                setProgress(i * (100 / steps));
                await new Promise(r => setTimeout(r, 30)); // 1.5s total
            }
            
            // Step 2: Unlock (2.5s - 3.5s)
            setStep(2);
            clearInterval(hashInterval);
            await new Promise(r => setTimeout(r, 800));
            
            onComplete();
        };

        timeline();

        return () => clearInterval(hashInterval);
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] bg-[#0f172a]/95 backdrop-blur-xl flex flex-col items-center justify-center font-mono text-emerald-500 animate-in fade-in duration-300">
            
            <div className="w-full max-w-lg p-8 relative">
                
                {/* ICON CENTRAL */}
                <div className="flex justify-center mb-8">
                    <div className="relative">
                        <div className={`absolute inset-0 bg-emerald-500/20 rounded-full blur-xl transition-all duration-500 ${step === 2 ? 'scale-150 bg-emerald-400/40' : 'scale-100'}`}></div>
                        <div className="w-24 h-24 rounded-full border-2 border-emerald-500/30 bg-[#0f172a] flex items-center justify-center relative z-10 transition-all duration-500">
                            {step === 0 && <Lock size={40} className="animate-pulse" />}
                            {step === 1 && <Cpu size={40} className="animate-spin-slow" />}
                            {step === 2 && <Unlock size={40} className="text-emerald-400 scale-110 transition-transform" />}
                        </div>
                    </div>
                </div>

                {/* TEXT STATUS */}
                <div className="text-center space-y-2 mb-8">
                    <h2 className="text-2xl font-bold tracking-widest text-white uppercase">
                        {step === 0 && "Connexion Sécurisée"}
                        {step === 1 && "Déchiffrement AES-256"}
                        {step === 2 && "Accès Autorisé"}
                    </h2>
                    <p className="text-xs text-emerald-500/60 truncate h-4">{currentHash}</p>
                </div>

                {/* PROGRESS BAR */}
                <div className="relative h-2 bg-emerald-900/30 rounded-full overflow-hidden mb-4">
                    <div 
                        className="absolute top-0 left-0 h-full bg-emerald-500 shadow-[0_0_15px_#10b981] transition-all duration-100 ease-linear"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>

                {/* STEPS LIST */}
                <div className="space-y-3 text-xs font-bold uppercase tracking-wider">
                    <div className={`flex items-center gap-3 ${step >= 0 ? 'text-emerald-400' : 'text-emerald-900'}`}>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${step > 0 ? 'bg-emerald-500 border-emerald-500 text-[#0f172a]' : 'border-emerald-500/50'}`}>
                            {step > 0 && <ShieldCheck size={10} strokeWidth={4} />}
                        </div>
                        <span>Vérification Clé Privée</span>
                    </div>
                    <div className={`flex items-center gap-3 ${step >= 1 ? 'text-emerald-400' : 'text-emerald-900'}`}>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${step > 1 ? 'bg-emerald-500 border-emerald-500 text-[#0f172a]' : 'border-emerald-500/50'}`}>
                            {step > 1 && <Database size={10} strokeWidth={4} />}
                        </div>
                        <span>Extraction Données Chiffrées</span>
                    </div>
                    <div className={`flex items-center gap-3 ${step >= 2 ? 'text-emerald-400' : 'text-emerald-900'}`}>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${step === 2 ? 'bg-emerald-500 border-emerald-500 text-[#0f172a]' : 'border-emerald-500/50'}`}>
                            {step === 2 && <FileKey size={10} strokeWidth={4} />}
                        </div>
                        <span>Reconstruction Dossier Patient</span>
                    </div>
                </div>

            </div>
        </div>
    );
};
