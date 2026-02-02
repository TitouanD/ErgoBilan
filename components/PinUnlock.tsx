
import React, { useState, useEffect, useRef } from 'react';
import { Lock, Unlock, AlertTriangle, LogOut } from 'lucide-react';
import { verifyPin } from '../utils/crypto';
import { PractitionerProfile } from '../types';

interface Props {
    practitioner: PractitionerProfile;
    onUnlock: (key: CryptoKey) => void;
    onLogout: () => void;
}

export const PinUnlock: React.FC<Props> = ({ practitioner, onUnlock, onLogout }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        // Auto-focus robuste au montage
        // On utilise un timeout pour garantir que le DOM est prêt et la transition finie
        const timer = setTimeout(() => {
            if (inputRef.current) inputRef.current.focus();
        }, 100);
        
        if (inputRef.current) inputRef.current.focus();

        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        // Auto-submit à 6 chiffres
        if (pin.length === 6) {
            handleVerify();
        }
    }, [pin]);

    const handleVerify = async () => {
        setIsVerifying(true);
        setError(false);

        // La vérification est async (PBKDF2 prend du temps pour sécurité)
        // On laisse un petit délai UI pour que l'utilisateur voit le dernier point se remplir
        setTimeout(async () => {
            const key = await verifyPin(pin, practitioner.encryptionSalt, practitioner.encryptionValidator);
            
            if (key) {
                onUnlock(key);
            } else {
                setError(true);
                setPin('');
                setIsVerifying(false);
                // Refocus après erreur
                if (inputRef.current) inputRef.current.focus();
            }
        }, 300);
    };

    return (
        <div 
            className="min-h-screen bg-[#3D405B] flex flex-col items-center justify-center p-6 relative overflow-hidden"
            onClick={() => inputRef.current?.focus()} // Clic n'importe où redonne le focus
        >
            {/* Background Abstract */}
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#E07A5F]/10 rounded-full blur-[100px]"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#81B29A]/10 rounded-full blur-[100px]"></div>

            <div className="bg-white/10 backdrop-blur-md border border-white/10 p-12 rounded-[40px] shadow-2xl w-full max-w-md text-center relative animate-in zoom-in-95 duration-500">
                
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-8 shadow-inner border border-white/10">
                    {isVerifying ? (
                        <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                    ) : error ? (
                        <Lock size={32} className="text-rose-400" />
                    ) : (
                        <Lock size={32} className="text-white" />
                    )}
                </div>

                <h2 className="text-2xl font-serif font-bold text-white mb-2">Bonjour Dr. {practitioner.lastName}</h2>
                <p className="text-white/60 text-sm mb-10">Entrez votre code PIN pour déchiffrer vos dossiers.</p>

                {/* PIN Input Visualizer */}
                <div className="relative mb-8 flex justify-center gap-4">
                    {[0, 1, 2, 3, 4, 5].map((idx) => (
                        <div 
                            key={idx}
                            className={`w-4 h-4 rounded-full transition-all duration-300 ${
                                pin.length > idx 
                                    ? 'bg-[#E07A5F] scale-110 shadow-[0_0_10px_rgba(224,122,95,0.8)]' 
                                    : 'bg-white/20'
                            } ${error ? 'bg-rose-500 animate-shake' : ''}`}
                        ></div>
                    ))}
                    
                    {/* Input invisible pour capturer la saisie (meilleur pour mobile/accessibilité) */}
                    <input 
                        ref={inputRef}
                        type="password" 
                        inputMode="numeric"
                        maxLength={6}
                        value={pin}
                        onChange={(e) => { setError(false); setPin(e.target.value.replace(/[^0-9]/g, '')); }}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        autoFocus
                    />
                </div>

                {error && (
                    <p className="text-rose-400 text-xs font-bold animate-pulse mb-6 flex items-center justify-center gap-2">
                        <AlertTriangle size={14}/> Code PIN incorrect
                    </p>
                )}

                <button 
                    onClick={(e) => { e.stopPropagation(); onLogout(); }}
                    className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 mx-auto cursor-pointer"
                >
                    <LogOut size={14} /> Changer de compte
                </button>
            </div>
            
            <div className="absolute bottom-8 text-white/20 text-[10px] uppercase tracking-widest font-bold">
                Chiffrement End-to-End Sécurisé
            </div>
        </div>
    );
};
