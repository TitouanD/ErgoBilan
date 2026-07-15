/**
 * reevaluation/Step3Synthesis.tsx
 *
 * AI generation step for the reevaluation flow.
 * Mirrors the layout and UX of initial/Step3Diagnostic:
 *   - Left sticky column: context (compact delta table + previous report excerpt)
 *   - Right column: free-text clinical input + "Générer avec l'IA" button
 *
 * Produces 4 ReportSection[] that feed into ValidationPage (step 4).
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
    Sparkles, ArrowLeft, ArrowRight, AlertTriangle, Loader2,
    ChevronDown, ChevronUp, FileText,
} from 'lucide-react';
import type { Patient, PatientAssessment, TestData, ReportSection } from '../../../types';
import { useCatalog } from '../../../contexts/CatalogContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { AIService } from '../../../services/ai';
import { anonymizeData } from '../../../utils/anonymizer';
import {
    buildDeltaEntries,
    buildScoresSummaryText,
    buildEvolutionSummaryText,
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

// ─── Section builders ─────────────────────────────────────────────────────────

const buildInitialSections = (prev: PatientAssessment | null): ReportSection[] => {
    const prevSections = prev?.report?.sections ?? [];
    const diagSource = prevSections.find(s => s.id === 'diagnostic');
    const objectifsSource = prevSections.find(s => s.id === 'objectifs' || s.id === 'project');
    const dateStr = prev?.date ? new Date(prev.date).toLocaleDateString('fr-FR') : '';

    const resumeParts: string[] = [];
    if (dateStr) resumeParts.push(`<p><strong>Bilan initial r\u00e9alis\u00e9 le ${dateStr}</strong></p>`);
    if (diagSource?.content?.trim()) resumeParts.push(diagSource.content);
    if (objectifsSource?.content?.trim()) {
        resumeParts.push(`<p><strong>Objectifs de prise en charge :</strong></p>${objectifsSource.content}`);
    }
    const resumeContent = resumeParts.length > 0
        ? resumeParts.join('\n')
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
            content: '<p>Cliquez sur "Générer avec l\'IA" pour obtenir une analyse automatique.</p>',
            contentFormat: 'html',
            status: 'draft',
            isAiGenerated: false,
        },
        {
            id: 'conclusion',
            title: 'Conclusion',
            content: '<p>Cliquez sur “Générer avec l\'IA” pour obtenir la conclusion du compte-rendu.</p>',
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

// ─── Previous report excerpt ──────────────────────────────────────────────────

const PreviousReportExcerpt: React.FC<{ previousAssessment: PatientAssessment | null }> = ({ previousAssessment }) => {
    const [expanded, setExpanded] = useState(false);
    const prevSections = previousAssessment?.report?.sections ?? [];
    const shown = prevSections.filter(s =>
        ['profil', 'diagnostic', 'objectifs', 'project', 'recommandations'].includes(s.id) && s.content?.trim()
    );

    if (shown.length === 0) return null;

    const dateStr = previousAssessment?.date
        ? new Date(previousAssessment.date).toLocaleDateString('fr-FR')
        : '';

    return (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
            <button
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--hover-bg)] transition-colors"
            >
                <div className="flex items-center gap-2">
                    <FileText size={14} className="text-[var(--primary)]" />
                    <span className="text-xs font-bold text-[var(--text-heading)]">
                        Bilan initial{dateStr ? ` — ${dateStr}` : ''}
                    </span>
                </div>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {expanded && (
                <div className="border-t border-[var(--border-color)] divide-y divide-[var(--border-color)] max-h-[300px] overflow-y-auto">
                    {shown.map(s => (
                        <div key={s.id} className="px-4 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                                {s.title}
                            </p>
                            <div
                                className="text-xs text-[var(--text-main)] line-clamp-4"
                                dangerouslySetInnerHTML={{
                                    __html: s.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
                                }}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const Step3Synthesis: React.FC<Props> = ({
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
    const [sessionNotes, setSessionNotes] = useState('');
    const [updatedGoals, setUpdatedGoals] = useState('');

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

    // Initialise sections from prop or build fresh defaults
    const [localSections, setLocalSections] = useState<ReportSection[]>(() =>
        propSections.length > 0 ? propSections : buildInitialSections(previousAssessment)
    );

    const hasCreds = isDemoMode || userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert';

    const handleGenerate = useCallback(async () => {
        if (!isDemoMode && userProfile.credits <= 0 && userProfile.subscriptionPlan !== 'expert') {
            toast.error('Crédits insuffisants. Rechargez votre compte pour utiliser l\'IA.');
            return;
        }

        setIsGenerating(true);
        try {
            const prevDateStr = previousAssessment?.date
                ? new Date(previousAssessment.date).toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' })
                : null;
            const reevDateStr = new Date().toLocaleDateString('fr-FR', { month: '2-digit', year: 'numeric' });

            const dateContext = [
                prevDateStr ? `Bilan initial réalisé : ${prevDateStr}` : '',
                `Réévaluation réalisée : ${reevDateStr}`,
            ].filter(Boolean).join(' | ');

            const { text: anonContext } = anonymizeData(
                `Patient: ${patient.firstName} ${patient.lastName}, ${patient.age ?? ''}, ${patient.classLevel ?? 'classe non renseignée'}. ${dateContext}.${sessionNotes ? ` Observations session de réévaluation: ${sessionNotes}` : ''}`,
                patient,
            );

            const prevSummary = buildScoresSummaryText(previousTests, subtestNameMap, prevDateStr ?? undefined);
            const newSummary = buildScoresSummaryText(newTests, subtestNameMap, reevDateStr);
            const evoSummary = buildEvolutionSummaryText(deltas);

            const prevSections = previousAssessment?.report?.sections ?? [];
            const contextSectionIds = ['profil', 'diagnostic', 'objectifs', 'project', 'recommandations'];
            const previousReportContext = prevSections
                .filter(s => contextSectionIds.includes(s.id) && s.content?.trim())
                .map(s => {
                    const plain = s.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    return `[${s.title}]\n${plain}`;
                })
                .join('\n\n');

            const result = await AIService.generateReevaluationComment({
                childContext: anonContext + (updatedGoals ? `\nObjectifs mis à jour: ${updatedGoals}` : ''),
                previousScoresSummary: prevSummary,
                newScoresSummary: newSummary,
                evolutionSummary: evoSummary,
                ...(previousReportContext && { previousReportContext }),
                styleDirectives: userProfile.aiStylePreferences,
            }, patient);

            setLocalSections(prev => prev.map(s => {
                if (s.id === 'resume_initial') return { ...s, content: result.resumeInitial, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.resumeInitial };
                if (s.id === 'evolution') return { ...s, content: result.evolution, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.evolution };
                if (s.id === 'conclusion') return { ...s, content: result.conclusion, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.conclusion };
                if (s.id === 'recommandations_reev') return { ...s, content: result.recommandations, contentFormat: 'html' as const, isAiGenerated: true, originalContent: result.recommandations };
                return s;
            }));

            toast.success('Sections générées avec succès.');
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
    }, [patient, previousAssessment, previousTests, newTests, deltas, subtestNameMap, sessionNotes, updatedGoals, userProfile, isDemoMode, toast]);

    const handleNext = useCallback(() => {
        onSetSections(localSections);
        onNext();
    }, [localSections, onSetSections, onNext]);

    const aiGenerated = localSections.some(s => s.isAiGenerated);

    return (
        <div className="animate-in slide-in-from-right duration-500">
            {/* Header */}
            <div className="mb-8">
                <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">
                    Synthèse & Génération
                </h1>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                    Complétez le contexte clinique puis générez les sections du compte-rendu.
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
                {/* Left: context sidebar */}
                <div className="xl:col-span-2 space-y-4">
                    <div className="sticky top-4 space-y-4">
                        {/* Compact delta table */}
                        <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] shadow-sm overflow-hidden">
                            <div className="px-4 py-3 border-b border-[var(--border-color)] bg-[var(--card-bg-raised)]">
                                <p className="text-xs font-bold text-[var(--text-heading)] uppercase tracking-wider">
                                    Évolution des scores
                                </p>
                            </div>
                            <div className="max-h-[280px] overflow-y-auto">
                                <DeltaTable entries={deltas} compact />
                            </div>
                        </div>

                        {/* Previous report sections (collapsed by default) */}
                        <PreviousReportExcerpt previousAssessment={previousAssessment} />
                    </div>
                </div>

                {/* Right: input + AI generate */}
                <div className="xl:col-span-3 space-y-6">
                    {/* Session notes */}
                    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
                        <label className="block text-sm font-bold text-[var(--text-heading)] mb-3">
                            Observations de la session de réévaluation
                        </label>
                        <textarea
                            value={sessionNotes}
                            onChange={e => setSessionNotes(e.target.value)}
                            placeholder="Comportement, concentration, douleurs (ex : douleur 4/10 aux doigts en copie), stratégies spontanées, remarques particulières…"
                            rows={4}
                            className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] resize-none"
                        />
                    </div>

                    {/* Updated goals */}
                    <div className="rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
                        <label className="block text-sm font-bold text-[var(--text-heading)] mb-3">
                            Objectifs mis à jour / orientations thérapeutiques
                        </label>
                        <textarea
                            value={updatedGoals}
                            onChange={e => setUpdatedGoals(e.target.value)}
                            placeholder="Objectifs de rééducation actualisés, ajustements du projet thérapeutique…"
                            rows={4}
                            className="w-full rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-4 py-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] resize-none"
                        />
                    </div>

                    {/* AI generation card */}
                    <div className={`rounded-[24px] border p-6 ${hasCreds ? 'border-[var(--secondary)]/30 bg-[var(--secondary)]/5' : 'border-amber-200 bg-amber-50 dark:bg-amber-900/10'}`}>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                                <p className="text-sm font-bold text-[var(--text-heading)]">
                                    {hasCreds ? '✨ Générer le compte-rendu avec l\'IA' : 'Crédits insuffisants'}
                                </p>
                                <p className="text-xs text-[var(--text-secondary)] mt-1">
                                    {hasCreds
                                        ? 'L\'IA rédige l\'analyse de l\'évolution et les recommandations actualisées en tenant compte du contexte clinique renseigné ci-dessus.'
                                        : 'Rechargez des crédits pour utiliser la génération automatique.'}
                                </p>
                                {aiGenerated && (
                                    <p className="text-xs text-emerald-600 font-semibold mt-2">
                                        ✓ Sections générées — vous pourrez les relire à l'étape suivante.
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating || !hasCreds}
                                className="flex-shrink-0 flex items-center gap-2 rounded-2xl bg-[var(--secondary)] px-6 py-3 text-sm font-bold text-white hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                            >
                                {isGenerating
                                    ? <><Loader2 size={16} className="animate-spin" /> Génération…</>
                                    : <><Sparkles size={16} /> Générer</>}
                            </button>
                        </div>
                        {!hasCreds && (
                            <div className="flex items-center gap-2 mt-3 text-xs text-amber-700">
                                <AlertTriangle size={14} />
                                Rédigez les sections manuellement à l'étape suivante ou rechargez des crédits.
                            </div>
                        )}
                    </div>
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
                    className="flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-8 py-4 text-sm font-bold text-white hover:brightness-90 shadow-lg"
                >
                    {aiGenerated ? 'Relire les sections' : 'Continuer sans générer'}
                    <ArrowRight size={16} />
                </button>
            </div>
        </div>
    );
};
