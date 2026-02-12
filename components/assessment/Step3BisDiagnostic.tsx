
import React, { useState, useCallback, useMemo } from 'react';
import { ClinicalSynthesis, TestData, Observations, Patient } from '../../types';
import { Sparkles, Brain, Target, ArrowRight, Lightbulb, Activity, ChevronRight, PenTool, MessageSquare, Quote, ShieldCheck, AlertTriangle, Mic, MicOff, Check } from 'lucide-react';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { useCatalog } from '../../contexts/CatalogContext';

interface Props {
    synthesis: ClinicalSynthesis;
    updateSynthesis: (data: Partial<ClinicalSynthesis>) => void;
    tests: TestData;
    observations?: Observations;
    patient?: Patient;
    onNext: () => void;
    onBack: () => void;
    isGenerating: boolean;
}

// --- VOICE TEXTAREA (local version) ---
const VoiceArea: React.FC<{
    value: string;
    onChange: (val: string) => void;
    placeholder: string;
    className?: string;
    rows?: number;
}> = ({ value, onChange, placeholder, className = '', rows = 4 }) => {
    const handleTranscript = useCallback((text: string) => {
        onChange(value ? `${value} ${text}` : text);
    }, [value, onChange]);

    const { isListening, isSupported, interimText, toggleListening } = useVoiceDictation({
        onTranscript: handleTranscript,
    });

    return (
        <div className="relative">
            <textarea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={className}
                rows={rows}
            />
            {isSupported && (
                <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute top-3 right-3 p-2 rounded-xl transition-all ${isListening
                        ? 'bg-red-100 text-red-500 animate-pulse shadow-sm'
                        : 'text-stone-300 hover:text-[#E07A5F] hover:bg-stone-100'
                        }`}
                    title="Dictée vocale"
                >
                    {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
            )}
            {isListening && interimText && (
                <div className="mt-1.5 px-3 py-1.5 bg-red-50 border border-red-100 rounded-xl text-xs text-red-500 italic">
                    🎙️ {interimText}...
                </div>
            )}
        </div>
    );
};

// --- TEST SUMMARY PANEL (replaces Points d'appel) ---
const TestSummaryPanel: React.FC<{ tests: TestData }> = ({ tests }) => {
    const { catalog } = useCatalog();

    const testScores = useMemo(() => {
        const testNameMap: Record<string, string> = {};
        catalog.forEach(cat => {
            cat.tests.forEach(t => {
                testNameMap[t.id] = t.name;
            });
        });

        const scores: { testId: string; name: string; avg: number; count: number }[] = [];
        Object.entries(tests).forEach(([testId, subtests]) => {
            const zScores: number[] = [];
            Object.values(subtests).forEach(res => {
                // Include ALL scored results, even estimated ones
                if (res.raw && res.zScore !== undefined && res.zScore !== null) {
                    zScores.push(res.zScore);
                }
            });
            if (zScores.length > 0) {
                const avg = zScores.reduce((a, b) => a + b, 0) / zScores.length;
                scores.push({ testId, name: testNameMap[testId] || testId, avg, count: zScores.length });
            }
        });
        return scores;
    }, [tests, catalog]);

    if (testScores.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-6 shadow-sm">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Activity size={14} /> Résumé par test
            </h4>
            <div className="space-y-2">
                {testScores.map(({ testId, name, avg }) => {
                    let color = '#81B29A';
                    if (avg <= -2) color = '#E07A5F';
                    else if (avg <= -1) color = '#F2CC8F';
                    const barWidth = Math.min(100, Math.max(5, ((avg + 3.5) / 7) * 100));

                    return (
                        <div key={testId}>
                            <div className="flex justify-between text-[10px] mb-1">
                                <span className="text-stone-500 font-medium truncate max-w-[130px]">{name}</span>
                                <span className="font-bold" style={{ color }}>{avg > 0 ? '+' : ''}{avg.toFixed(1)} ET</span>
                            </div>
                            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- TOGGLEABLE SUGGESTIONS ---
const DIAG_SUGGESTIONS = [
    { label: "Trouble Développemental de la Coordination (TDC)", category: "moteur" },
    { label: "TDC type mixte", category: "moteur" },
    { label: "Dysgraphie fonctionnelle", category: "graphique" },
    { label: "Dyspraxie visuo-constructive", category: "moteur" },
    { label: "Trouble de l'attention (TDAH)", category: "cognitif" },
    { label: "Retard de développement psychomoteur", category: "moteur" },
    { label: "Trouble du traitement visuo-spatial", category: "cognitif" },
    { label: "Pas de trouble avéré - Fragilités isolées", category: "autre" },
];

const RECO_SUGGESTIONS = [
    { label: "Suivi hebdomadaire 45min", category: "suivi" },
    { label: "Suivi bi-hebdomadaire 45min", category: "suivi" },
    { label: "Mise en place de l'outil informatique", category: "outil" },
    { label: "Aménagements scolaires (PAP)", category: "scolaire" },
    { label: "Aménagements scolaires (PPS)", category: "scolaire" },
    { label: "Guidance parentale", category: "famille" },
    { label: "Bilan de contrôle dans 6 mois", category: "suivi" },
    { label: "Coordination pluridisciplinaire", category: "suivi" },
    { label: "Tiers-temps aux examens", category: "scolaire" },
];

const ToggleChips: React.FC<{
    suggestions: { label: string; category: string }[];
    currentValue: string;
    onToggle: (val: string) => void;
    colorScheme: 'indigo' | 'emerald';
}> = ({ suggestions, currentValue, onToggle, colorScheme }) => {
    const activeLabels = currentValue.split(' - ').map(s => s.trim()).filter(Boolean);

    const handleToggle = (label: string) => {
        if (activeLabels.includes(label)) {
            const newLabels = activeLabels.filter(l => l !== label);
            onToggle(newLabels.join(' - '));
        } else {
            onToggle([...activeLabels, label].join(' - '));
        }
    };

    const colors = colorScheme === 'indigo'
        ? { active: 'bg-indigo-100 text-indigo-700 border-indigo-200', hover: 'hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100' }
        : { active: 'bg-emerald-100 text-emerald-700 border-emerald-200', hover: 'hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-100' };

    // Group by category
    const categories = [...new Set(suggestions.map(s => s.category))];

    return (
        <div className="space-y-3">
            {categories.map(cat => (
                <div key={cat} className="flex flex-wrap gap-2">
                    {suggestions.filter(s => s.category === cat).map(({ label }) => {
                        const isActive = activeLabels.includes(label);
                        return (
                            <button
                                key={label}
                                onClick={() => handleToggle(label)}
                                className={`px-3 py-1.5 border rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${isActive
                                    ? `${colors.active} shadow-sm`
                                    : `bg-stone-50 border-stone-100 text-stone-500 ${colors.hover}`
                                    }`}
                            >
                                {isActive && <Check size={10} strokeWidth={3} />}
                                {label}
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
    );
};

// --- OBSERVATION SUMMARY from per-subtest observations ---
const ObservationsSummary: React.FC<{ tests: TestData; interviewNotes?: string }> = ({ tests, interviewNotes }) => {
    const { catalog } = useCatalog();

    const observations = useMemo(() => {
        const subtestNameMap: Record<string, string> = {};
        catalog.forEach(cat => {
            cat.tests.forEach(t => {
                t.subtests.forEach(st => {
                    subtestNameMap[st.id] = st.name;
                });
            });
        });

        const items: { subId: string; name: string; text: string }[] = [];
        Object.entries(tests).forEach(([testId, subtests]) => {
            Object.entries(subtests).forEach(([subId, res]) => {
                if (res.observation && res.observation.trim()) {
                    items.push({ subId, name: subtestNameMap[subId] || subId, text: res.observation });
                }
            });
        });
        return items;
    }, [tests, catalog]);

    if (observations.length === 0 && !interviewNotes) return null;

    return (
        <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <MessageSquare size={14} /> Observations cliniques
            </h4>

            {interviewNotes && (
                <div className="bg-stone-50 p-3 rounded-xl mb-3">
                    <span className="text-[9px] font-bold text-stone-400 uppercase">Entretien</span>
                    <p className="text-xs text-stone-600 italic leading-relaxed mt-1">
                        {interviewNotes.length > 150 ? interviewNotes.substring(0, 150) + '…' : interviewNotes}
                    </p>
                </div>
            )}

            {observations.length > 0 && (
                <div className="space-y-2">
                    {observations.slice(0, 5).map((obs, i) => (
                        <div key={i} className="flex gap-2 text-xs">
                            <span className="text-stone-400 font-bold shrink-0">{obs.name}:</span>
                            {obs.name === obs.subId && (
                                <span className="text-[9px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded self-center">
                                    id
                                </span>
                            )}
                            <span className="text-stone-600 italic truncate">{obs.text}</span>
                        </div>
                    ))}
                    {observations.length > 5 && (
                        <span className="text-[10px] text-stone-400">+{observations.length - 5} autres…</span>
                    )}
                </div>
            )}
        </div>
    );
};

export const Step3BisDiagnostic: React.FC<Props> = ({ synthesis, updateSynthesis, tests, observations, patient, onNext, onBack, isGenerating }) => {

    const handleDiagChange = (val: string) => updateSynthesis({ diagnosticInput: val });
    const handleRecoChange = (val: string) => updateSynthesis({ recommendationsInput: val });

    // Certification stats
    const certStats = useMemo(() => {
        let total = 0, certified = 0;
        Object.values(tests).forEach(subtests => {
            Object.values(subtests).forEach((res: any) => {
                if (res.raw) { total++; if (res.status === 'certified' || res.status === 'validated') certified++; }
            });
        });
        return { total, certified, allCertified: total > 0 && certified === total };
    }, [tests]);

    return (
        <div className="max-w-6xl mx-auto pb-32 animate-in fade-in duration-500">

            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-serif font-bold text-[#3D405B]">Synthèse & Projet</h2>
                    <p className="text-stone-500 font-medium mt-2">Posez votre diagnostic. L'IA se chargera de l'argumenter.</p>
                </div>
                {certStats.total > 0 && (
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold ${certStats.allCertified ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'
                        }`}>
                        {certStats.allCertified
                            ? <><ShieldCheck size={14} /> {certStats.certified}/{certStats.total} scores certifiés</>
                            : <><AlertTriangle size={14} /> {certStats.certified}/{certStats.total} certifiés</>
                        }
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* LEFT COLUMN (INPUT) */}
                <div className="lg:col-span-2 space-y-8">

                    {/* DIAGNOSTIC BLOCK */}
                    <div className="bg-white p-8 rounded-[32px] border border-stone-100 shadow-sm relative group hover:border-indigo-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[#3D405B]">
                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><Brain size={24} /></div>
                            <div>
                                <h3 className="font-bold text-xl">Conclusion Diagnostique</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Cliquez pour ajouter/retirer · Dictée vocale · Texte libre</p>
                            </div>
                        </div>

                        <VoiceArea
                            value={synthesis.diagnosticInput}
                            onChange={handleDiagChange}
                            placeholder="Ex: TDC mixte associé à une dysgraphie. L'impact sur la scolarité est majeur..."
                            className="w-full p-4 pr-14 bg-[#F9F9F9] rounded-2xl border-2 border-transparent outline-none resize-none font-medium text-[#3D405B] placeholder:text-stone-300 focus:bg-white focus:border-indigo-200 transition-all leading-relaxed mb-4"
                            rows={4}
                        />

                        <ToggleChips
                            suggestions={DIAG_SUGGESTIONS}
                            currentValue={synthesis.diagnosticInput}
                            onToggle={handleDiagChange}
                            colorScheme="indigo"
                        />
                    </div>

                    {/* PROJECT/RECOMMENDATIONS BLOCK */}
                    <div className="bg-white p-8 rounded-[32px] border border-stone-100 shadow-sm relative group hover:border-emerald-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[#3D405B]">
                            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl"><Target size={24} /></div>
                            <div>
                                <h3 className="font-bold text-xl">Projet & Préconisations</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Sélectionnez puis personnalisez librement</p>
                            </div>
                        </div>

                        <VoiceArea
                            value={synthesis.recommendationsInput}
                            onChange={handleRecoChange}
                            placeholder="Ex: Suivi hebdo. Apprentissage du clavier caché. Mise en place tiers-temps."
                            className="w-full p-4 pr-14 bg-[#F9F9F9] rounded-2xl border-2 border-transparent outline-none resize-none font-medium text-[#3D405B] placeholder:text-stone-300 focus:bg-white focus:border-emerald-200 transition-all leading-relaxed mb-4"
                            rows={4}
                        />

                        <ToggleChips
                            suggestions={RECO_SUGGESTIONS}
                            currentValue={synthesis.recommendationsInput}
                            onToggle={handleRecoChange}
                            colorScheme="emerald"
                        />
                    </div>

                </div>

                {/* RIGHT COLUMN (CONTEXT) */}
                <div className="space-y-6">
                    <TestSummaryPanel tests={tests} />
                    <ObservationsSummary tests={tests} interviewNotes={patient?.interviewNotes} />

                    <div className="bg-[#fffdf5] border border-[#F2CC8F]/50 p-6 rounded-2xl">
                        <h4 className="font-bold text-[#d97706] mb-3 flex items-center gap-2 text-sm">
                            <Lightbulb size={16} /> Pourquoi cette étape ?
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
                        className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all ${isGenerating ? 'bg-stone-300 cursor-not-allowed' : 'bg-[#3D405B] hover:bg-[#E07A5F] hover:-translate-y-1'
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
