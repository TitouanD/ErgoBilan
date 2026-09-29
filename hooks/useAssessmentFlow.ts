/**
 * useAssessmentFlow — AI generation, finalization and "save & quit" for the
 * assessment in progress (initial, re-evaluation and historical flows): the
 * lifecycle itself is in the session (utils/assessmentSession.ts); this hook
 * adds the AI calls, the auth checks, the toasts and the list refresh.
 *
 * Everything sent to the AI goes through `anonymizeDeep` as a whole payload.
 * In demo mode nothing leaves the browser: generations are simulated.
 */

import { useCallback, useRef, useState } from 'react';
import { AIService, describeGenerationError } from '../services/ai';
import { callAIProxyTask } from '../services/aiProxy';
import { ensureFreshSession } from '../services/db';
import type { AssessmentContextType } from '../contexts/AssessmentContext';
import type { Patient, PractitionerProfile, ReportSection } from '../types';
import { anonymizeDeep } from '../utils/anonymizer';
import { buildInitialReportPayload, buildReevaluationPayload } from '../utils/aiPayload';
import type { CatalogIndex } from '../utils/catalogIndex';
import { buildDeltaEntries } from '../utils/reevaluationHelpers';
import { htmlToPlainText, sectionToPlainText } from '../utils/reportContent';
import { DEMO_REEVALUATION_SECTIONS, DEMO_SECTIONS } from '../data/demoReport';
import { Logger } from '../utils/logger';

const DEMO_GENERATION_DELAY_MS = 2_500;
const EXPECTED_GENERATION_ERRORS = new Set(['CREDIT_INSUFFICIENT', 'RATE_LIMITED', 'SESSION_EXPIRED']);

interface Toast {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

interface Params {
  assessment: AssessmentContextType;
  sessionKey: CryptoKey | null;
  isDemoMode: boolean;
  catalogIndex: CatalogIndex;
  practitioner: PractitionerProfile | null;
  refreshProfile: () => Promise<void>;
  loadData: () => Promise<void>;
  toast: Toast;
}

const IDENTITY_ERRORS = {
  'identity-incomplete': 'Nom, prénom et date de naissance requis.',
  'creation-failed': 'Impossible de créer le dossier patient.',
} as const;
const FINALIZE_ERRORS = { ...IDENTITY_ERRORS, 'save-failed': "Erreur lors de l'enregistrement du bilan." } as const;
const SAVE_ERRORS = { ...IDENTITY_ERRORS, error: 'Impossible de sauvegarder le brouillon.' } as const;

/**
 * Section ids known by the style-feedback schema (edge `extract_style_feedback`).
 * Re-evaluation recommendations share the rules of the initial ones; the other
 * re-evaluation sections have no dedicated slot and only feed the global rules.
 */
const STYLE_SECTION_ALIASES: Record<string, string> = { recommandations_reev: 'recommandations' };

const buildStyleDiffs = (sections: ReportSection[], patient: Patient) =>
  sections
    .filter((s) => s.isAiGenerated && s.originalContent)
    .map((s) => ({ s, original: htmlToPlainText(s.originalContent!), corrected: sectionToPlainText(s) }))
    .filter(({ original, corrected }) => original !== corrected)
    .map(({ s, original, corrected }) => anonymizeDeep({ sectionId: STYLE_SECTION_ALIASES[s.id] ?? s.id, original, corrected }, patient));

export const useAssessmentFlow = ({
  assessment,
  sessionKey,
  isDemoMode,
  catalogIndex,
  practitioner,
  refreshProfile,
  loadData,
  toast,
}: Params) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const busyRef = useRef(false);

