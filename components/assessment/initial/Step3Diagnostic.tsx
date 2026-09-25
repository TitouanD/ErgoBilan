import React, { useState, useMemo } from 'react';
import type { ClinicalSynthesis, TestData, Patient, ScoreResult } from '../../../types';
import { Sparkles, Brain, Target, Lightbulb, Activity, Quote } from 'lucide-react';
import { VoiceTextarea } from '../../shared/VoiceTextarea';
import { useCatalog } from '../../../contexts/CatalogContext';
import { StepNavFooter } from '../shared/StepNavFooter';
import { ZONE_META, getZFromScore, hasScoreValue, zoneFromZ } from '../../../utils/scoring';
import { getScaleType, getSubtestName, getTestName } from '../../../utils/catalogIndex';

interface Props {
    synthesis: ClinicalSynthesis;
    updateSynthesis: (data: Partial<ClinicalSynthesis>) => void;
    tests: TestData;
    patient?: Patient;
    onNext: () => void;
    onBack: () => void;
    isGenerating: boolean;
}

/** Score label matching the unit actually entered by the practitioner (NS/ET/%),
 *  instead of always converting to a derived z-score. A z-score is only used as a
 *  last-resort fallback for legacy/edge-case data that carries no unit information
 *  (e.g. raw scores with no norms). */
const getEnteredScoreLabel = (res: ScoreResult, z: number | null): string | null => {
    if (res.unit === 'NS' && res.value?.trim()) return `NS ${res.value}`;
    if (res.unit === '%' && res.value?.trim()) return `${res.value}%`;
    if (res.unit === 'ET' && res.value?.trim()) {
        const v = parseFloat(res.value);
        return `${Number.isFinite(v) && v > 0 ? '+' : ''}${res.value} ET`;
    }
    if (res.qualitativeLabel) return res.qualitativeLabel;
    if (typeof z === 'number' && Number.isFinite(z)) return `${z > 0 ? '+' : ''}${z.toFixed(1)} ET`;
    return null;
};

