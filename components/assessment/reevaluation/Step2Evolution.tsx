/**
 * reevaluation/Step2Evolution.tsx
 *
 * Analytics + AI generation step.
 * Shows score evolution charts then lets the practitioner generate the report.
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import {
    TrendingUp, TrendingDown, Minus, ArrowLeft, Sparkles, Loader2,
    ShieldCheck, FileText,
} from 'lucide-react';
import type { Patient, PatientAssessment, TestData, ScoreResult, ReportSection } from '../../../types';
import { useCatalog } from '../../../contexts/CatalogContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { AIService } from '../../../services/ai';
import { anonymizeData } from '../../../utils/anonymizer';
import {
    buildDeltaEntries,
    buildDeltaStats,
    buildScoresSummaryText,
    buildEvolutionSummaryText,
    type DeltaEntry,
} from '../../../utils/reevaluationHelpers';
import { DeltaTable } from '../shared/DeltaTable';

interface Props {
    patient: Patient;
    previousAssessment: PatientAssessment | null;
    newTests: TestData;
    sections: ReportSection[];
    onSetSections: (sections: ReportSection[]) => void;
    onNext: () => void;
    onBack: () => void;
}

// ─── Build initial sections (from Step3Synthesis logic) ──────────────────────

const buildInitialSections = (prev: PatientAssessment | null): ReportSection[] => {
    const prevSections = prev?.report?.sections ?? [];
    const resumeSource = prevSections.find(s => s.id === 'profil' || s.id === 'diagnostic');
    const dateStr = prev?.date ? new Date(prev.date).toLocaleDateString('fr-FR') : '';
    const resumeContent = resumeSource
        ? `<p><strong>Extrait du bilan initial${dateStr ? ` (${dateStr})` : ''}</strong></p>${resumeSource.content}`
        : '<p>Résumé du bilan initial à compléter.</p>';

    return [
        {
            id: 'resume_initial',
            title: 'Résumé du bilan initial',
            content: resumeContent,
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
        {
            id: 'evolution',
            title: 'Évolution des résultats',
            content: '<p>Générez le compte-rendu pour obtenir une analyse automatique.</p>',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
        {
            id: 'conclusion',
            title: 'Conclusion',
            content: '<p>Générez le compte-rendu pour obtenir la conclusion.</p>',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
        {
            id: 'recommandations_reev',
            title: 'Recommandations',
            content: '<p>Générez le compte-rendu pour obtenir des recommandations actualisées.</p>',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
    ];
};

// ─── Stat Card ───────────────────────────────────────────────────────────────

const StatCard: React.FC<{
    count: number;
    label: string;
    icon: React.ReactNode;
    colorClass: string;
    bgClass: string;
}> = ({ count, label, icon, colorClass, bgClass }) => (
    <div className={`rounded-2xl border ${bgClass} p-5 flex flex-col items-center gap-2`}>
        <div className={`${colorClass} flex items-center gap-2 text-2xl font-black`}>
            {icon}
            {count}
        </div>
        <p className={`text-xs font-bold uppercase tracking-wider ${colorClass} opacity-80`}>{label}</p>
    </div>
);

// ─── Comparative Radar Chart ─────────────────────────────────────────────────

const ComparisonRadarChart: React.FC<{
    previousTests: TestData;
    newTests: TestData;
}> = ({ previousTests, newTests }) => {
    const { catalog } = useCatalog();

    const data = useMemo(() => {
        const categoryMap: Record<string, { name: string; prevSum: number; prevCount: number; newSum: number; newCount: number }> = {};

        catalog.forEach(cat => {
            categoryMap[cat.id] = { name: cat.name, prevSum: 0, prevCount: 0, newSum: 0, newCount: 0 };
        });

        const processTests = (tests: TestData, sumKey: 'prevSum' | 'newSum', countKey: 'prevCount' | 'newCount') => {
            Object.entries(tests).forEach(([testId, subtests]) => {
                const cat = catalog.find(c => c.tests.some(t => t.id === testId));
                if (!cat) return;
                if (!categoryMap[cat.id]) return;
                Object.values(subtests).forEach((res: ScoreResult) => {
                    if (typeof res.zScore === 'number' && isFinite(res.zScore)) {
                        categoryMap[cat.id][sumKey] += Math.max(-3, Math.min(3, res.zScore));
                        categoryMap[cat.id][countKey] += 1;
                    }
                });
            });
        };

        processTests(previousTests, 'prevSum', 'prevCount');
        processTests(newTests, 'newSum', 'newCount');

        return Object.values(categoryMap)
            .filter(c => c.prevCount > 0 || c.newCount > 0)
            .map(c => ({
                subject: c.name,
                initial: c.prevCount > 0 ? parseFloat((c.prevSum / c.prevCount).toFixed(2)) : null,
                reev: c.newCount > 0 ? parseFloat((c.newSum / c.newCount).toFixed(2)) : null,
                fullMark: 3,
            }));
    }, [catalog, previousTests, newTests]);

    if (data.length < 3) return null;

    return (
        <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
            <h3 className="font-bold text-sm text-[var(--text-heading)] uppercase tracking-wider mb-4">
                Profil comparatif par domaine
            </h3>
            <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                        <PolarGrid stroke="var(--border-color)" />
                        <PolarAngleAxis
                            dataKey="subject"
                            tick={{ fill: 'var(--text-secondary)', fontSize: 10, fontWeight: 700 }}
                        />
                        <PolarRadiusAxis angle={30} domain={[-3, 3]} tick={false} axisLine={false} />
                        <Radar
                            name="Bilan initial"
                            dataKey="initial"
                            stroke="#94a3b8"
                            strokeWidth={2}
                            fill="#94a3b8"
                            fillOpacity={0.2}
                            connectNulls
                        />
                        <Radar
                            name="Réévaluation"
                            dataKey="reev"
                            stroke="var(--primary)"
                            strokeWidth={2.5}
                            fill="var(--primary)"
                            fillOpacity={0.3}
                            connectNulls
                        />
                        <Legend
                            wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                        />
                        <Tooltip
                            formatter={(value: number | null, name: string) => [
                                value !== null ? `${value > 0 ? '+' : ''}${value} ET` : '—',
                                name,
                            ]}
                            contentStyle={{
                                borderRadius: '12px',
                                border: 'none',
                                boxShadow: '0 10px 15px rgba(0,0,0,0.1)',
                                fontSize: '11px',
                            }}
                        />
                    </RadarChart>
                </ResponsiveContainer>
            </div>
            <p className="text-[9px] text-[var(--text-disabled)] text-center mt-2">
                0 = Moyenne • -2 = Seuil clinique • gris = initial • couleur = réévaluation
            </p>
        </div>
    );
};

// ─── Bar Chart: NS comparison per subtest ────────────────────────────────────

const DeltaBarChart: React.FC<{ deltas: DeltaEntry[] }> = ({ deltas }) => {
    const chartData = useMemo(() =>
        deltas
            .filter(d => d.prevNS !== null || d.newNS !== null)
            .slice(0, 20) // Cap at 20 for readability
            .map(d => ({
                name: d.subtestName.length > 14 ? d.subtestName.slice(0, 12) + '…' : d.subtestName,
                fullName: d.subtestName,
                Avant: d.prevNS,
                Après: d.newNS,
                delta: d.delta,
            })),
    [deltas]);

    if (chartData.length === 0) return null;

    const getBarColor = (delta: number | null) => {
        if (delta === null) return 'var(--primary)';
        if (delta > 0.5) return '#10b981';
        if (delta < -0.5) return '#f43f5e';
        return '#f59e0b';
    };

    return (
        <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
            <h3 className="font-bold text-sm text-[var(--text-heading)] uppercase tracking-wider mb-4">
                Scores par sous-test
            </h3>
            <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
                        <XAxis
                            dataKey="name"
                            tick={{ fill: 'var(--text-secondary)', fontSize: 9 }}
                            angle={-35}
                            textAnchor="end"
                            interval={0}
                        />
                        <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 9 }} />
                        <ReferenceLine y={10} stroke="#94a3b8" strokeDasharray="3 3" strokeWidth={1} />
                        <Tooltip
                            formatter={(value: number | null, name: string) => [value ?? '—', name]}
                            contentStyle={{
                                borderRadius: '12px',
                                border: 'none',
                                boxShadow: '0 10px 15px rgba(0,0,0,0.1)',
                                fontSize: '11px',
                            }}
                        />
                        <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                        <Bar dataKey="Avant" fill="#94a3b8" radius={[4, 4, 0, 0]} maxBarSize={20} />
                        <Bar dataKey="Après" radius={[4, 4, 0, 0]} maxBarSize={20}>
                            {chartData.map((entry, index) => (
                                <Cell key={index} fill={getBarColor(entry.delta)} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            <p className="text-[9px] text-[var(--text-disabled)] text-center">
                Ligne pointillée = NS 10 (moyenne) • couleur de la barre "Après" = tendance
            </p>
        </div>
    );
};

// ─── Domain aggregation table ────────────────────────────────────────────────

const DomainAggTable: React.FC<{ previousTests: TestData; newTests: TestData }> = ({ previousTests, newTests }) => {
    const { catalog } = useCatalog();

    const rows = useMemo(() => {
        const result: { domain: string; prevZ: number | null; newZ: number | null; delta: number | null }[] = [];

        catalog.forEach(cat => {
            const testIds = cat.tests.map(t => t.id);

            const calcAvg = (tests: TestData) => {
                const zs: number[] = [];
                testIds.forEach(tid => {
                    Object.values(tests[tid] ?? {}).forEach((res: ScoreResult) => {
                        if (typeof res.zScore === 'number' && isFinite(res.zScore)) zs.push(res.zScore);
                    });
                });
                return zs.length > 0 ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
            };

            const prevZ = calcAvg(previousTests);
            const newZ = calcAvg(newTests);
            if (prevZ !== null || newZ !== null) {
                result.push({
                    domain: cat.name,
                    prevZ,
                    newZ,
                    delta: prevZ !== null && newZ !== null ? newZ - prevZ : null,
                });
            }
        });

        return result;
    }, [catalog, previousTests, newTests]);

    if (rows.length === 0) return null;

    const zColor = (z: number | null) => {
        if (z === null) return 'text-[var(--text-disabled)]';
        if (z <= -2) return 'text-rose-600 font-bold';
        if (z <= -1) return 'text-amber-500 font-bold';
        return 'text-emerald-600 font-bold';
    };

    return (
        <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                <h3 className="font-bold text-sm text-[var(--text-heading)] uppercase tracking-wider">
                    Évolution par domaine (score z moyen)
                </h3>
            </div>
            <table className="w-full">
                <thead>
                    <tr className="border-b border-[var(--border-color)]">
                        <th className="text-left px-5 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Domaine</th>
                        <th className="text-center px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Initial</th>
                        <th className="text-center px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Rééval.</th>
                        <th className="text-center px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Δ ET</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                    {rows.map(row => (
                        <tr key={row.domain} className="hover:bg-[var(--hover-bg)]">
                            <td className="px-5 py-2.5 text-sm font-semibold text-[var(--text-heading)]">{row.domain}</td>
                            <td className={`px-3 py-2.5 text-center text-xs font-mono ${zColor(row.prevZ)}`}>
                                {row.prevZ !== null ? `${row.prevZ > 0 ? '+' : ''}${row.prevZ.toFixed(2)}` : '—'}
                            </td>
                            <td className={`px-3 py-2.5 text-center text-xs font-mono ${zColor(row.newZ)}`}>
                                {row.newZ !== null ? `${row.newZ > 0 ? '+' : ''}${row.newZ.toFixed(2)}` : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                                {row.delta !== null ? (
                                    <span className={`flex items-center justify-center gap-1 text-xs font-mono font-bold ${row.delta > 0.1 ? 'text-emerald-600' : row.delta < -0.1 ? 'text-rose-600' : 'text-amber-500'}`}>
                                        {row.delta > 0.1 ? <TrendingUp size={12} /> : row.delta < -0.1 ? <TrendingDown size={12} /> : <Minus size={12} />}
                                        {row.delta > 0 ? '+' : ''}{row.delta.toFixed(2)}
                                    </span>
                                ) : <span className="text-[var(--text-disabled)]">—</span>}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const Step2Evolution: React.FC<Props> = ({
    patient,
    previousAssessment,
    newTests,
    sections: propSections,
    onSetSections,
    onNext,
    onBack,
}) => {
    const { catalog } = useCatalog();
    const { userProfile, isDemoMode } = useAuth();
    const toast = useToast();

    const [sessionNotes, setSessionNotes] = useState('');
    const [updatedGoals, setUpdatedGoals] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showCreditConfirm, setShowCreditConfirm] = useState(false);

    const { subtestNameMap, testNameMap } = useMemo(() => {
        const subtestNameMap = new Map<string, string>();
        const testNameMap = new Map<string, string>();
        catalog.forEach(c => c.tests.forEach(t => {
            testNameMap.set(t.id, t.name);
            t.subtests.forEach(s => subtestNameMap.set(s.id, (s as any).displayName ?? s.name));
        }));
        return { subtestNameMap, testNameMap };
    }, [catalog]);

    const previousTests = previousAssessment?.tests ?? {};

    const deltas = useMemo(
        () => buildDeltaEntries(previousTests, newTests, subtestNameMap, testNameMap),
        [previousTests, newTests, subtestNameMap, testNameMap],
    );

    const stats = buildDeltaStats(deltas);

    const deltasByTest = useMemo(() => {
        const grouped: Record<string, DeltaEntry[]> = {};
        deltas.forEach(d => {
            if (!grouped[d.testName]) grouped[d.testName] = [];
            grouped[d.testName].push(d);
        });
        return grouped;
    }, [deltas]);

    // ── AI generation ─────────────────────────────────────────────────────────

    const hasCreds = isDemoMode || userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert';

    const handleGenerateConfirmed = useCallback(async () => {
        setShowCreditConfirm(false);
        setIsGenerating(true);
        try {
            const { text: anonContext } = anonymizeData(
                `Patient: ${patient.firstName} ${patient.lastName}, ${patient.age ?? ''}, ${patient.classLevel ?? 'classe non renseignée'}.${sessionNotes ? ` Observations session: ${sessionNotes}` : ''}`,
                patient,
            );

            const prevSummary = buildScoresSummaryText(previousTests, subtestNameMap);
            const newSummary = buildScoresSummaryText(newTests, subtestNameMap);
            const evoSummary = buildEvolutionSummaryText(deltas);

            const prevSections = previousAssessment?.report?.sections ?? [];
            const previousReportContext = prevSections
                .filter(s => ['profil', 'diagnostic', 'objectifs', 'project', 'recommandations'].includes(s.id) && s.content?.trim())
                .map(s => {
                    const plain = s.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    return `[${s.title}]\n${plain}`;
                })
                .join('\n\n');

            const base = propSections.length > 0 ? propSections : buildInitialSections(previousAssessment);

            const result = await AIService.generateReevaluationComment({
                childContext: anonContext + (updatedGoals ? `\nObjectifs mis à jour: ${updatedGoals}` : ''),
                previousScoresSummary: prevSummary,
                newScoresSummary: newSummary,
                evolutionSummary: evoSummary,
                ...(previousReportContext && { previousReportContext }),
                styleDirectives: userProfile.aiStylePreferences,
            }, patient);

            const updated = base.map(s => {
                if (s.id === 'resume_initial') return { ...s, content: result.resumeInitial, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.resumeInitial };
                if (s.id === 'evolution') return { ...s, content: result.evolution, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.evolution };
                if (s.id === 'conclusion') return { ...s, content: result.conclusion, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.conclusion };
                if (s.id === 'recommandations_reev') return { ...s, content: result.recommandations, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.recommandations };
                return s;
            });

            onSetSections(updated);
            toast.success('Compte-rendu généré — relisez et validez les sections.');
            onNext();
        } catch (err: any) {
            const msg = err?.message ?? String(err);
            if (msg.includes('CREDIT_INSUFFICIENT')) {
                toast.error('Crédits insuffisants.');
            } else {
                toast.error('Erreur lors de la génération IA.');
            }
        } finally {
            setIsGenerating(false);
        }
    }, [patient, previousAssessment, previousTests, newTests, deltas, subtestNameMap, propSections, sessionNotes, updatedGoals, userProfile, isDemoMode, onSetSections, onNext, toast]);

    const handleGenerateClick = useCallback(() => {
        if (!hasCreds) {
            toast.error('Crédits insuffisants. Rechargez votre compte pour utiliser l\'IA.');
            return;
        }
        setShowCreditConfirm(true);
    }, [hasCreds, toast]);

    return (
        <div className="animate-in slide-in-from-right duration-500">
            {/* Credit confirmation popup */}
            {showCreditConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] max-w-md text-center shadow-2xl border border-[var(--border-color)]">
                        <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
                            <FileText size={40} />
                        </div>
                        <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Générer le compte-rendu</h3>
                        <p className="text-[var(--text-secondary)] text-sm mb-4 font-medium leading-relaxed">
                            L'IA va rédiger l'analyse de l'évolution, la conclusion et les recommandations actualisées. Avez-vous bien saisi vos observations ?
                        </p>
                        <div className="bg-[var(--card-bg-raised)] p-3 rounded-xl mb-8 border border-[var(--border-color)] flex gap-2 text-left">
                            <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
                            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                                <strong>Confidentialité :</strong> Les données sont anonymisées automatiquement avant l'envoi à l'IA.
                            </p>
                        </div>
                        <div className="flex gap-4">
                            <button
                                onClick={() => setShowCreditConfirm(false)}
                                className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-xs uppercase tracking-wider"
                            >
                                Retour
                            </button>
                            <button
                                onClick={handleGenerateConfirmed}
                                className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all"
                            >
                                {isDemoMode ? 'Générer' : 'Générer (1 crédit)'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="mb-8">
                <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">
                    Évolution des scores
                </h1>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                    Analyse comparative entre le bilan initial et la réévaluation.
                </p>
            </div>

            {/* Stat cards */}
            {stats.total > 0 && (
                <div className="grid grid-cols-3 gap-4 mb-8">
                    <StatCard
                        count={stats.improved}
                        label="Amélioré"
                        icon={<TrendingUp size={20} />}
                        colorClass="text-emerald-600"
                        bgClass="border-emerald-100 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800/30"
                    />
                    <StatCard
                        count={stats.stable}
                        label="Stable"
                        icon={<Minus size={20} />}
                        colorClass="text-amber-500"
                        bgClass="border-amber-100 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/30"
                    />
                    <StatCard
                        count={stats.declined}
                        label="Dégradé"
                        icon={<TrendingDown size={20} />}
                        colorClass="text-rose-600"
                        bgClass="border-rose-100 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-800/30"
                    />
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
                {/* Radar chart */}
                <ComparisonRadarChart previousTests={previousTests} newTests={newTests} />

                {/* Delta table */}
                <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                        <h3 className="font-bold text-sm text-[var(--text-heading)] uppercase tracking-wider">
                            Tableau comparatif sous-test par sous-test
                        </h3>
                    </div>
                    <div className="max-h-[340px] overflow-y-auto">
                        <DeltaTable deltasByTest={deltasByTest} />
                    </div>
                </div>
            </div>

            {/* Bar chart */}
            <div className="mb-6">
                <DeltaBarChart deltas={deltas} />
            </div>

            {/* Domain aggregation */}
            <div className="mb-8">
                <DomainAggTable previousTests={previousTests} newTests={newTests} />
            </div>

            {/* Session context for AI */}
            <div className="mb-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
                <h2 className="font-serif text-lg font-bold text-[var(--text-heading)] mb-4">Contexte clinique (optionnel)</h2>
                <div className="grid gap-4 md:grid-cols-2">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                            Observations de la session
                        </label>
                        <textarea
                            value={sessionNotes}
                            onChange={e => setSessionNotes(e.target.value)}
                            rows={4}
                            placeholder="Comportement, fatigue, motivation, conditions particulières…"
                            className="w-full resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                            Objectifs mis à jour
                        </label>
                        <textarea
                            value={updatedGoals}
                            onChange={e => setUpdatedGoals(e.target.value)}
                            rows={4}
                            placeholder="Nouveaux objectifs ou ajustements par rapport au bilan initial…"
                            className="w-full resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-6 border-t border-[var(--border-color)]">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] px-6 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                >
                    <ArrowLeft size={16} /> Retour
                </button>
                <button
                    onClick={handleGenerateClick}
                    disabled={isGenerating}
                    className="flex items-center gap-2 rounded-2xl bg-[#E07A5F] px-8 py-4 text-sm font-bold text-white hover:bg-[#d0694e] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-orange-200 transition-all"
                >
                    {isGenerating ? (
                        <><Loader2 size={16} className="animate-spin" /> Génération en cours…</>
                    ) : (
                        <><Sparkles size={16} /> {isDemoMode ? 'Générer le compte-rendu' : 'Générer le compte-rendu (1 crédit)'}</>
                    )}
                </button>
            </div>
        </div>
    );
};
