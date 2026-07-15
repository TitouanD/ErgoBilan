/**
 * reevaluation/Step1Scores.tsx
 *
 * Side-by-side reevaluation scoring UI.
 * Reuses the same TableView component as Step2Tests to keep visual consistency.
 * Left panel: previous assessment scores (read-only, dated, filtered to used metric).
 * Right panel: new score entry (same metric, same table design).
 */

import React, { useMemo, useCallback } from 'react';
import type { Patient, TestData, Observations, UserProfile, ScoreResult } from '../../../types';
import { Activity, ArrowRight, Lock, Trash2 } from 'lucide-react';
import { useCatalog } from '../../../contexts/CatalogContext';
import { detectMetric } from '../../../utils/reevaluationHelpers';
import { TableView, compareSubtestsForDisplay, type Metric } from '../Step2Tests';

interface Props {
    patient: Patient;
    tests: TestData;
    updateTests: (data: TestData) => void;
    observations: Observations;
    updateObservations: (data: Partial<Observations>) => void;
    onNext: () => void;
    onBack: () => void;
    userProfile?: UserProfile;
    previousAssessmentDate?: string;
    previousTests: TestData;
}

/** Map ScoreMetric ('NS'|'ET'|'%') → Metric ('standard'|'z'|'percentile') */
const toMetric = (sm: 'NS' | 'ET' | '%'): Metric =>
    sm === 'ET' ? 'z' : sm === '%' ? 'percentile' : 'standard';

/** Detect the dominant entry metric across all subtests in a test block */
function detectDominantMetric(subtestData: Record<string, ScoreResult>): Metric {
    const counts: Record<Metric, number> = { standard: 0, z: 0, percentile: 0 };
    Object.values(subtestData).forEach(score => {
        counts[toMetric(detectMetric(score))]++;
    });
    if (counts.z >= counts.standard && counts.z >= counts.percentile) return 'z';
    if (counts.percentile > counts.standard) return 'percentile';
    return 'standard';
}

export const Step1Scores: React.FC<Props> = ({
    tests,
    updateTests,
    previousAssessmentDate,
    previousTests,
    onNext,
    onBack,
}) => {
    const { catalog } = useCatalog();

    /** Map testId → { testName, subtests[] } from catalog */
    const testDefMap = useMemo(() => {
        const map: Record<string, { testName: string; subtests: (typeof catalog)[0]['tests'][0]['subtests'] }> = {};
        catalog.forEach(cat => {
            cat.tests.forEach(t => {
                map[t.id] = { testName: t.name, subtests: t.subtests };
            });
        });
        return map;
    }, [catalog]);

    const testIds = useMemo(() => Object.keys(previousTests), [previousTests]);

    const formattedDate = previousAssessmentDate
        ? new Date(previousAssessmentDate).toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'long', year: 'numeric',
          })
        : null;

    const handleDeleteTest = useCallback((testId: string) => {
        const next = { ...tests };
        delete next[testId];
        updateTests(next);
    }, [tests, updateTests]);

    const handleUpdateSubtest = useCallback((testId: string, subId: string, patch: Partial<ScoreResult>) => {
        updateTests({
            ...tests,
            [testId]: {
                ...tests[testId],
                [subId]: { ...(tests[testId]?.[subId] || {}), ...patch },
            },
        });
    }, [tests, updateTests]);

    // No-op update handler for the read-only left panel
    const noopUpdate = useCallback((_t: string, _s: string, _p: Partial<ScoreResult>) => {}, []);

    return (
        <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-10">
            {/* Header */}
            <div className="mb-8 border-b border-[var(--border-color)] pb-6">
                <h2 className="text-3xl font-serif font-bold text-[var(--text-heading)] flex items-center gap-3">
                    <Activity size={24} className="text-[var(--primary)]" />
                    Saisie des nouvelles mesures
                </h2>
                {formattedDate && (
                    <p className="text-[var(--text-secondary)] font-medium mt-2">
                        Comparaison avec le bilan du <strong>{formattedDate}</strong>. Saisissez les nouveaux scores à droite.
                    </p>
                )}
            </div>

            {testIds.length === 0 && (
                <div className="rounded-[30px] border-2 border-dashed border-[var(--border-color)] bg-[var(--card-bg)] p-16 text-center shadow-sm">
                    <p className="text-[var(--text-heading)] font-bold text-lg">Aucun test à comparer</p>
                    <p className="mt-1 text-sm text-[var(--text-secondary)]">Le bilan précédent ne contient pas de données de tests.</p>
                </div>
            )}

            <div className="space-y-6">
                {testIds.map(testId => {
                    const entry = testDefMap[testId];
                    const prevData = previousTests[testId] || {};
                    const prevSubtestIds = Object.keys(prevData);

                    if (!entry || prevSubtestIds.length === 0) return null;

                    const subtestDefs = entry.subtests.filter(st => prevSubtestIds.includes(st.id));
                    const sortedSubtests = [...subtestDefs].sort(compareSubtestsForDisplay);
                    const tableMetric = detectDominantMetric(prevData);

                    return (
                        <div key={testId} className="overflow-hidden rounded-[28px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-[0_8px_30px_rgba(0,0,0,0.08)]">
                            {/* Card header */}
                            <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--hover-bg)] flex items-center justify-between gap-3">
                                <div>
                                    <h4 className="font-bold text-[var(--text-heading)]">{entry.testName}</h4>
                                    <p className="text-[11px] text-[var(--text-secondary)]">
                                        {sortedSubtests.length} épreuve(s)
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleDeleteTest(testId)}
                                    className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-rose-500 hover:border-rose-200 transition-colors shrink-0"
                                    title="Supprimer ce test de la réévaluation"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>

                            {/* Side-by-side panels */}
                            <div className="grid grid-cols-2 divide-x divide-[var(--border-color)]">
                                {/* LEFT — previous results, read-only */}
                                <div className="p-3">
                                    <div className="flex items-center gap-1.5 mb-2 px-1">
                                        <Lock size={10} className="text-[var(--text-disabled)]" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                                            {formattedDate ? `Bilan du ${formattedDate}` : 'Bilan précédent'}
                                        </span>
                                    </div>
                                    <TableView
                                        testId={testId}
                                        subtests={sortedSubtests}
                                        tests={previousTests}
                                        updateSubtest={noopUpdate}
                                        readOnly
                                        singleMetric={tableMetric}
                                    />
                                </div>

                                {/* RIGHT — new entry */}
                                <div className="p-3">
                                    <div className="flex items-center gap-1.5 mb-2 px-1">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--primary)]">
                                            Nouveaux résultats
                                        </span>
                                    </div>
                                    <TableView
                                        testId={testId}
                                        subtests={sortedSubtests}
                                        tests={tests}
                                        updateSubtest={handleUpdateSubtest}
                                        singleMetric={tableMetric}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Navigation */}
            <div className="mt-10 flex justify-between items-center gap-4">
                <button
                    onClick={onBack}
                    className="text-[var(--text-secondary)] hover:text-[var(--text-heading)] font-bold text-sm uppercase tracking-widest px-2 transition-colors"
                >
                    Retour
                </button>
                <button
                    onClick={onNext}
                    className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all bg-[var(--secondary)] hover:bg-[var(--primary)]"
                >
                    <span>Voir l'évolution</span>
                    <ArrowRight size={20} />
                </button>
            </div>
        </div>
    );
};
