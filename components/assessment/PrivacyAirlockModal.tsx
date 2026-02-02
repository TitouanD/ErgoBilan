
import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Eye, ArrowRight, X, Lock } from 'lucide-react';

interface Props {
    onConfirm: () => void;
    onCancel: () => void;
    anonymizedContent: string;
}

export const PrivacyAirlockModal: React.FC<Props> = ({ onConfirm, onCancel, anonymizedContent }) => {
    const [hasVerified, setHasVerified] = useState(false);

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header Sécurité */}
                <div className="bg-[#3D405B] p-6 text-white flex justify-between items-start">
                    <div className="flex gap-4">
                        <div className="p-3 bg-white/10 rounded-2xl border border-white/10">
                            <ShieldCheck size={32} className="text-[#81B29A]" />
                        </div>
                        <div>
                            <h2 className="font-serif font-bold text-xl">Sas de Confidentialité</h2>
                            <p className="text-white/60 text-sm mt-1">Contrôle HDS avant traitement IA.</p>
                        </div>
                    </div>
                    <button onClick={onCancel} className="text-white/40 hover:text-white transition-colors"><X size={24}/></button>
                </div>

                <div className="p-8 overflow-y-auto flex-1 bg-stone-50">
                    <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-xl mb-6">
                        <div className="flex gap-3">
                            <AlertTriangle className="text-amber-500 shrink-0" size={20} />
                            <div>
                                <h3 className="font-bold text-amber-900 text-sm">Responsabilité Praticien</h3>
                                <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                                    Vous êtes le responsable du traitement. Vérifiez ci-dessous qu'aucun nom propre (ex: "Dupont", "Thomas") ou donnée identifiante ne subsiste dans le texte qui sera envoyé à l'IA.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="mb-2 flex items-center justify-between">
                        <label className="text-xs font-bold text-stone-400 uppercase tracking-wider flex items-center gap-2">
                            <Eye size={12}/> Données envoyées à Gemini
                        </label>
                        <span className="text-[10px] bg-stone-200 px-2 py-1 rounded text-stone-500 font-mono">Format JSON/Text</span>
                    </div>
                    
                    <div className="bg-white border border-stone-200 rounded-xl p-4 text-xs font-mono text-stone-600 h-64 overflow-y-auto shadow-inner whitespace-pre-wrap">
                        {anonymizedContent}
                    </div>
                </div>

                <div className="p-6 border-t border-stone-200 bg-white">
                    <label className="flex items-center gap-3 cursor-pointer mb-6 p-3 rounded-xl hover:bg-stone-50 transition-colors">
                        <input 
                            type="checkbox" 
                            className="w-5 h-5 accent-[#E07A5F] cursor-pointer"
                            checked={hasVerified}
                            onChange={(e) => setHasVerified(e.target.checked)}
                        />
                        <span className="text-sm font-bold text-[#3D405B]">
                            Je certifie avoir vérifié l'absence de données nominatives.
                        </span>
                    </label>

                    <div className="flex justify-end gap-3">
                        <button 
                            onClick={onCancel}
                            className="px-6 py-3 font-bold text-stone-400 hover:text-stone-600 text-sm transition-colors"
                        >
                            Annuler
                        </button>
                        <button 
                            onClick={onConfirm}
                            disabled={!hasVerified}
                            className="px-8 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg hover:bg-[#d0694e] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                        >
                            <Lock size={16} /> Confirmer et Générer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
