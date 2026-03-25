import React, { useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';

export const VoiceTextarea: React.FC<{
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    rows?: number;
    className?: string;
    label?: string;
}> = ({ value, onChange, placeholder, rows = 5, className = '', label }) => {
    const handleTranscript = useCallback((text: string) => {
        onChange(value ? `${value} ${text}` : text);
    }, [value, onChange]);

    const { isListening, isSupported, interimText, toggleListening } = useVoiceDictation({
        onTranscript: handleTranscript,
    });

    return (
        <div className="relative">
            {label && <label className="block text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">{label}</label>}
            <div className="relative">
                <textarea
                    value={isListening && interimText ? (value ? `${value} ${interimText}` : interimText) : value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    rows={rows}
                    className={`w-full bg-[var(--input-bg)] border rounded-xl p-4 text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:ring-2 focus:ring-[#E07A5F]/30 focus:border-[#E07A5F]/50 resize-none leading-relaxed pr-12 ${className}`}
                />
                {isSupported && (
                    <button
                        type="button"
                        onClick={toggleListening}
                        className={`absolute top-3 right-3 p-2 rounded-xl transition-all ${
                            isListening
                                ? 'bg-red-100 text-red-600 animate-pulse shadow-lg shadow-red-200'
                                : 'bg-[var(--progress-bg)] text-[var(--text-secondary)] hover:bg-[#E07A5F]/10 hover:text-[#E07A5F]'
                        }`}
                        title={isListening ? 'Arrêter la dictée' : 'Dictée vocale'}
                    >
                        {isListening ? <Mic size={16} /> : <MicOff size={16} />}
                    </button>
                )}
            </div>
        </div>
    );
};
