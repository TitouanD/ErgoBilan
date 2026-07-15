import React from 'react';
import type { BrandingConfig } from '../../../../types';
import { Palette, Lock, Brush } from 'lucide-react';

// --- BARRE D'OUTILS STANDARDISÉE ---
export const ReportToolbar: React.FC<{
    currentBranding: BrandingConfig,
    onApply: (b: BrandingConfig) => void,
    onOpenEditor: () => void,
    isPremium: boolean
}> = ({ currentBranding, onApply, onOpenEditor, isPremium }) => {

    const PRESETS = [
        { name: "Moderne", primary: "#264653", secondary: "#E9C46A", font: "Open Sans", template: "corporate" },
        { name: "Douceur", primary: "#81B29A", secondary: "#F2CC8F", font: "Quicksand", template: "centered" },
        { name: "Sérieux", primary: "#1D3557", secondary: "#457B9D", font: "Roboto", template: "classic" }
    ];

    return (
        <div className="fixed left-4 top-1/2 -translate-y-1/2 z-[100] animate-in slide-in-from-left-10 fade-in duration-700 bg-[var(--card-bg)] rounded-2xl p-2 shadow-2xl border border-[var(--border-color)] flex flex-col items-center gap-3 print:hidden">
            <div className="flex flex-col items-center gap-1 text-sm font-bold text-[var(--text-heading)]">
                <Palette size={16} className="text-[#E07A5F]" />
            </div>

            <div className="flex flex-col gap-2">
                {PRESETS.map((preset, idx) => (
                    <button
                        key={idx}
                        onClick={() => {
                            if (!isPremium) { onOpenEditor(); return; } // Trigger pricing via editor flow
                            onApply({
                                ...currentBranding,
                                isEnabled: true, // Auto-enable
                                primaryColor: preset.primary,
                                secondaryColor: preset.secondary,
                                fontFamily: preset.font as any,
                                headerTemplate: preset.template as any
                            })
                        }}
                        className="w-8 h-8 rounded-full border-2 border-white shadow-md hover:scale-110 transition-transform relative overflow-hidden group"
                        style={{ backgroundColor: preset.primary }}
                        title={preset.name}
                    >
                        <div className="absolute bottom-0 right-0 w-4 h-4 rounded-tl-full" style={{ backgroundColor: preset.secondary }}></div>
                        {!isPremium && <div className="absolute inset-0 bg-black/20 flex items-center justify-center"><Lock size={10} className="text-white" /></div>}
                    </button>
                ))}
            </div>

            <div className="h-px w-6 bg-[var(--border-color)] my-1"></div>

            <button onClick={onOpenEditor} className="bg-[#3D405B] text-white p-2 rounded-full text-xs font-bold hover:bg-[#2c2e42] transition-colors flex items-center gap-2" title="Éditeur Complet">
                <Brush size={12} />
            </button>
        </div>
    );
};

export default ReportToolbar;
