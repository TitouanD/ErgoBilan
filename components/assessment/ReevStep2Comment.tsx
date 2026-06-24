/**
 * ReevStep2Comment — Step 2 of the reevaluation flow.
 *
 * Left panel: Comparison table (previous vs new scores, delta, color coding).
 * Right panel: 4 editable sections:
 *   1. Résumé du bilan initial (auto-filled from previous report)
 *   2. Évolution des résultats (AI generated)
 *   3. Observations cliniques (free text)
 *   4. Recommandations (AI generated)
 *
 * AI button generates sections 2 and 4 via report_reevaluation task.
 */
import React, { useState, useCallback, useMemo, useRef } from 'react';
import type { Patient, TestData, ReportSection, PatientAssessment, ScoreResult } from '../../types';
import {
    ArrowLeft, ArrowRight, Sparkles, AlertTriangle, Loader2,
    TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useCatalog } from '../../contexts/CatalogContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { TipTapEditor } from './TipTapEditor';
import { AIService } from '../../services/ai';
import { anonymizeData } from '../../utils/anonymizer';
import { sanitizeReportText } from '../../utils/textSanitizer';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeltaEntry {
    subtestId: string;
    subtestName: string;
    testName: string;
    prevNS: number | null;
    newNS: number | null;
    delta: number | null;
}

