/**
 * ReevStep1Scores — Step 1 of the reevaluation flow.
 *
 * Pre-loads tests from previousAssessment.tests. Each subtest shows
 * the initial score (read-only) alongside a new score input whose unit
 * (NS / ET / %) mirrors what was entered in the initial assessment.
 * ET is derived automatically and shown read-only.
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { Patient, TestData, ScoreResult, PatientAssessment } from '../../types';
import { ArrowRight, ArrowLeft, Plus, Trash2, TrendingUp, ChevronDown, ChevronUp, X } from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { deriveFromNS, normalCDF, zColor } from '../../services/scoringEngine';
import { useToast } from '../../contexts/ToastContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type EntryMetric = 'standard' | 'z' | 'percentile';

interface LocalSubtest {
    subtestId: string;
    entryMetric: EntryMetric;
    value: string;        // value in entryMetric's unit
    zScore: number | null; // derived, for display
    standard: string;     // derived
    percentile: string;   // derived
}

interface LocalTestGroup {
    testId: string;
    subtests: LocalSubtest[];
}

interface Props {
    patient: Patient;
    previousAssessment: PatientAssessment | null;
    currentTests: TestData;
    onUpdateTests: (tests: TestData) => void;
    onNext: () => void;
    onQuit: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Infer scale params from a stored ScoreResult (tries NS, QI, T, Sten). */
const inferScale = (standard: string | null | undefined, zScore: number | null | undefined): { mean: number; sd: number } => {
    const S = parseFloat(standard ?? '');
    const Z = typeof zScore === 'number' ? zScore : null;
    if (!isNaN(S) && Z !== null && Math.abs(Z) > 0.01) {
        const scales = [
            { mean: 10, sd: 3 },
            { mean: 100, sd: 15 },
            { mean: 50, sd: 10 },
            { mean: 5.5, sd: 2 },
        ];
        for (const s of scales) {
            if (Math.abs(S - (s.mean + Z * s.sd)) < 0.6) return s;
        }
    }
    return { mean: 10, sd: 3 }; // default NS
};

/** Detect which metric unit was used in a ScoreResult. */
const detectMetric = (score?: ScoreResult): EntryMetric => {
    if (!score) return 'standard';
    const em = score.entryMetric as EntryMetric | undefined;
    if (em === 'z' || em === 'percentile') return em;
    if (!score.standard?.trim() && typeof score.zScore === 'number') return 'z';
    if (!score.standard?.trim() && score.percentile?.trim()) return 'percentile';
    return 'standard';
};

const METRIC_LABEL: Record<EntryMetric, string> = { standard: 'NS', z: 'ET', percentile: '%' };

const formatScore = (score?: ScoreResult): string => {
    if (!score) return '—';
    const metric = detectMetric(score);
    if (metric === 'z' && typeof score.zScore === 'number') return `ET ${score.zScore > 0 ? '+' : ''}${score.zScore.toFixed(2)}`;
    if (metric === 'percentile' && score.percentile?.trim()) return `${score.percentile} %`;
    if (score.standard?.trim()) {
        const label = score.standard && parseFloat(score.standard) > 20 ? 'QI' : 'NS';
        return `${label} ${score.standard}`;
    }
    if (score.qualitativeLabel?.trim()) return score.qualitativeLabel;
    return '—';
};

// ─── Add-Test Modal ───────────────────────────────────────────────────────────