  /** Run a generation with shared guards (no double click), loader and error mapping. */
  const runGeneration = useCallback(async (generate: () => Promise<void>): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setGenerationError(null);
    setIsGenerating(true);
    try {
      await generate();
      return true;
    } catch (e) {
      // Expected business outcomes are reported as warnings, everything else as errors.
      const code = e instanceof Error ? e.message : '';
      if (EXPECTED_GENERATION_ERRORS.has(code)) Logger.capture('AI', `Generation refused: ${code}`, e);
      else Logger.error('AI', 'Generation error', e);
      setGenerationError(describeGenerationError(e));
      return false;
    } finally {
      busyRef.current = false;
      setIsGenerating(false);
    }
  }, []);

  const simulate = () => new Promise((resolve) => setTimeout(resolve, DEMO_GENERATION_DELAY_MS));

  /** Initial report: sections + AI-reformulated subtest observations. Moves to the validation step. */
  const generateInitialReport = useCallback(async () => {
    let applied = false;
    const ok = await runGeneration(async () => {
      const ticket = assessment.beginGeneration();
      if (isDemoMode) {
        await simulate();
        applied = assessment.applyGeneratedReport(ticket, { sections: DEMO_SECTIONS });
        return;
      }
      const { patient, observations, tests, synthesis } = assessment;
      const payload = anonymizeDeep(buildInitialReportPayload({ patient, observations, tests, synthesis, index: catalogIndex }), patient);
      const report = await AIService.generateInitialReport(payload, patient, practitioner?.aiStylePreferences);
      applied = assessment.applyGeneratedReport(ticket, report);
      void refreshProfile();
    });
    if (ok && applied) {
      assessment.setStep(4);
      toast.success(isDemoMode ? 'Rapport généré (simulation)' : 'Rapport généré avec succès');
    }
  }, [assessment, catalogIndex, isDemoMode, practitioner, refreshProfile, runGeneration, toast]);

  /** Re-evaluation: 4 HTML sections (reminder, evolution, conclusion, recommendations). */
  const generateReevaluation = useCallback(async (): Promise<boolean> => {
    let applied = false;
    const ok = await runGeneration(async () => {
      const ticket = assessment.beginGeneration();
      if (isDemoMode) {
        await simulate();
        applied = assessment.applyGeneratedReport(ticket, { sections: DEMO_REEVALUATION_SECTIONS });
        return;
      }
      const { patient, previousAssessment, tests } = assessment;
      const previousTests = previousAssessment?.tests ?? {};
      const deltas = buildDeltaEntries(previousTests, tests, catalogIndex);
      const payload = anonymizeDeep(
        buildReevaluationPayload({ patient, previousAssessment, previousTests, newTests: tests, deltas, index: catalogIndex }),
        patient,
      );
      const sections = await AIService.generateReevaluation(payload, patient, practitioner?.aiStylePreferences);
      applied = assessment.applyGeneratedReport(ticket, { sections });
      void refreshProfile();
    });
    if (ok && applied) toast.success(isDemoMode ? 'Synthèse générée (simulation)' : 'Synthèse générée — relisez et ajustez si besoin.');
    return ok && applied;
  }, [assessment, catalogIndex, isDemoMode, practitioner, refreshProfile, runGeneration, toast]);

  /**
   * Save the assessment as a formal record, then send the style feedback
   * (edited AI sections) and refresh the lists. Returns true when the caller
   * can go back to the dashboard.
   */
  const finalize = useCallback(async (): Promise<boolean> => {
    if (!isDemoMode && !sessionKey) {
      toast.error("L'application est verrouillée : déverrouillez-la puis réessayez.");
      return false;
    }
    try {
      if (!isDemoMode) await ensureFreshSession();
      const result = await assessment.finalize(catalogIndex);
      if (!result.ok) {
        if (result.reason !== 'busy') toast.error(FINALIZE_ERRORS[result.reason]);
        return false;
      }
      if (result.demo) {
        toast.success('Bilan validé (démo, rien n’est enregistré).');
        return true;
      }
      const isHistorical = result.reportType === 'historique';

      // Style feedback loop: learn from the practitioner's corrections (fire-and-forget, no credit).
      const diffs = isHistorical ? [] : buildStyleDiffs(result.sections, result.patient);
      if (diffs.length > 0) {
        callAIProxyTask({ task: 'extract_style_feedback', payload: { diffs, existingPreferences: practitioner?.aiStylePreferences || '' } })
          .then(() => refreshProfile())
          .catch((err) => Logger.warn('AI', 'Style feedback extraction failed (non-blocking)', err));
      }

      await loadData().catch((e) => Logger.warn('DB', 'List refresh after finalization failed', e));
      toast.success(isHistorical ? 'Bilan de référence enregistré. La réévaluation est maintenant disponible.' : 'Bilan sauvegardé.');
      return true;
    } catch (e) {
      Logger.error('DB', 'Finalization failed', e);
      toast.error("Erreur lors de l'enregistrement du bilan.");
      return false;
    }
  }, [assessment, catalogIndex, isDemoMode, loadData, practitioner, refreshProfile, sessionKey, toast]);

  /** Save a draft and leave. Returns true when the caller can go back to the dashboard. */
  const saveAndQuit = useCallback(async (): Promise<boolean> => {
    if (!isDemoMode && !sessionKey) {
      toast.error("L'application est verrouillée : déverrouillez-la puis réessayez.");
      return false;
    }
    try {
      if (!isDemoMode) await ensureFreshSession();
      const result = await assessment.saveAndClose();
      if (!result.ok) {
        toast.error(SAVE_ERRORS[result.reason]);
        return false;
      }
      if (!isDemoMode) toast.success('Brouillon sauvegardé');
      return true;
    } catch (e) {
      Logger.error('DB', 'Save error', e);
      toast.error('Impossible de sauvegarder le brouillon.');
      return false;
    }
  }, [assessment, isDemoMode, sessionKey, toast]);

  return {
    isGenerating,
    generationError,
    clearGenerationError: () => setGenerationError(null),
    generateInitialReport,
    generateReevaluation,
    finalize,
    saveAndQuit,
  };
};
