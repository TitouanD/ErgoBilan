
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Lock, Unlock, AlertTriangle, LogOut, Timer } from 'lucide-react';
import { verifyPin, PinVerifyResult } from '../../utils/crypto';
import { supabase } from '../../services/db';
import { PractitionerProfile } from '../../types';

// --- Brute-force protection ---
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATIONS = [30, 60, 120, 300, 600]; // seconds: 30s, 1m, 2m, 5m, 10m
const LOCKOUT_STORAGE_KEY = 'pin_lockout';

interface LockoutState {
    attempts: number;
    lockedUntil: number | null; // timestamp ms
    lockoutLevel: number;
}

const getLockoutState = (): LockoutState => {
    try {
        const stored = localStorage.getItem(LOCKOUT_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return { attempts: parsed.attempts || 0, lockedUntil: parsed.lockedUntil || null, lockoutLevel: parsed.lockoutLevel || 0 };
        }
    } catch {}
    return { attempts: 0, lockedUntil: null, lockoutLevel: 0 };
};

const saveLockoutState = (state: LockoutState) => {
    localStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(state));
};

const clearLockoutState = () => {
    localStorage.removeItem(LOCKOUT_STORAGE_KEY);
};

interface Props {
    practitioner: PractitionerProfile;
    onUnlock: (key: CryptoKey) => void;
    onLogout: () => void;
}

export const PinUnlock: React.FC<Props> = ({ practitioner, onUnlock, onLogout }) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const [lockout, setLockout] = useState<LockoutState>(getLockoutState);
    const [remainingSeconds, setRemainingSeconds] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const isLocked = lockout.lockedUntil !== null && Date.now() < lockout.lockedUntil;

    // Countdown timer for lockout
    useEffect(() => {
        if (!lockout.lockedUntil) { setRemainingSeconds(0); return; }
        
        const update = () => {
            const diff = Math.max(0, Math.ceil((lockout.lockedUntil! - Date.now()) / 1000));
            setRemainingSeconds(diff);
            if (diff <= 0) {
                setLockout(prev => ({ ...prev, lockedUntil: null }));
            }
        };
        update();
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [lockout.lockedUntil]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (inputRef.current && !isLocked) inputRef.current.focus();
        }, 100);
        if (inputRef.current && !isLocked) inputRef.current.focus();
        return () => clearTimeout(timer);
    }, [isLocked]);

    useEffect(() => {
        if (pin.length === 6 && !isLocked) {
            handleVerify();
        }
    }, [pin]);

    const handleVerify = useCallback(async () => {
        if (isLocked) return;
        
        setIsVerifying(true);
        setError(false);

        setTimeout(async () => {
            const result: PinVerifyResult | null = await verifyPin(pin, practitioner.encryptionSalt, practitioner.encryptionValidator);
            
            if (result) {
                // If PBKDF2 iterations were upgraded, persist the new validator to Supabase
                if (result.migratedValidator) {
                    supabase.from('practitioners')
                        .update({ encryption_validator: result.migratedValidator })
                        .eq('id', practitioner.id)
                        .then(() => { /* fire-and-forget: next login will re-migrate if this fails */ });
                }

                clearLockoutState();
                onUnlock(result.key);
            } else {
                const newAttempts = lockout.attempts + 1;
                let newState: LockoutState;

                if (newAttempts >= MAX_ATTEMPTS) {
                    const level = Math.min(lockout.lockoutLevel, LOCKOUT_DURATIONS.length - 1);
                    const duration = LOCKOUT_DURATIONS[level] * 1000;
                    newState = {
                        attempts: 0,
                        lockedUntil: Date.now() + duration,
                        lockoutLevel: level + 1
                    };
                } else {
                    newState = { ...lockout, attempts: newAttempts };
                }

                saveLockoutState(newState);
                setLockout(newState);
                setError(true);
                setPin('');
                setIsVerifying(false);
                if (inputRef.current) inputRef.current.focus();
            }
        }, 300);
    }, [pin, lockout, isLocked, practitioner, onUnlock]);

    const attemptsRemaining = MAX_ATTEMPTS - lockout.attempts;
    const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;


    return (
        <div 
            className="min-h-screen bg-[#3D405B] flex flex-col items-center justify-center p-6 relative overflow-hidden"
            onClick={() => inputRef.current?.focus()} 
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
                            className={`w-4 h-4 rounded-full transition-all duration-300 border border-white/20 ${
                                pin.length > idx 
                                    ? 'bg-[#E07A5F] scale-125 shadow-[0_0_15px_rgba(224,122,95,0.6)] border-[#E07A5F]' 
                                    : 'bg-white/10'
                            } ${error ? 'bg-rose-500 animate-shake shadow-none border-rose-500' : ''}`}
                        ></div>
                    ))}
                    
                    <input 
                        ref={inputRef}
                        type="password" 
                        inputMode="numeric"
                        maxLength={6}
                        value={pin}
                        disabled={isLocked || isVerifying}
                        onChange={(e) => { setError(false); setPin(e.target.value.replace(/[^0-9]/g, '')); }}
                        className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                        autoFocus
                    />
                </div>

                {error && !isLocked && (
                    <p className="text-rose-400 text-xs font-bold animate-pulse mb-6 flex items-center justify-center gap-2 bg-rose-500/10 py-2 rounded-lg border border-rose-500/20">
                        <AlertTriangle size={14}/> Code PIN incorrect ({attemptsRemaining} tentative{attemptsRemaining > 1 ? 's' : ''} restante{attemptsRemaining > 1 ? 's' : ''})
                    </p>
                )}

                {isLocked && (
                    <div className="mb-6 bg-rose-500/10 py-4 px-4 rounded-xl border border-rose-500/20 text-center">
                        <div className="flex items-center justify-center gap-2 text-rose-400 font-bold text-sm mb-1">
                            <Timer size={16} /> Compte verrouillé
                        </div>
                        <p className="text-rose-300 text-xs">
                            Trop de tentatives. Réessayez dans <span className="font-mono font-bold text-rose-400">{formatTime(remainingSeconds)}</span>
                        </p>
                    </div>
                )}

                <button 
                    onClick={(e) => { e.stopPropagation(); onLogout(); }}
                    className="text-white/40 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2 mx-auto cursor-pointer"
                >
                    <LogOut size={14} /> Changer de compte
                </button>
            </div>
            
            <div className="absolute bottom-8 text-white/20 text-[10px] uppercase tracking-widest font-bold">
                Chiffrement End-to-End Sécurisé • AutoBilan 1.2
            </div>
        </div>
    );
};
