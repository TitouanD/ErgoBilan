
import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [showBackOnline, setShowBackOnline] = useState(false);

    useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            setShowBackOnline(true);
            setTimeout(() => setShowBackOnline(false), 4000); // Disparait après 4s
        };
        
        const handleOffline = () => {
            setIsOnline(false);
            setShowBackOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    if (!isOnline) {
        return (
            <div className="fixed bottom-0 left-0 right-0 bg-[var(--secondary)] text-white z-[9999] animate-in slide-in-from-bottom-full duration-500 shadow-[0_-4px_20px_rgba(0,0,0,0.2)]">
                <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-center md:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 bg-rose-500 rounded-full animate-pulse">
                            <WifiOff size={16} />
                        </div>
                        <div className="text-sm font-medium">
                            <span className="font-bold">Mode Hors-Ligne.</span> Votre connexion semble interrompue.
                        </div>
                    </div>
                    <div className="hidden md:block text-xs text-[var(--text-secondary)] bg-white/10 px-3 py-1 rounded-full">
                        Sauvegarde locale active
                    </div>
                </div>
            </div>
        );
    }

    if (showBackOnline) {
        return (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-emerald-500 text-white z-[9999] px-6 py-3 rounded-full shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500 flex items-center gap-3">
                <Wifi size={18} />
                <span className="font-bold text-sm">Connexion rétablie</span>
            </div>
        );
    }

    return null;
};
