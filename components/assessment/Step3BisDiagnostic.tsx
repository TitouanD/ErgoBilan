
import React, { useState, useCallback } from 'react';
import { ClinicalSynthesis, TestData, Observations } from '../../types';
import { DebouncedTextarea } from '../shared/DebouncedControls';
import { Sparkles, Brain, Target, ArrowRight, Lightbulb, Activity, ChevronRight, PenTool, MessageSquare, Quote } from 'lucide-react';

interface Props {
  synthesis: ClinicalSynthesis;
  updateSynthesis: (data: Partial<ClinicalSynthesis>) => void;
  tests: TestData;
  observations?: Observations; // Ajout prop
  onNext: () => void;
  onBack: () => void;
  isGenerating: boolean;
}

// Sidebar pour rappel des scores significatifs
const SignificantScores: React.FC<{ tests: TestData }> = ({ tests }) => {
    const alerts = [];
    Object.entries(tests).forEach(([testId, subtests]) => {
        Object.entries(subtests).forEach(([subId, res]) => {
            if (res.status === 'validated' && res.zScore <= -1.5) {
                alerts.push({ subId, z: res.zScore, standard: res.standard });
            }
        });
    });

    if (alerts.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6 shadow-sm">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity size={14}/> Points d'appel (Scores)
            </h4>
            <div className="space-y-2">
                {alerts.map((a, idx) => (
                    <div key={idx} className="flex justify-between items-center text-sm border-b border-stone-50 pb-2 last:border-0">
                        <span className="font-medium text-stone-600 truncate max-w-[150px]" title={a.subId}>{a.subId}</span>
                        <span className={`font-bold px-2 py-0.5 rounded text-white text-xs ${a.z <= -2 ? 'bg-[#E07A5F]' : 'bg-[#F2CC8F]'}`}>
                            {a.z} ET
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Suggestions cliquables
const DIAG_SUGGESTIONS = [
    "Trouble Développemental de la Coordination (TDC)",
    "Dysgraphie fonctionnelle",
    "Trouble de l'attention (TDAH) impactant l'occupation",
    "Retard de développement psychomoteur",
    "Pas de trouble avéré - Fragilités isolées"
];

const RECO_SUGGESTIONS = [
    "Suivi hebdomadaire 45min",
    "Mise en place de l'outil informatique",
    "Aménagements scolaires (PAP/PPS)",
    "Guidance parentale",
    "Bilan de contrôle dans 6 mois"
];

export const Step3BisDiagnostic: React.FC<Props> = ({ synthesis, updateSynthesis, tests, observations, onNext, onBack, isGenerating }) => {
    
    const handleDiagChange = (val: string) => updateSynthesis({ diagnosticInput: val });
    const handleRecoChange = (val: string) => updateSynthesis({ recommendationsInput: val });

    const addSuggestion = (current: string, add: string, updater: (v: string) => void) => {
        if (!current) updater(add);
        else if (!current.includes(add)) updater(current + " - " + add);
    };

    return (
        <div className="max-w-6xl mx-auto pb-32 animate-in fade-in duration-500">
            
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-serif font-bold text-[#3D405B]">Synthèse & Projet</h2>
                    <p className="text-stone-500 font-medium mt-2">Posez votre diagnostic. L'IA se chargera de l'argumenter.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* COLONNE GAUCHE (SAISIE) */}
                <div className="lg:col-span-2 space-y-8">
                    
                    {/* BLOC DIAGNOSTIC */}
                    <div className="bg-white p-8 rounded-[32px] border border-stone-100 shadow-sm relative group hover:border-[#E07A5F]/30 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[#3D405B]">
                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><Brain size={24}/></div>
                            <h3 className="font-bold text-xl">Conclusion Diagnostique</h3>
                        </div>
                        
                        <DebouncedTextarea 
                            value={synthesis.diagnosticInput}
                            onChange={handleDiagChange}
                            placeholder="Ex: TDC mixte associé à une dysgraphie. L'impact sur la scolarité est majeur..."
                            className="w-full p-4 bg-[#F9F9F9] rounded-2xl border-2 border-transparent outline-none h-32 resize-none font-medium text-[#3D405B] placeholder:text-stone-300 focus:bg-white focus:border-indigo-200 transition-all leading-relaxed mb-4"
                        />

                        {/* Suggestions */}
                        <div className="flex flex-wrap gap-2">
                            {DIAG_SUGGESTIONS.map(tag => (
                                <button 
                                    key={tag}
                                    onClick={() => addSuggestion(synthesis.diagnosticInput, tag, handleDiagChange)}
                                    className="px-3 py-1 bg-stone-50 border border-stone-100 rounded-full text-xs font-bold text-stone-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100 transition-all flex items-center gap-1"
                                >
                                    <PlusIcon /> {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* BLOC PROJET */}
                    <div className="bg-white p-8 rounded-[32px] border border-stone-100 shadow-sm relative group hover:border-[#E07A5F]/30 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[#3D405B]">
                            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl"><Target size={24}/></div>
                            <h3 className="font-bold text-xl">Projet & Préconisations</h3>
                        </div>
                        
                        <DebouncedTextarea 
                            value={synthesis.recommendationsInput}
                            onChange={handleRecoChange}
                            placeholder="Ex: Suivi hebdo. Apprentissage du clavier caché. Mise en place tiers-temps."
                            className="w-full p-4 bg-[#F9F9F9] rounded-2xl border-2 border-transparent outline-none h-32 resize-none font-medium text-[#3D405B] placeholder:text-stone-300 focus:bg-white focus:border-emerald-200 transition-all leading-relaxed mb-4"
                        />

                        {/* Suggestions */}
                        <div className="flex flex-wrap gap-2">
                            {RECO_SUGGESTIONS.map(tag => (
                                <button 
                                    key={tag}
                                    onClick={() => addSuggestion(synthesis.recommendationsInput, tag, handleRecoChange)}
                                    className="px-3 py-1 bg-stone-50 border border-stone-100 rounded-full text-xs font-bold text-stone-500 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-100 transition-all flex items-center gap-1"
                                >
                                    <PlusIcon /> {tag}
                                </button>
                            ))}
                        </div>
                    </div>

                </div>

                {/* COLONNE DROITE (AIDE & RAPPEL) */}
                <div className="space-y-6">
                    <SignificantScores tests={tests} />
                    
                    {/* RAPPEL OBSERVATIONS (NOUVEAU) */}
                    {observations?.anamnese && (
                        <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
                            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                                <MessageSquare size={14}/> Rappel Observations
                            </h4>
                            <div className="bg-stone-50 p-3 rounded-xl relative">
                                <Quote size={16} className="absolute top-2 left-2 text-stone-300 transform rotate-180" />
                                <p className="text-xs text-stone-600 italic leading-relaxed pl-6 pt-1">
                                    {observations.anamnese.length > 200 ? observations.anamnese.substring(0, 200) + '...' : observations.anamnese}
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="bg-[#fffdf5] border border-[#F2CC8F]/50 p-6 rounded-2xl">
                        <h4 className="font-bold text-[#d97706] mb-3 flex items-center gap-2 text-sm">
                            <Lightbulb size={16}/> Pourquoi cette étape ?
                        </h4>
                        <p className="text-xs text-[#92400e] leading-relaxed mb-2">
                            L'IA ne pose pas de diagnostic, <strong>c'est votre rôle légal</strong>.
                        </p>
                        <p className="text-xs text-[#92400e] leading-relaxed">
                            En remplissant ces champs, vous orientez la rédaction. L'IA utilisera vos conclusions pour structurer l'argumentaire et lier les preuves (scores) à votre diagnostic.
                        </p>
                    </div>
                </div>

            </div>

            {/* NAVIGATION FOOTER */}
            <div className="fixed bottom-0 left-0 right-0 p-6 bg-white/90 backdrop-blur-md border-t border-stone-100 flex justify-center z-50">
                <div className="max-w-4xl w-full flex justify-between items-center">
                    <button onClick={onBack} className="text-stone-400 hover:text-[#3D405B] font-bold text-sm uppercase tracking-widest px-4 transition-colors">
                        Retour
                    </button>
                    
                    <button 
                        onClick={onNext}
                        disabled={isGenerating}
                        className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all ${
                            isGenerating ? 'bg-stone-300 cursor-not-allowed' : 'bg-[#3D405B] hover:bg-[#E07A5F] hover:-translate-y-1'
                        }`}
                    >
                        {isGenerating ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>Génération du rapport...</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={20} className="text-[#F2CC8F]" />
                                <span>Générer le Bilan</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

const PlusIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
);