interface Props {
    patient: Patient;
    previousAssessment: PatientAssessment | null;
    newTests: TestData;
    sections: ReportSection[];
    onSetSections: (sections: ReportSection[]) => void;
    onNext: () => void;
    onBack: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseNS = (score?: ScoreResult): number | null => {
    if (!score?.standard) return null;
    const n = parseFloat(String(score.standard).replace(',', '.'));
    return isFinite(n) ? n : null;
};

const deltaIcon = (delta: number | null) => {
    if (delta === null) return <Minus size={14} className="text-[var(--text-disabled)]" />;
    if (delta > 0.5) return <TrendingUp size={14} className="text-emerald-500" />;
    if (delta < -0.5) return <TrendingDown size={14} className="text-rose-500" />;
    return <Minus size={14} className="text-amber-400" />;
};

const deltaClass = (delta: number | null) => {
    if (delta === null) return 'text-[var(--text-disabled)]';
    if (delta > 0.5) return 'text-emerald-600 font-bold';
    if (delta < -0.5) return 'text-rose-600 font-bold';
    return 'text-amber-500';
};

const buildInitialSections = (prev: PatientAssessment | null): ReportSection[] => {
    // Auto-fill "Résumé bilan initial" from previous report's profil or diagnostic section
    const prevSections = prev?.report?.sections ?? [];
    const resumeSource = prevSections.find(s => s.id === 'profil' || s.id === 'diagnostic');
    const resumeContent = resumeSource
        ? `<p><strong>Extrait du bilan initial (${new Date(prev?.date ?? '').toLocaleDateString('fr-FR')})</strong></p>${resumeSource.content}`
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
            content: '<p>Cliquez sur "Générer avec l\'IA" pour obtenir une analyse automatique de l\'évolution.</p>',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
        {
            id: 'observations',
            title: 'Observations cliniques',
            content: '',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
        {
            id: 'recommandations_reev',
            title: 'Recommandations',
            content: '<p>Cliquez sur "Générer avec l\'IA" pour obtenir des recommandations actualisées.</p>',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
    ];
};

const buildScoresSummary = (tests: TestData, subtestNameMap: Map<string, string>): string => {
    const lines: string[] = [];
    Object.entries(tests).forEach(([, subtests]) => {
        Object.entries(subtests).forEach(([subtestId, score]) => {
            const name = subtestNameMap.get(subtestId) ?? subtestId;
            const ns = parseNS(score as ScoreResult);
            if (ns !== null) lines.push(`${name}: NS ${ns}`);
            else if ((score as ScoreResult).raw) lines.push(`${name}: brut ${(score as ScoreResult).raw}`);
        });
    });
    return lines.join('\n') || 'Aucun score enregistré.';
};

const buildEvolutionSummary = (deltas: DeltaEntry[]): string => {
    return deltas
        .filter(d => d.delta !== null)
        .map(d => {
            const sign = (d.delta! > 0 ? '+' : '') + d.delta!.toFixed(1);
            const trend = d.delta! > 0.5 ? 'amélioration' : d.delta! < -0.5 ? 'régression' : 'stable';
            return `${d.subtestName} (${d.testName}): ${sign} NS (${trend})`;
        })
        .join('\n') || 'Pas assez de données pour calculer des deltas.';
};

// ─── Section editor ───────────────────────────────────────────────────────────

const SectionEditor: React.FC<{
    section: ReportSection;
    onChange: (content: string) => void;
    badge?: React.ReactNode;
}> = ({ section, onChange, badge }) => {
    const [expanded, setExpanded] = useState(true);

    return (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
            <button
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--hover-bg)] transition-colors"
            >
                <div className="flex items-center gap-3">
                    <span className="font-bold text-sm text-[var(--text-heading)]">{section.title}</span>
                    {badge}
                </div>
                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {expanded && (
                <div className="px-4 pb-4 border-t border-[var(--border-color)]">
                    <TipTapEditor
                        content={section.content}
                        onChange={onChange}
                        isPerformance
                        inline
                    />
                </div>
            )}
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const ReevStep2Comment: React.FC<Props> = ({
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
    const [isGenerating, setIsGenerating] = useState(false);

    const subtestNameMap = useMemo(() =>
        new Map(catalog.flatMap(c => c.tests.flatMap(t =>
            t.subtests.map(s => [s.id, (s as any).displayName ?? s.name] as [string, string])
        ))),
    [catalog]);

    const testNameMap = useMemo(() => {
        const map = new Map<string, string>();
        catalog.forEach(c => c.tests.forEach(t => map.set(t.id, t.name)));
        return map;
    }, [catalog]);

    // Build delta table from previous and new tests
    const deltas = useMemo((): DeltaEntry[] => {
        const prevTests = previousAssessment?.tests ?? {};
        const result: DeltaEntry[] = [];
        const allTestIds = new Set([...Object.keys(prevTests), ...Object.keys(newTests)]);
        allTestIds.forEach(testId => {
            const prevSubtests = prevTests[testId] ?? {};
            const newSubtests = newTests[testId] ?? {};
            const allSubIds = new Set([...Object.keys(prevSubtests), ...Object.keys(newSubtests)]);
            allSubIds.forEach(subtestId => {
                const prevNS = parseNS(prevSubtests[subtestId] as ScoreResult | undefined);
                const newNS = parseNS(newSubtests[subtestId] as ScoreResult | undefined);
                result.push({
                    subtestId,
                    subtestName: subtestNameMap.get(subtestId) ?? subtestId,
                    testName: testNameMap.get(testId) ?? testId,
                    prevNS,
                    newNS,
                    delta: prevNS !== null && newNS !== null ? newNS - prevNS : null,
                });
            });
        });
        return result;
    }, [previousAssessment, newTests, subtestNameMap, testNameMap]);

    // Local sections state (initialised from prop or fresh)
    const [localSections, setLocalSections] = useState<ReportSection[]>(() =>
        propSections.length > 0 ? propSections : buildInitialSections(previousAssessment)
    );

    const updateSection = useCallback((id: string, content: string) => {
        setLocalSections(prev => prev.map(s => s.id === id ? { ...s, content } : s));
    }, []);

    const handleGenerate = useCallback(async () => {
        if (!isDemoMode && userProfile.credits <= 0 && userProfile.subscriptionPlan !== 'expert') {
            toast.error('Crédits insuffisants. Rechargez votre compte pour utiliser l\'IA.');
            return;
        }

        setIsGenerating(true);
        try {
            const { text: anonContext } = anonymizeData(
                `Patient: ${patient.firstName} ${patient.lastName}, ${patient.age}, ${patient.classLevel || 'classe non renseignée'}.`,
                patient,
            );
            const prevSummary = buildScoresSummary(previousAssessment?.tests ?? {}, subtestNameMap);
            const newSummary = buildScoresSummary(newTests, subtestNameMap);
            const evoSummary = buildEvolutionSummary(deltas);

            const result = await AIService.generateReevaluationComment({
                childContext: anonContext,
                previousScoresSummary: prevSummary,
                newScoresSummary: newSummary,
                evolutionSummary: evoSummary,
                styleDirectives: userProfile.aiStylePreferences,
            }, patient);

            setLocalSections(prev => prev.map(s => {
                if (s.id === 'evolution') return { ...s, content: result.evolution, isAiGenerated: true, originalContent: result.evolution };
                if (s.id === 'recommandations_reev') return { ...s, content: result.recommandations, isAiGenerated: true, originalContent: result.recommandations };
                return s;
            }));
            toast.success('Sections générées avec succès.');
        } catch (err: any) {
            const msg = err?.message || String(err);
            if (msg.includes('CREDIT_INSUFFICIENT')) {
                toast.error('Crédits insuffisants.');
            } else {
                toast.error('Erreur lors de la génération IA.');
            }
        } finally {
            setIsGenerating(false);
        }
    }, [patient, previousAssessment, newTests, deltas, subtestNameMap, userProfile, isDemoMode, toast]);

    const handleNext = useCallback(() => {
        onSetSections(localSections);
        onNext();
    }, [localSections, onSetSections, onNext]);

    // Group deltas by test name
    const deltasByTest = useMemo(() => {
        const grouped: Record<string, DeltaEntry[]> = {};
        deltas.forEach(d => {
            if (!grouped[d.testName]) grouped[d.testName] = [];
            grouped[d.testName].push(d);
        });
        return grouped;
    }, [deltas]);

    const hasCreds = isDemoMode || userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert';

    return (
        <div className="animate-in slide-in-from-right duration-500">
            <div className="mb-8">
                <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">
                    Commentaire de réévaluation
                </h1>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                    Consultez l'évolution des scores et rédigez le commentaire comparatif.
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                {/* Left: Comparison table */}
                <div className="xl:col-span-2">
                    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm sticky top-4">
                        <div className="px-5 py-4 border-b border-[var(--border-color)]">
                            <h2 className="font-bold text-[var(--text-heading)] flex items-center gap-2">
                                <TrendingUp size={18} className="text-[var(--primary)]" />
                                Tableau comparatif
                            </h2>
                        </div>
                        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                            {Object.keys(deltasByTest).length === 0 ? (
                                <p className="p-6 text-center text-sm text-[var(--text-secondary)]">
                                    Aucun score enregistré à l'étape précédente.
                                </p>
                            ) : (
                                Object.entries(deltasByTest).map(([testName, entries]) => (
                                    <div key={testName}>
                                        <div className="px-4 py-2 bg-[var(--card-bg-raised)] border-b border-[var(--border-color)]">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{testName}</p>
                                        </div>
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-[var(--border-color)]">
                                                    <th className="text-left px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Sous-test</th>
                                                    <th className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Avant</th>
                                                    <th className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Après</th>
                                                    <th className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-disabled)]">Δ</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border-color)]">
                                                {entries.map(entry => (
                                                    <tr key={entry.subtestId} className="hover:bg-[var(--hover-bg)]">
                                                        <td className="px-4 py-2 text-xs text-[var(--text-heading)] max-w-[120px] truncate" title={entry.subtestName}>
                                                            {entry.subtestName}
                                                        </td>
                                                        <td className="px-2 py-2 text-center text-xs font-mono text-[var(--text-secondary)]">
                                                            {entry.prevNS ?? '—'}
                                                        </td>
                                                        <td className="px-2 py-2 text-center text-xs font-mono font-bold text-[var(--text-heading)]">
                                                            {entry.newNS ?? '—'}
                                                        </td>
                                                        <td className="px-2 py-2 text-center">
                                                            <span className={`text-xs font-mono flex items-center justify-center gap-1 ${deltaClass(entry.delta)}`}>
                                                                {deltaIcon(entry.delta)}
                                                                {entry.delta !== null
                                                                    ? `${entry.delta > 0 ? '+' : ''}${entry.delta.toFixed(1)}`
                                                                    : '—'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ))
                            )}
                        </div>
                        {/* Legend */}
                        <div className="px-4 py-3 border-t border-[var(--border-color)] grid grid-cols-3 gap-2">
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600"><TrendingUp size={12} /> Amélioration</div>
                            <div className="flex items-center gap-1 text-[10px] text-amber-500"><Minus size={12} /> Stable</div>
                            <div className="flex items-center gap-1 text-[10px] text-rose-500"><TrendingDown size={12} /> Régression</div>
                        </div>
                    </div>
                </div>

                {/* Right: Sections */}
                <div className="xl:col-span-3 space-y-4">
                    {/* AI button */}
                    <div className={`rounded-2xl border p-4 ${hasCreds ? 'border-[var(--secondary)]/30 bg-[var(--secondary)]/5' : 'border-amber-200 bg-amber-50'}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm font-bold text-[var(--text-heading)]">
                                    {hasCreds ? '✨ Générer l\'analyse avec l\'IA' : 'Crédits insuffisants'}
                                </p>
                                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                                    {hasCreds
                                        ? 'L\'IA rédige l\'évolution des résultats et les recommandations actualisées.'
                                        : 'Rechargez des crédits pour utiliser la génération automatique.'}
                                </p>
                            </div>
                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating || !hasCreds}
                                className="flex items-center gap-2 rounded-2xl bg-[var(--secondary)] px-6 py-3 text-sm font-bold text-white hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 shadow-md"
                            >
                                {isGenerating
                                    ? <><Loader2 size={16} className="animate-spin" /> Génération…</>
                                    : <><Sparkles size={16} /> Générer</>}
                            </button>
                        </div>
                        {!hasCreds && (
                            <div className="flex items-center gap-2 mt-3 text-xs text-amber-700">
                                <AlertTriangle size={14} /> Rédigez les sections manuellement ou rechargez des crédits.
                            </div>
                        )}
                    </div>

                    {/* 4 sections */}
                    {localSections.map(section => (
                        <SectionEditor
                            key={section.id}
                            section={section}
                            onChange={content => updateSection(section.id, content)}
                            badge={section.isAiGenerated
                                ? <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--secondary)] bg-[var(--secondary)]/10 px-2 py-0.5 rounded-full">IA</span>
                                : null}
                        />
                    ))}
                </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-[var(--border-color)]">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 rounded-xl border border-[var(--border-color)] px-6 py-3 text-sm font-bold text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]"
                >
                    <ArrowLeft size={16} /> Retour
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 rounded-2xl bg-[var(--secondary)] px-8 py-4 text-sm font-bold text-white hover:brightness-90 shadow-lg"
                >
                    Suivant — Export <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