// --- SCORES & OBSERVATIONS PANEL (merged, expandable) ---
const ScoresAndObservationsPanel: React.FC<{ tests: TestData; interviewNotes?: string }> = ({ tests, interviewNotes }) => {
    const { index } = useCatalog();
    const [notesExpanded, setNotesExpanded] = useState(false);
    const [panelExpanded, setPanelExpanded] = useState(false);

    const groupedData = useMemo(
        () =>
            Object.entries(tests).flatMap(([testId, subtestMap]) => {
                const zScores: number[] = [];
                const subtests: { subId: string; name: string; res: ScoreResult; scoreType: string }[] = [];
                // Subtests keep the insertion order of tests[testId] (drag-and-drop order of the score page).
                for (const [subId, res] of Object.entries(subtestMap)) {
                    const scoreType = getScaleType(index, testId, subId);
                    const z = getZFromScore(res, scoreType);
                    if (z !== null) zScores.push(z);
                    if (hasScoreValue(res)) subtests.push({ subId, name: getSubtestName(index, testId, subId, res.customLabel), res, scoreType });
                }
                if (subtests.length === 0) return [];
                const avg = zScores.length > 0 ? zScores.reduce((x, y) => x + y, 0) / zScores.length : null;
                return [{ testId, name: getTestName(index, testId), avg, subtests }];
            }),
        [tests, index],
    );

    const zColor = (z?: number | null): string => {
        const zone = zoneFromZ(z);
        return zone ? ZONE_META[zone].color : '#94a3b8';
    };

    const hasContent = groupedData.length > 0;
    if (!hasContent && !interviewNotes) return null;

    return (
        <>
        {panelExpanded && (
            <div
                className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
                onClick={() => setPanelExpanded(false)}
            >
                <div
                    className="w-full max-w-6xl max-h-[85vh] overflow-y-auto bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border-color)] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Activity size={13} className="text-stone-400" />
                            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Scores & Observations</h4>
                        </div>
                        <button onClick={() => setPanelExpanded(false)} className="p-1.5 rounded-lg hover:bg-[var(--hover-bg)] text-stone-400 hover:text-[var(--text-heading)] transition-colors" title="Fermer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                    </div>
                    <div className="divide-y divide-[var(--border-color)]">
                        {groupedData.length === 0 && (
                            <p className="text-center text-xs text-[var(--text-secondary)] py-8">Aucun score enregistré.</p>
                        )}
                        {groupedData.map(({ testId, name: testName, avg, subtests }, testIdx) => {
                            const testColor = zColor(avg);
                            return (
                                <div key={testId} className={`p-4 ${testIdx % 2 === 1 ? 'bg-stone-50/80 dark:bg-stone-900/30' : ''}`}>
                                    <h5 className="text-xs font-bold text-[var(--text-heading)] mb-2 leading-tight flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: testColor }} />
                                        {testName}
                                    </h5>
                                    <div className="space-y-1.5 pl-3">
                                        {subtests.map(({ subId, name: subName, res, scoreType }) => {
                                            const z = getZFromScore(res, scoreType);
                                            const col = (z !== null && Number.isFinite(z)) ? zColor(z) : '#94a3b8';
                                            const scoreStr = getEnteredScoreLabel(res, z);
                                            const hasObs = !!res.observation?.trim();
                                            return (
                                                <div key={subId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs py-0.5">
                                                    <span className="text-[var(--text-secondary)]">{subName}</span>
                                                    {scoreStr && <span className="font-bold tabular-nums" style={{ color: col }}>{scoreStr}</span>}
                                                    {hasObs && <span className="italic text-[var(--text-secondary)]">« {res.observation} »</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {interviewNotes && (
                        <div className="p-4 border-t border-[var(--border-color)]">
                            <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Notes d'entretien</p>
                            <p className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed">{interviewNotes}</p>
                        </div>
                    )}
                </div>
            </div>
        )}
        <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-sm overflow-hidden">

            {/* Panel header */}
            <div className="px-4 pt-3 pb-2.5 border-b border-[var(--border-color)] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Activity size={13} className="text-stone-400" />
                    <h4 className="text-xs font-bold text-stone-400 uppercase tracking-wider">Scores & Observations</h4>
                </div>
                <button
                    onClick={() => setPanelExpanded(v => !v)}
                    className="p-1 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] hover:text-[#E07A5F] transition-colors"
                    title={panelExpanded ? 'Réduire' : 'Agrandir'}
                >
                    {panelExpanded ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3v3a2 2 0 01-2 2H3M21 8h-3a2 2 0 01-2-2V3M3 16h3a2 2 0 012 2v3M16 21v-3a2 2 0 012-2h3"/></svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    )}
                </button>
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
                    {groupedData.map(({ testId, name, avg, subtests }) => {
                        const color = zColor(avg);
                        return (
                            <React.Fragment key={testId}>
                                {/* Test row */}
                                <tr className="bg-[var(--app-bg)]">
                                    <td colSpan={2} className="px-4 pt-3 pb-1.5 flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                        <span className="text-[11px] font-bold text-[var(--text-heading)] flex-1">{name}</span>
                                    </td>
                                </tr>

                                {/* Subtest rows */}
                                {subtests.map(({ subId, name: subName, res, scoreType }) => {
                                    const z = getZFromScore(res, scoreType);
                                    const col = zColor(z);
                                    const hasObs = !!res.observation?.trim();
                                    const hasZ = typeof z === 'number' && Number.isFinite(z);
                                    const barW = hasZ ? Math.min(100, Math.max(2, ((z! + 3.5) / 7) * 100)) : null;
                                    const scoreLabel = getEnteredScoreLabel(res, z);

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
                                                    {/* score badge replaces the bar when no z can be computed */}
                                                    {!hasZ && scoreLabel && (
                                                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border shrink-0" style={{ color: col, borderColor: col + '60', backgroundColor: col + '18' }}>
                                                            {scoreLabel}
                                                        </span>
                                                    )}
                                                </div>
                                                {/* Mini ET bar — color/position derived from z-score, label reflects entered unit */}
                                                {hasZ && (
                                                    <div className="flex items-center gap-2 pl-3.5">
                                                        <div className="flex-1 h-[3px] bg-[var(--progress-bg)] rounded-full overflow-hidden">
                                                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${barW}%`, backgroundColor: col }} />
                                                        </div>
                                                        <span className="text-[9px] font-bold tabular-nums shrink-0" style={{ color: col }}>
                                                            {scoreLabel}
                                                        </span>
                                                    </div>
                                                )}
                                                {hasObs && (
                                                    <div className="mt-1 pl-3.5">
                                                        <p className="text-[9px] text-violet-600 dark:text-violet-300 italic leading-snug">« {res.observation} »</p>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </React.Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
        </>
    );
};

export const Step3BisDiagnostic: React.FC<Props> = ({ synthesis, updateSynthesis, tests, patient, onNext, onBack, isGenerating }) => {

    const handleDiagChange = (val: string) => updateSynthesis({ diagnosticInput: val });
    const handleProjectChange = (val: string) => updateSynthesis({ projectInput: val });
    const handleRecoChange = (val: string) => updateSynthesis({ recommendationsInput: val });

    const isReadyToGenerate = synthesis.diagnosticInput.trim().length > 0 && !isGenerating;

    return (
        <div className="max-w-6xl mx-auto pb-10 animate-in fade-in duration-500">

            <div className="mb-8 border-b border-[var(--border-color)] pb-6">
                <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)]">Diagnostic et projet d'accompagnement</h2>
                <p className="text-[var(--text-secondary)] font-medium mt-2">Posez votre diagnostic. L'IA se chargera de le rédiger.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                {/* LEFT COLUMN (INPUT) */}
                <div className="lg:col-span-2 space-y-8">

                    {/* DIAGNOSTIC BLOCK */}
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-indigo-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
                            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl"><Brain size={24} /></div>
                            <div>
                                <h3 className="font-bold text-xl">Diagnostic</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Votre conclusion clinique argumentée</p>
                            </div>
                        </div>

                        <VoiceTextarea
                            value={synthesis.diagnosticInput}
                            onChange={handleDiagChange}
                            placeholder={synthesis.diagnosticInput.trim() ? "Précisez ou complétez..." : "Ex: TDC mixte associé à une dysgraphie. L'impact sur la scolarité est majeur..."}
                            className="bg-[var(--app-bg)] rounded-2xl border-2 border-transparent focus:bg-[var(--card-bg)] focus:border-indigo-200 transition-all mt-4"
                            rows={8}
                        />
                    </div>

                    {/* PROJECT BLOCK */}
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-emerald-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
                            <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-xl"><Target size={24} /></div>
                            <div>
                                <h3 className="font-bold text-xl">Projet d'accompagnement</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Orientations globales du suivi</p>
                            </div>
                        </div>

                        <VoiceTextarea
                            value={synthesis.projectInput || ''}
                            onChange={handleProjectChange}
                            placeholder={synthesis.projectInput?.trim() ? "Précisez ou complétez..." : "Ex: Suivi ergo hebdomadaire. Accompagnement parental. Coordination équipe pluridisciplinaire."}
                            className="bg-[var(--app-bg)] rounded-2xl border-2 border-transparent focus:bg-[var(--card-bg)] focus:border-emerald-200 transition-all mt-4"
                            rows={8}
                        />
                    </div>

                    {/* RECOMMENDATIONS BLOCK */}
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] border border-[var(--border-color)] shadow-sm relative group hover:border-teal-200/50 transition-all">
                        <div className="flex items-center gap-3 mb-4 text-[var(--text-heading)]">
                            <div className="p-2 bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-xl">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                            </div>
                            <div>
                                <h3 className="font-bold text-xl">Préconisations</h3>
                                <p className="text-xs text-stone-400 mt-0.5">Aménagements, aides, outils concrets</p>
                            </div>
                        </div>

                        <VoiceTextarea
                            value={synthesis.recommendationsInput}
                            onChange={handleRecoChange}
                            placeholder={synthesis.recommendationsInput.trim() ? "Précisez ou complétez..." : "Ex: Tiers-temps aux examens. Mise en place du clavier caché. PAP."}
                            className="bg-[var(--app-bg)] rounded-2xl border-2 border-transparent focus:bg-[var(--card-bg)] focus:border-teal-200 transition-all mt-4"
                            rows={8}
                        />
                    </div>

                    {/* INFO BOX (moved under Préconisations) */}
                    <div className="bg-[#fffdf5] dark:bg-amber-950/30 border border-[#F2CC8F]/50 dark:border-amber-800/30 p-6 rounded-2xl">
                        <h4 className="font-bold text-[#d97706] dark:text-amber-400 mb-3 flex items-center gap-2 text-sm">
                            <Lightbulb size={16} /> Conseils de rédaction
                        </h4>
                        <p className="text-xs text-[#92400e] dark:text-amber-200/80 leading-relaxed mb-2">
                            L'IA ne pose pas de diagnostic, <strong>c'est votre rôle légal</strong>.
                        </p>
                        <p className="text-xs text-[#92400e] dark:text-amber-200/80 leading-relaxed">
                            En remplissant ces champs, vous orientez la rédaction. L'IA utilisera vos conclusions pour structurer l'argumentaire et lier les preuves (scores) à votre diagnostic.
                        </p>
                    </div>

                </div>

                {/* RIGHT COLUMN (CONTEXT) */}
                <div className="space-y-6">
                    <ScoresAndObservationsPanel tests={tests} interviewNotes={patient?.interviewNotes} />
                </div>

            </div>

            {/* NAVIGATION FOOTER */}
            <StepNavFooter onBack={onBack}>
                <button
                    onClick={onNext}
                    disabled={isGenerating || !synthesis.diagnosticInput.trim()}
                    className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all duration-300 disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed ${
                        isReadyToGenerate
                            ? 'bg-gradient-to-r from-[#E07A5F] to-[#d97706] hover:shadow-orange-200 dark:hover:shadow-orange-900/40 hover:scale-[1.02]'
                            : 'bg-[#3D405B] hover:bg-[#E07A5F]'
                    }`}
                >
                    {isGenerating ? (
                        <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            <span>Génération du rapport...</span>
                        </>
                    ) : (
                        <>
                            <Sparkles size={20} className={isReadyToGenerate ? 'animate-bounce' : ''} />
                            <span>{!synthesis.diagnosticInput.trim() ? 'Diagnostic requis' : 'Générer'}</span>
                        </>
                    )}
                </button>
            </StepNavFooter>
        </div>
    );
};

