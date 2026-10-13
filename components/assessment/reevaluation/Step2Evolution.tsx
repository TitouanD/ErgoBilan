/**
 * reevaluation/Step2Evolution.tsx — score evolution + conclusion / recommendations.
 *
 * The practitioner can either generate the four re-evaluation sections with
 * the AI (1 credit) or write the conclusion and recommendations by hand and
 * continue without AI.
 */

import React, { useMemo, useState } from 'react';
import { ArrowRight, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import type { PatientAssessment, ReportSection, TestData } from '../../../types';
import { useCatalog } from '../../../contexts/CatalogContext';
import { buildDeltaEntries } from '../../../utils/reevaluationHelpers';
import { htmlToPlainText, plainTextToHtml, sectionToHtml } from '../../../utils/reportContent';
import { DeltaTable } from '../shared/DeltaTable';
import { StepNavFooter } from '../shared/StepNavFooter';
import { SuspectTermsReview, useSuspectTermChoices } from '../../shared/SuspectTermsReview';
import type { SuspectTermDecisions } from '../../../utils/suspectTerms';

interface Props {
  previousAssessment: PatientAssessment | null;
  newTests: TestData;
  sections: ReportSection[];
  onSetSections: (sections: ReportSection[]) => void;
  /** Runs the AI generation; resolves true on success (sections are then in the context). */
  onGenerate: (decisions: SuspectTermDecisions) => Promise<boolean>;
  /** Words of the free text that may still identify someone (asked before the generation). */
  findSuspectTerms: () => Promise<string[]>;
  isGenerating: boolean;
  /** Resolves true when a generation may start; otherwise the credit wall is already shown. */
  ensureCredits: () => Promise<boolean>;
  /** Demo: the generation is simulated and costs nothing. */
  isDemoMode: boolean;
  onNext: () => void;
  onBack: () => void;
}

const MANUAL_SECTIONS = [
  { id: 'conclusion', title: 'Conclusion', placeholder: 'Rédigez votre conclusion ou générez-la avec l’IA...' },
  { id: 'recommandations_reev', title: 'Préconisations', placeholder: 'Rédigez vos préconisations ou générez-les avec l’IA...' },
] as const;

const sectionText = (sections: ReportSection[], id: string): string => {
  const section = sections.find((s) => s.id === id);
  return section ? htmlToPlainText(sectionToHtml(section)) : '';
};

export const Step2Evolution: React.FC<Props> = ({
  previousAssessment,
  newTests,
  sections,
  onSetSections,
  onGenerate,
  findSuspectTerms,
  isGenerating,
  ensureCredits,
  isDemoMode,
  onNext,
  onBack,
}) => {
  const { index } = useCatalog();
  /** Suspect words of the confirmation; null while it is closed. */
  const [confirmTerms, setConfirmTerms] = useState<string[] | null>(null);
  const termChoices = useSuspectTermChoices(confirmTerms ?? []);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(MANUAL_SECTIONS.map((s) => [s.id, sectionText(sections, s.id)])),
  );
  const hasAiSections = sections.some((s) => s.isAiGenerated);

  const deltas = useMemo(() => buildDeltaEntries(previousAssessment?.tests ?? {}, newTests, index), [previousAssessment, newTests, index]);

  const handleGenerate = async () => {
    setConfirmTerms(null);
    if (await onGenerate(termChoices.decisions)) onNext();
  };

  /** Keep the other sections; replace a manual section only when its text changed. */
  const handleContinue = () => {
    let next = [...sections];
    for (const { id, title } of MANUAL_SECTIONS) {
      const text = texts[id]?.trim() ?? '';
      const existing = next.find((s) => s.id === id);
      if (existing && sectionText([existing], id) === text) continue;
      next = next.filter((s) => s.id !== id);
      if (text) next.push({ id, title, content: plainTextToHtml(text), contentFormat: 'html', status: 'draft', isAiGenerated: false });
    }
    onSetSections(next);
    onNext();
  };

  return (
    <div className="animate-in slide-in-from-right duration-500">
      {confirmTerms && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#3D405B]/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--card-bg)] p-8 rounded-[32px] max-w-md text-center shadow-2xl border border-[var(--border-color)]">
            <div className="w-20 h-20 bg-[#E07A5F]/10 rounded-full flex items-center justify-center mx-auto mb-6 text-[#E07A5F]">
              <FileText size={40} />
            </div>
            <h3 className="font-serif font-bold text-2xl text-[var(--text-heading)] mb-2">Générer la synthèse</h3>
            <p className="text-[var(--text-secondary)] text-sm mb-4 font-medium leading-relaxed">
              L'IA rédige le rappel du bilan initial, l'évolution commentée, la conclusion et les préconisations à partir de l'évolution des
              scores.
              {hasAiSections && ' Les sections déjà générées seront remplacées.'}
            </p>
            <SuspectTermsReview terms={confirmTerms} isMasked={termChoices.isMasked} onToggle={termChoices.toggle} />
            <div className="bg-[var(--card-bg-raised)] p-3 rounded-xl mb-8 border border-[var(--border-color)] flex gap-2 text-left">
              <ShieldCheck size={20} className="text-[#81B29A] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">
                <strong>Confidentialité :</strong> les noms et coordonnées sont remplacés par des pseudonymes avant l'envoi à l'IA.
              </p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmTerms(null)}
                className="flex-1 py-3 text-[var(--text-secondary)] font-bold hover:bg-[var(--hover-bg)] rounded-xl transition-colors text-xs uppercase tracking-wider"
              >
                Retour
              </button>
              <button
                onClick={handleGenerate}
                className="flex-1 py-3 bg-[#E07A5F] text-white rounded-xl font-bold shadow-lg shadow-orange-200 hover:bg-[#d0694e] hover:-translate-y-1 transition-all"
              >
                {isDemoMode ? 'Générer (simulation)' : 'Générer (1 crédit)'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-[var(--text-heading)]">Évolution des scores</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">Tableau comparatif entre le bilan de référence et la réévaluation.</p>
      </div>

      <div className="mb-8 rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden shadow-sm">
        <DeltaTable entries={deltas} />
      </div>

      {MANUAL_SECTIONS.map(({ id, title, placeholder }) => (
        <div key={id} className="mb-6 rounded-[24px] border border-[var(--border-color)] bg-[var(--card-bg)] p-6">
          <label className="block text-sm font-bold text-[var(--text-heading)] mb-3 uppercase tracking-wide">
            {title}
            {sections.find((s) => s.id === id)?.isAiGenerated && (
              <span className="ml-2 text-[10px] font-normal text-emerald-600 normal-case tracking-normal">✓ Généré par l'IA</span>
            )}
          </label>
          <textarea
            value={texts[id] ?? ''}
            onChange={(e) => setTexts((prev) => ({ ...prev, [id]: e.target.value }))}
            rows={7}
            placeholder={placeholder}
            className="w-full resize-none rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3 text-sm text-[var(--text-main)] placeholder:text-[var(--text-disabled)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 transition-all"
          />
        </div>
      ))}

      <StepNavFooter onBack={onBack}>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              if (await ensureCredits()) setConfirmTerms(await findSuspectTerms());
            }}
            disabled={isGenerating}
            className="flex items-center gap-3 px-6 py-4 rounded-2xl font-bold text-white shadow-xl transition-all duration-300 disabled:opacity-40 disabled:grayscale disabled:cursor-not-allowed bg-gradient-to-r from-[#E07A5F] to-[#d97706] hover:shadow-orange-200 hover:scale-[1.02]"
          >
            {isGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Génération…
              </>
            ) : (
              <>
                <Sparkles size={20} /> {hasAiSections ? 'Régénérer' : 'Générer avec l’IA'}
              </>
            )}
          </button>
          <button
            onClick={handleContinue}
            disabled={isGenerating}
            className="flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white shadow-xl transition-all bg-[var(--secondary)] hover:bg-[var(--primary)] disabled:opacity-40"
          >
            Continuer <ArrowRight size={20} />
          </button>
        </div>
      </StepNavFooter>
    </div>
  );
};
