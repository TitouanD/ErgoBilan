import React, { useState } from 'react';
import { WifiOff, RefreshCw, LogOut, Loader2 } from 'lucide-react';

interface Props {
    onRetry: () => Promise<unknown>;
    onLogout: () => void;
}

export const NetworkErrorScreen: React.FC<Props> = ({ onRetry, onLogout }) => {
    const [isRetrying, setIsRetrying] = useState(false);

    const handleRetry = async () => {
        setIsRetrying(true);
        try {
            await onRetry();
        } finally {
            setIsRetrying(false);
        }
    };

    return (
        <div className="flex h-screen w-full items-center justify-center bg-[var(--app-bg)]">
            <div className="flex flex-col items-center gap-6 text-center max-w-sm px-6">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center">
                    <WifiOff size={36} className="text-red-400" />
                </div>

                <div className="space-y-2">
                    <h2 className="text-2xl font-serif font-bold text-[var(--text-heading)]">Connexion échouée</h2>
                    <p className="text-[var(--text-secondary)] text-sm leading-relaxed">
                        Impossible de joindre le serveur. Vérifiez votre connexion internet et réessayez.
                    </p>
                </div>

                <div className="flex flex-col gap-3 w-full mt-2">
                    <button
                        onClick={handleRetry}
                        disabled={isRetrying}
                        className="w-full py-3.5 bg-[var(--primary)] text-white rounded-2xl font-bold shadow-lg shadow-orange-200 dark:shadow-black/30 hover:bg-[#d0694e] transition-all flex items-center justify-center gap-2 disabled:opacity-70"
                    >
                        {isRetrying ? (
                            <Loader2 size={20} className="animate-spin" />
                        ) : (
                            <RefreshCw size={18} />
                        )}
                        {isRetrying ? 'Connexion en cours...' : 'Réessayer'}
                    </button>
                    <button
                        onClick={onLogout}
                        className="w-full py-3.5 bg-[var(--card-bg)] text-[var(--text-secondary)] rounded-2xl font-medium border border-[var(--border-color)] hover:border-[var(--text-light)] hover:text-[var(--text-main)] transition-all flex items-center justify-center gap-2"
                    >
                        <LogOut size={16} />
                        Se déconnecter
                    </button>
                </div>
            </div>
        </div>
    );
};

