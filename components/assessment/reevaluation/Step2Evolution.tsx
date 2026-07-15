/**
 * reevaluation/Step2Evolution.tsx
 *
 * Comparative score table + editable Conclusion & Préconisations sections.
 * AI generation fills both sections inline; user can edit before advancing.
 */

import React, { useMemo, useState, useCallback } from 'react';
import {
    Sparkles, Loader2, ShieldCheck, FileText, ArrowRight,
} from 'lucide-react';
import type { Patient, PatientAssessment, TestData, ReportSection } from '../../../types';
import { useCatalog } from '../../../contexts/CatalogContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useToast } from '../../../contexts/ToastContext';
import { StepNavFooter } from '../shared/StepNavFooter';
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

const stripHtml = (html: string): string =>
    html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const textToHtml = (text: string): string => {
    const paras = text.split('\n').map(p => p.trim()).filter(Boolean);
    return paras.length > 0 ? paras.map(p => `<p>${p}</p>`).join('') : '';
};

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

    const [isGenerating, setIsGenerating] = useState(false);
    const [showCreditConfirm, setShowCreditConfirm] = useState(false);

    const [conclusionHtml, setConclusionHtml] = useState<string>(() => {
        const s = propSections.find(s => s.id === 'conclusion');
        return s?.content ?? '';
    });
    const [precoHtml, setPrecoHtml] = useState<string>(() => {
        const s = propSections.find(s => s.id === 'recommandations_reev');
        return s?.content ?? '';
    });

    const [conclusionText, setConclusionText] = useState(() => stripHtml(conclusionHtml));
    const [precoText, setPrecoText] = useState(() => stripHtml(precoHtml));

    const [aiGenerated, setAiGenerated] = useState(() =>
        propSections.some(s => s.isAiGenerated)
    );

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

    const hasCreds = isDemoMode || userProfile.credits > 0 || userProfile.subscriptionPlan === 'expert';

    const handleGenerateConfirmed = useCallback(async () => {
        setShowCreditConfirm(false);
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
                `Patient: ${patient.firstName} ${patient.lastName}, ${patient.age ?? ''}, ${patient.classLevel ?? 'classe non renseignée'}. ${dateContext}.`,
                patient,
            );

            const prevSummary = buildScoresSummaryText(previousTests, subtestNameMap, prevDateStr ?? undefined);
            const newSummary = buildScoresSummaryText(newTests, subtestNameMap, reevDateStr);
            const evoSummary = buildEvolutionSummaryText(deltas);

            const prevSections = previousAssessment?.report?.sections ?? [];
            const previousReportContext = prevSections
                .filter(s => ['profil', 'diagnostic', 'objectifs', 'project', 'recommandations'].includes(s.id) && s.content?.trim())
                .map(s => `[${s.title}]\n${s.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
                .join('\n\n');

            const result = await AIService.generateReevaluationComment({
                childContext: anonContext,
                previousScoresSummary: prevSummary,
                newScoresSummary: newSummary,
                evolutionSummary: evoSummary,
                ...(previousReportContext && { previousReportContext }),
                styleDirectives: userProfile.aiStylePreferences,
            }, patient);

            setConclusionHtml(result.conclusion);
            setConclusionText(stripHtml(result.conclusion));
            setPrecoHtml(result.recommandations);
            setPrecoText(stripHtml(result.recommandations));
            setAiGenerated(true);

            toast.success('Sections générées — relisez et ajustez si besoin.');

            // Auto-advance to validation
            const mkContent = (html: string) => html || '';
            onSetSections([
                { id: 'conclusion', title: 'Conclusion', content: mkContent(result.conclusion), contentFormat: 'html', status: 'draft', isAiGenerated: true },
                { id: 'recommandations_reev', title: 'Péconisations', content: mkContent(result.recommandations), contentFormat: 'html', status: 'draft', isAiGenerated: true },
            ]);
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
    }, [patient, previousAssessment, previousTests, newTests, deltas, subtestNameMap, userProfile, isDemoMode, toast]);

    const handleGenerateClick = useCallback(() => {
        if (!hasCreds) {
            toast.error('Crédits insuffisants. Rechargez votre compte.');
            return;
        }
        setShowCreditConfirm(true);
    }, [hasCreds, toast]);

    const handleNext = useCallback(() => {
        const mkContent = (text: string, html: string) => {
            const stripped = stripHtml(html);
            return text === stripped && html ? html : textToHtml(text);
        };
        const updatedSections: ReportSection[] = [
            {
                id: 'conclusion',
                title: 'Conclusion',
                content: mkContent(conclusionText, conclusionHtml),
                contentFormat: 'html',
                status: 'draft',
                isAiGenerated: aiGenerated,
            },
            {
                id: 'recommandations_reev',
                title: 'Préconisations',
                content: mkContent(precoText, precoHtml),
                contentFormat: 'html',
                status: 'draft',
                isAiGenerated: aiGenerated,
            },
        ];
        onSetSections(updatedSections);
        onNext();
    }, [conclusionText, conclusionHtml, precoText, precoHtml, aiGenerated, onSetSections, onNext]);

    return (
        <div className="animate-in slide-in-from-right duration-500">
            {showCreditConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-[var(--card-bg)] p-8 rounded-[32px] max-w-md text-center shadow-2xl border border-[var(--border-color)]">
                        <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
                            <FileText size={40} />
                        </div>
                        <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Générer la synthèse</h3>
                        <p className="text-[var(--text-secondary)] text-sm mb-4 font-medium leading-relaxed">
                            L'IA va rédiger la conclusion et les préconisations en fonction de l'évolution des scores.
                        </p>
                        <div className="bg-[var(--card-bg-raised)] p-3 rounded-xl mb-8 border border-[var(--border-color)] flex gap-2 text-left">
                            <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
                            <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                                <strong>Confidentialité :</strong> Les données sont anonymisées automatiquement avant l'envoi à l'IA.
                            </p>
                        </div>
                        <div className="flex gap-4">
                            <button onClick={() => setShowCreditConfirm(false)} className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-xs uppercase tracking-wider">
                                Retour
                            </button>
                            <button onClick={handleGenerateConfirmed} className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all">
                                Confirmer
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="mb-8">
                <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">Évolution des scores</h1>
                <p className="text-sm text-[var(--text-secondary)] mt-1">Tableau comparatif entre le bilan initial et la réévaluation.</p>
            </div>

            <div className="mb-8 rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-sm">
                <DeltaTable entries={deltas} />
            </div>

            <div className="mb-6 rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
                <label className="block text-sm font-bold text-[var(--text-heading)] mb-3 uppercase tracking-wide">
                    Conclusion
                    {aiGenerated && <span className="ml-2 text-[10px] font-normal text-emerald-600 normal-case tracking-normal">✓ Généré par l'IA</span>}
                </label>
                <textarea value={conclusionText} onChange={e => setConclusionText(e.target.value)} rows={7} placeholder="Rédigez votre conclusion ou cliquez sur Générer..." className="w-full resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all" />
            </div>

            <div className="mb-8 rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
                <label className="block text-sm font-bold text-[var(--text-heading)] mb-3 uppercase tracking-wide">
                    Préconisations
                    {aiGenerated && <span className="ml-2 text-[10px] font-normal text-emerald-600 normal-case tracking-normal">✓ Généré par l'IA</span>}
                </label>
                <textarea value={precoText} onChange={e => setPrecoText(e.target.value)} rows={7} placeholder="Rédigez vos préconisations ou cliquez sur Générer..." className="w-full resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all" />
            </div>

            <StepNavFooter onBack={onBack}>
                {aiGenerated ? (
                    <button
                        onClick={handleNext}
                        className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all bg-[var(--secondary)] hover:bg-[var(--primary)]"
                    >
                        Continuer <ArrowRight size={20} />
                    </button>
                ) : (
                    <button
                        onClick={handleGenerateClick}
                        disabled={isGenerating}
                        className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all duration-300 disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed bg-gradient-to-r from-[#E07A5F] to-[#d97706] hover:shadow-orange-200 hover:scale-[1.02]"
                    >
                        {isGenerating
                            ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Génération…</>
                            : <><Sparkles size={20} /> Générer</>}
                    </button>
                )}
            </StepNavFooter>
        </div>
    );
};