const AddTestModal: React.FC<{
    existingTestIds: Set<string>;
    onAdd: (testId: string, subtestIds: string[]) => void;
    onClose: () => void;
}> = ({ existingTestIds, onAdd, onClose }) => {
    const { catalog } = useCatalog();
    const [query, setQuery] = useState('');
    const [expandedTest, setExpandedTest] = useState<string | null>(null);

    const filtered = useMemo(() => {
        const q = query.toLowerCase();
        return catalog.flatMap(cat => cat.tests)
            .filter(t => !existingTestIds.has(t.id))
            .filter(t => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
    }, [catalog, existingTestIds, query]);

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-[32px] bg-[var(--card-bg)] shadow-2xl flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between p-6 border-b border-[var(--border-color)]">
                    <h3 className="font-serif text-xl font-bold text-[var(--text-heading)]">Ajouter un test</h3>
                    <button onClick={onClose} className="text-[var(--text-disabled)] hover:text-[var(--text-main)]">
                        <X size={20} />
                    </button>
                </div>
                <div className="p-4 border-b border-[var(--border-color)]">
                    <input
                        type="text"
                        placeholder="Rechercher un test..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm outline-none focus:border-[var(--primary)]"
                        autoFocus
                    />
                </div>
                <div className="overflow-y-auto flex-1 p-2">
                    {filtered.length === 0 ? (
                        <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Aucun test disponible.</p>
                    ) : (
                        filtered.map(test => (
                            <div key={test.id} className="rounded-xl border border-[var(--border-color)] mb-2 overflow-hidden">
                                <button
                                    className="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--hover-bg)]"
                                    onClick={() => setExpandedTest(expandedTest === test.id ? null : test.id)}
                                >
                                    <div>
                                        <p className="text-sm font-bold text-[var(--text-heading)]">{test.name}</p>
                                        <p className="text-xs text-[var(--text-secondary)]">{test.subtests.length} sous-test(s)</p>
                                    </div>
                                    {expandedTest === test.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                                {expandedTest === test.id && (
                                    <div className="border-t border-[var(--border-color)] p-3 bg-[var(--hover-bg)]">
                                        <p className="text-xs text-[var(--text-secondary)] mb-3">
                                            {test.subtests.map(s => (s as any).displayName ?? s.name).join(', ')}
                                        </p>
                                        <button
                                            onClick={() => {
                                                onAdd(test.id, test.subtests.map(s => s.id));
                                                onClose();
                                            }}
                                            className="w-full rounded-xl bg-[var(--primary)] py-2 text-xs font-bold uppercase tracking-wider text-white hover:brightness-90"
                                        >
                                            Ajouter ce test
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const ReevStep1Scores: React.FC<Props> = ({
    patient,
    previousAssessment,
    currentTests,
    onUpdateTests,
    onNext,
    onQuit,
}) => {
    const { catalog } = useCatalog();
    const toast = useToast();
    const [showAddModal, setShowAddModal] = useState(false);

    // Build name lookup from catalog
    const { testNameMap, subtestNameMap } = useMemo(() => {
        const testNameMap: Record<string, string> = {};
        const subtestNameMap: Record<string, string> = {};
        catalog.forEach(cat => cat.tests.forEach(t => {
            testNameMap[t.id] = t.name;
            t.subtests.forEach(s => { subtestNameMap[s.id] = (s as any).displayName ?? s.name; });
        }));
        return { testNameMap, subtestNameMap };
    }, [catalog]);

    // Initialise local state from previousAssessment.tests (if available) or currentTests
    const [localGroups, setLocalGroups] = useState<LocalTestGroup[]>(() => {
        const source = previousAssessment?.tests && Object.keys(previousAssessment.tests).length > 0
            ? previousAssessment.tests
            : (Object.keys(currentTests).length > 0 ? currentTests : {});

        return Object.entries(source).map(([testId, subtestMap]) => ({
            testId,
            subtests: Object.entries(subtestMap).map(([subtestId, prevScore]) => ({
                subtestId,
                entryMetric: detectMetric(prevScore as ScoreResult),
                value: '',
                zScore: null,
                standard: '',
                percentile: '',
            })),
        }));
    });

    // Sync from currentTests if resuming a draft
    useEffect(() => {
        if (Object.keys(currentTests).length === 0) return;
        setLocalGroups(prev => prev.map(group => ({
            ...group,
            subtests: group.subtests.map(sub => {
                const ex = currentTests[group.testId]?.[sub.subtestId];
                if (!ex) return sub;
                const em = detectMetric(ex);
                const val = em === 'z'
                    ? (typeof ex.zScore === 'number' ? String(ex.zScore) : '')
                    : em === 'percentile' ? (ex.percentile || '')
                    : (ex.standard || '');
                return { ...sub, entryMetric: em, value: val, standard: ex.standard || '', percentile: ex.percentile || '', zScore: ex.zScore ?? null };
            }),
        })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleScoreChange = useCallback((testId: string, subtestId: string, rawValue: string) => {
        setLocalGroups(prev => prev.map(g =>
            g.testId !== testId ? g : {
                ...g,
                subtests: g.subtests.map(s => {
                    if (s.subtestId !== subtestId) return s;
                    const n = parseFloat(rawValue.replace(',', '.'));
                    if (isNaN(n) || !rawValue.trim()) return { ...s, value: rawValue, zScore: null, standard: '', percentile: '' };

                    // Derive ET and % from the entered value
                    const prevScore = previousAssessment?.tests?.[testId]?.[subtestId] as ScoreResult | undefined;
                    if (s.entryMetric === 'z') {
                        const pct = Math.round(normalCDF(n) * 100);
                        return { ...s, value: rawValue, zScore: n, percentile: String(pct), standard: '' };
                    } else if (s.entryMetric === 'percentile') {
                        return { ...s, value: rawValue, zScore: null, percentile: rawValue, standard: '' };
                    } else {
                        // standard (NS or QI) — infer scale from previous score
                        const scale = inferScale(prevScore?.standard, prevScore?.zScore);
                        const { zScore, percentile } = deriveFromNS(n, scale.mean, scale.sd);
                        return { ...s, value: rawValue, zScore, percentile: String(percentile), standard: rawValue };
                    }
                }),
            }
        ));
    }, [previousAssessment]);

    const handleRemoveTest = useCallback((testId: string) => {
        setLocalGroups(prev => prev.filter(g => g.testId !== testId));
    }, []);

    const handleAddTest = useCallback((testId: string, subtestIds: string[]) => {
        setLocalGroups(prev => {
            if (prev.some(g => g.testId === testId)) return prev;
            return [...prev, {
                testId,
                subtests: subtestIds.map(subtestId => ({
                    subtestId,
                    entryMetric: 'standard' as EntryMetric,
                    value: '',
                    zScore: null,
                    standard: '',
                    percentile: '',
                })),
            }];
        });
    }, []);

    const handleNext = useCallback(() => {
        const hasAtLeastOneScore = localGroups.some(g =>
            g.subtests.some(s => s.value.trim())
        );
        if (!hasAtLeastOneScore) {
            toast.warning('Entrez au moins un score avant de continuer.');
            return;
        }

        // Convert local state to TestData — save in the entered unit
        const newTests: TestData = {};
        localGroups.forEach(group => {
            newTests[group.testId] = {};
            group.subtests.forEach(sub => {
                const filled = sub.value.trim() !== '';
                newTests[group.testId][sub.subtestId] = {
                    entryMetric: sub.entryMetric,
                    standard: sub.entryMetric === 'standard' ? sub.value : sub.standard,
                    zScore: sub.zScore,
                    percentile: sub.percentile,
                    status: filled ? 'draft' : 'empty',
                } as unknown as ScoreResult;
            });
        });

        onUpdateTests(newTests);
        onNext();
    }, [localGroups, onUpdateTests, onNext, toast]);

    const existingTestIds = useMemo(() => new Set(localGroups.map(g => g.testId)), [localGroups]);

    return (
        <div className="animate-in slide-in-from-right duration-500">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <TrendingUp size={28} className="text-[var(--primary)]" />
                    <div>
                        <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">
                            Nouveaux scores — {patient.firstName} {patient.lastName}
                        </h1>
                        <p className="text-sm text-[var(--text-secondary)] mt-1">
                            Les tests du bilan de référence sont pré-chargés.
                            Saisissez les nouveaux scores dans la colonne de droite.
                        </p>
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 mb-6 p-4 rounded-2xl bg-[var(--hover-bg)] border border-[var(--border-color)]">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <div className="w-3 h-3 rounded-full bg-[var(--progress-bg)] border border-[var(--border-color)]" />
                    Score initial (lecture seule)
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <div className="w-3 h-3 rounded-full bg-[var(--primary)]/20 border border-[var(--primary)]/30" />
                    Nouveau score (à saisir)
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] ml-auto">
                    <span>NS · ET · % selon le bilan initial</span>
                </div>
            </div>

            {/* Test groups */}
            {localGroups.length === 0 ? (
                <div className="text-center py-16 rounded-[32px] border-2 border-dashed border-[var(--border-color)]">
                    <TrendingUp size={40} className="mx-auto mb-4 text-[var(--text-disabled)]" />
                    <p className="text-[var(--text-secondary)] font-medium mb-2">Aucun test de référence trouvé.</p>
                    <p className="text-sm text-[var(--text-secondary)]">Ajoutez des tests avec le bouton ci-dessous.</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {localGroups.map(group => {
                        const prevGroup = previousAssessment?.tests?.[group.testId] ?? {};
                        return (
                            <div key={group.testId} className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm overflow-hidden">
                                {/* Test header */}
                                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                                    <h3 className="font-bold text-[var(--text-heading)]">
                                        {testNameMap[group.testId] ?? group.testId}
                                    </h3>
                                    <button
                                        onClick={() => handleRemoveTest(group.testId)}
                                        className="flex items-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-600 transition-colors"
                                    >
                                        <Trash2 size={14} /> Retirer
                                    </button>
                                </div>

                                {/* Subtest table */}
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-[var(--border-color)]">
                                                <th className="text-left px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] w-2/5">Sous-test</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Bilan antérieur</th>
                                                <th className="text-center px-6 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--primary)]">Nouveau score</th>
                                                <th className="text-center px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">ET</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--border-color)]">
                                            {group.subtests.map(sub => {
                                                const prevScore = prevGroup[sub.subtestId];
                                                const unitLabel = METRIC_LABEL[sub.entryMetric];
                                                const hasPrev = !!prevScore;
                                                return (
                                                    <tr key={sub.subtestId} className="hover:bg-[var(--hover-bg)] transition-colors">
                                                        <td className="px-6 py-4">
                                                            <span className="text-sm font-medium text-[var(--text-heading)]">
                                                                {subtestNameMap[sub.subtestId] ?? sub.subtestId}
                                                            </span>
                                                        </td>
                                                        {/* Previous score (read-only) */}
                                                        <td className="px-4 py-4 text-center">
                                                            <span className={`text-sm font-mono font-bold ${hasPrev ? 'text-[var(--text-secondary)]' : 'text-[var(--text-disabled)]'}`}>
                                                                {formatScore(prevScore)}
                                                            </span>
                                                        </td>
                                                        {/* New score — unit label + big input */}
                                                        <td className="px-4 py-3 text-center">
                                                            <div className="flex items-center gap-2 justify-center">
                                                                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)] opacity-70 w-6 text-right shrink-0">{unitLabel}</span>
                                                                <input
                                                                    type="number"
                                                                    value={sub.value}
                                                                    onChange={e => handleScoreChange(group.testId, sub.subtestId, e.target.value)}
                                                                    placeholder="—"
                                                                    className="w-24 text-center rounded-xl border-2 border-[var(--primary)]/30 bg-[var(--primary)]/5 px-3 py-2 text-base font-mono font-bold text-[var(--primary)] outline-none focus:border-[var(--primary)] focus:bg-[var(--primary)]/10 transition-colors"
                                                                />
                                                            </div>
                                                        </td>
                                                        {/* ET (z-score, derived read-only) */}
                                                        <td className="px-4 py-4 text-center">
                                                            <span className={`text-xs font-mono ${zColor(sub.zScore)}`}>
                                                                {sub.zScore !== null ? (sub.zScore > 0 ? '+' : '') + sub.zScore.toFixed(2) : '—'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Add test */}
            <div className="mt-6">
                <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--border-color)] px-6 py-4 text-sm font-bold text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors w-full justify-center"
                >
                    <Plus size={18} /> Ajouter un test
                </button>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-[var(--border-color)]">
                <button
                    onClick={onQuit}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] px-6 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                >
                    <ArrowLeft size={16} /> Quitter
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 rounded-2xl bg-[var(--secondary)] px-8 py-4 text-sm font-bold text-white hover:brightness-90 shadow-lg"
                >
                    Suivant — Commentaire <ArrowRight size={16} />
                </button>
            </div>

            {showAddModal && (
                <AddTestModal
                    existingTestIds={existingTestIds}
                    onAdd={handleAddTest}
                    onClose={() => setShowAddModal(false)}
                />
            )}
        </div>
    );
};
