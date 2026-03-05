
import React, { useState, useCallback, useMemo } from 'react';
import type { ClinicalSynthesis, TestData, Observations, Patient, ScoreResult } from '../../types';
import { Sparkles, Brain, Target, Lightbulb, Activity, Quote, ShieldCheck, AlertTriangle, Mic, MicOff, Check } from 'lucide-react';
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
                        : 'text-[var(--text-disabled)] hover:text-[#E07A5F] hover:bg-[var(--hover-bg)]'
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

// --- SCORES & OBSERVATIONS PANEL (merged, expandable) ---
const ScoresAndObservationsPanel: React.FC<{ tests: TestData; interviewNotes?: string }> = ({ tests, interviewNotes }) => {
    const { catalog } = useCatalog();
    const [notesExpanded, setNotesExpanded] = useState(false);

    const { testInfoMap, subtestNameMap } = useMemo(() => {
        const testInfoMap: Record<string, { name: string; categoryName: string }> = {};
        const subtestNameMap: Record<string, string> = {};
        catalog.forEach(cat => {
            cat.tests.forEach(t => {
                testInfoMap[t.id] = { name: t.name, categoryName: cat.name };
                t.subtests.forEach(st => {
                    subtestNameMap[st.id] = (st as any).displayName || st.name;
                });
            });
        });
        return { testInfoMap, subtestNameMap };
    }, [catalog]);

    const groupedData = useMemo((): Record<string, { testId: string; name: string; avg: number | null; subtests: { subId: string; name: string; res: ScoreResult }[] }[]> => {
        const result: Record<string, { testId: string; name: string; avg: number | null; subtests: { subId: string; name: string; res: ScoreResult }[] }[]> = {};
        Object.entries(tests).forEach(([testId, subtestMap]) => {
            const zScores: number[] = [];
            const subtestList: { subId: string; name: string; res: ScoreResult }[] = [];
            Object.entries(subtestMap).forEach(([subId, res]) => {
                if (typeof res.zScore === 'number' && Number.isFinite(res.zScore)) zScores.push(res.zScore);
                const hasData = !!(res.raw?.trim() || res.standard?.trim() || res.percentile?.trim() ||
                    Number.isFinite(res.zScore) || res.qualitativeCode?.trim() || res.qualitativeLabel?.trim());
                if (hasData) subtestList.push({ subId, name: subtestNameMap[subId] || subId, res });
            });
            if (subtestList.length === 0) return;
            const avg = zScores.length > 0 ? zScores.reduce((a, b) => a + b, 0) / zScores.length : null;
            const info = testInfoMap[testId];
            const categoryName = info?.categoryName || 'Autre';
            const testName = info?.name || testId;
            if (!result[categoryName]) result[categoryName] = [];
            result[categoryName].push({ testId, name: testName, avg, subtests: subtestList });
        });
        return result;
    }, [tests, testInfoMap, subtestNameMap]);

    const zColor = (z?: number | null): string => {
        if (z == null || !Number.isFinite(z)) return '#94a3b8';
        if (z <= -2) return '#E07A5F';
        if (z <= -1) return '#F2CC8F';
        return '#81B29A';
    };

    const hasContent = Object.keys(groupedData).length > 0;
    if (!hasContent && !interviewNotes) return null;

    return (
        <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-sm overflow-hidden">

            {/* Panel header */}
            <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border-color)] flex items-center gap-2">
                <Activity size={13} className="text-stone-400" />
                <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Scores & Observations</h4>
            </div>

            {/* Interview notes */}
            {interviewNotes && (
                <div className="px-4 py-2.5 border-b border-[var(--border-color)] bg-amber-50/60 dark:bg-amber-950/20 flex items-start gap-2">
                    <Quote size={10} className="text-amber-500 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className={`text-[10px] text-amber-900 dark:text-amber-200/80 italic leading-relaxed ${!notesExpanded && interviewNotes.length > 120 ? 'line-clamp-2' : ''}`}>
                            {interviewNotes}
                        </p>
                        {interviewNotes.length > 120 && (
                            <button onClick={() => setNotesExpanded(p => !p)} className="text-[9px] text-amber-600 dark:text-amber-400 font-bold mt-0.5 hover:underline">
                                {notesExpanded ? 'Réduire' : 'Voir tout'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Table */}
            <table className="w-full border-collapse text-left">
                <tbody>
                    {(Object.entries(groupedData) as [string, { testId: string; name: string; avg: number | null; subtests: { subId: string; name: string; res: ScoreResult }[] }[]][]).map(([categoryName, testEntries]) => (
                        <React.Fragment key={categoryName}>
                            {/* Category row */}
                            <tr>
                                <td colSpan={3} className="px-4 py-1.5 bg-[var(--hover-bg)] border-y border-[var(--border-color)]">
                                    <span className="text-[9px] font-bold text-[#E07A5F] uppercase tracking-widest">{categoryName}</span>
                                </td>
                            </tr>

                            {testEntries.map(({ testId, name, avg, subtests }) => {
                                const color = zColor(avg);
                                return (
                                    <React.Fragment key={testId}>
                                        {/* Test row */}
                                        <tr className="bg-[var(--app-bg)]">
                                            <td colSpan={2} className="px-4 pt-3 pb-1.5 flex items-center gap-2">
                                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                                <span className="text-[11px] font-bold text-[var(--text-heading)] flex-1">{name}</span>
                                                {avg !== null && (
                                                    <span className="text-[10px] font-bold tabular-nums shrink-0" style={{ color }}>
                                                        {avg > 0 ? '+' : ''}{avg.toFixed(1)} ET
                                                    </span>
                                                )}
                                            </td>
                                        </tr>

                                        {/* Subtest rows */}
                                        {subtests.map(({ subId, name: subName, res }) => {
                                            const z = res.zScore ?? res.derived?.zScore;
                                            const pct = res.percentile || res.derived?.percentile;
                                            const col = zColor(z);
                                            const hasObs = !!res.observation?.trim();
                                            const hasZ = typeof z === 'number' && Number.isFinite(z);
                                            const barW = hasZ ? Math.min(100, Math.max(2, ((z! + 3.5) / 7) * 100)) : null;

                                            return (
                                                <tr
                                                    key={subId}
                                                    className={`border-t border-[var(--border-color)]/40 ${hasObs ? 'bg-violet-50/30 dark:bg-violet-950/15' : ''}`}
                                                >
                                                    {/* Name + obs */}
                                                    <td className="pl-7 pr-3 py-1.5" colSpan={2}>
                                                        <div className="flex items-center gap-1.5 mb-1">
                                                            <span className="w-[2px] h-3 rounded-full shrink-0" style={{ backgroundColor: col }} />
                                                            <span className="text-[10px] text-[var(--text-secondary)] leading-tight flex-1">{subName}</span>
                                                            {/* qualitative label replaces bar when no z */}
                                                            {!hasZ && res.qualitativeLabel && (
                                                                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0" style={{ color: col, borderColor: col + '60', backgroundColor: col + '18' }}>
                                                                    {res.qualitativeLabel}
                                                                </span>
                                                            )}
                                                            {!hasZ && !res.qualitativeLabel && pct?.trim() && (
                                                                <span className="text-[9px] text-stone-400 tabular-nums shrink-0">P{pct}</span>
                                                            )}
                                                        </div>
                                                        {/* Mini ET bar */}
                                                        {hasZ && (
                                                            <div className="flex items-center gap-2 pl-3.5">
                                                                <div className="flex-1 h-[3px] bg-[var(--progress-bg)] rounded-full overflow-hidden">
                                                                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barW}%`, backgroundColor: col }} />
                                                                </div>
                                                                <span className="text-[9px] font-bold tabular-nums shrink-0" style={{ color: col }}>
                                                                    {z! > 0 ? '+' : ''}{z!.toFixed(1)} ET
                                                                </span>
                                                            </div>
                                                        )}
                                                        {hasObs && (
                                                            <div className="mt-1 pl-3.5 flex items-start gap-1">
                                                                <Quote size={8} className="text-violet-400 mt-0.5 shrink-0" />
                                                                <p className="text-[9px] text-violet-600 dark:text-violet-300 italic leading-snug">{res.observation}</p>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
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
        ? { active: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700/40', hover: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-indigo-100 dark:hover:border-indigo-700/20' }
        : { active: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700/40', hover: 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-100 dark:hover:border-emerald-700/20' };

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
                                    : `bg-[var(--hover-bg)] border-[var(--border-color)] text-[var(--text-secondary)] ${colors.hover}`
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



export const Step3BisDiagnostic: React.FC<Props> = ({ synthesis, updateSynthesis, tests, observations, patient, onNext, onBack, isGenerating }) => {

    const handleDiagChange = (val: string) => updateSynthesis({ diagnosticInput: val });
    const handleRecoChange = (val: string) => updateSynthesis({ recommendationsInput: val });

    const hasScoreValue = (res: any) =>
        !!(
            (res.raw && String(res.raw).trim()) ||
            (res.standard && String(res.standard).trim()) ||
            (res.percentile && String(res.percentile).trim()) ||
            (typeof res.zScore === 'number' && Number.isFinite(res.zScore)) ||
            (res.qualitativeCode && String(res.qualitativeCode).trim())
        );
    const isReviewed = (res: any) => res.reviewState === 'reviewed' || res.status === 'validated' || res.status === 'certified';

    // Review stats
    const reviewStats = useMemo(() => {
        let total = 0;
        let reviewed = 0;
        Object.values(tests).forEach(subtests => {
            Object.values(subtests).forEach((res: any) => {
                if (hasScoreValue(res)) {
                    total++;
                    if (isReviewed(res)) reviewed++;
                }
            });
        });
        return { total, reviewed, allReviewed: total > 0 && reviewed === total };
    }, [tests]);

    return (
        <div className="max-w-6xl mx-auto pb-32 animate-in fade-in duration-500">

            <div className="flex justify-between items-end mb-8">
                <div>
                    <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Synthèse & Projet</h2>
                    <p className="text-stone-500 font-medium mt-2">Posez votre diagnostic. L'IA se chargera de l'argumenter.</p>
                </div>
                {reviewStats.total > 0 && (
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold ${reviewStats.allReviewed ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40' : 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40'
                        }`}>
                        {reviewStats.allReviewed
                            ? <><ShieldCheck size={14} /> {reviewStats.reviewed}/{reviewStats.total} scores revus</>
                            : <><AlertTriangle size={14} /> {reviewStats.reviewed}/{reviewStats.total} revus</>
                        }
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* LEFT COLUMN (INPUT) */}
                <div className="lg:col-span-2 space-y-8">

                    {/* DIAGNOSTIC BLOCK */}
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-indigo-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
                            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl"><Brain size={24} /></div>
                            <div>
                                <h3 className="font-bold text-xl">Conclusion Diagnostique</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Cliquez pour ajouter/retirer · Dictée vocale · Texte libre</p>
                            </div>
                        </div>

                        <VoiceArea
                            value={synthesis.diagnosticInput}
                            onChange={handleDiagChange}
                            placeholder="Ex: TDC mixte associé à une dysgraphie. L'impact sur la scolarité est majeur..."
                            className="w-full p-4 pr-14 bg-[var(--app-bg)] rounded-2xl border-2 border-transparent outline-none resize-none font-medium text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] focus:bg-[var(--card-bg)] focus:border-indigo-200 transition-all leading-relaxed mb-4"
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
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-emerald-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl"><Target size={24} /></div>
                            <div>
                                <h3 className="font-bold text-xl">Projet & Préconisations</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Sélectionnez puis personnalisez librement</p>
                            </div>
                        </div>

                        <VoiceArea
                            value={synthesis.recommendationsInput}
                            onChange={handleRecoChange}
                            placeholder="Ex: Suivi hebdo. Apprentissage du clavier caché. Mise en place tiers-temps."
                            className="w-full p-4 pr-14 bg-[var(--app-bg)] rounded-2xl border-2 border-transparent outline-none resize-none font-medium text-[var(--text-heading)] placeholder:text-[var(--text-disabled)] focus:bg-[var(--card-bg)] focus:border-emerald-200 transition-all leading-relaxed mb-4"
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
                    <ScoresAndObservationsPanel tests={tests} interviewNotes={patient?.interviewNotes} />

                    <div className="bg-[#fffdf5] dark:bg-amber-950/30 border border-[#F2CC8F]/50 dark:border-amber-800/30 p-6 rounded-2xl">
                        <h4 className="font-bold text-[#d97706] dark:text-amber-400 mb-3 flex items-center gap-2 text-sm">
                            <Lightbulb size={16} /> Pourquoi cette étape ?
                        </h4>
                        <p className="text-xs text-[#92400e] dark:text-amber-200/80 leading-relaxed mb-2">
                            L'IA ne pose pas de diagnostic, <strong>c'est votre rôle légal</strong>.
                        </p>
                        <p className="text-xs text-[#92400e] dark:text-amber-200/80 leading-relaxed">
                            En remplissant ces champs, vous orientez la rédaction. L'IA utilisera vos conclusions pour structurer l'argumentaire et lier les preuves (scores) à votre diagnostic.
                        </p>
                    </div>
                </div>

            </div>

            {/* NAVIGATION FOOTER */}
            <div className="fixed bottom-0 left-0 right-0 p-6 bg-[var(--card-bg)] backdrop-blur-md border-t border-[var(--border-color)] flex justify-center z-50">
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

