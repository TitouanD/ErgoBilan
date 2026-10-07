/**
 * useAssessmentFlow — AI generation, finalization and "save & quit" for the
 * assessment in progress (initial, re-evaluation and historical flows): the
 * lifecycle itself is in utils/assessmentInProgress.ts and the AI calls in
 * utils/reportGenerator.ts (payload, anonymization, re-hydration); this hook
 * adds the suspect-word choices, the auth checks, the toasts and the list refresh.
 *
 * In demo mode nothing leaves the browser: the demo generator simulates the answers.
 */

import { useCallback, useRef, useState } from 'react';
import { describeGenerationError, getReportGenerator } from '../services/ai';
import { ensureFreshSession } from '../services/db';
import type { AssessmentContextType } from '../contexts/AssessmentContext';
import type { Patient, PractitionerProfile } from '../types';
import type { CatalogIndex } from '../utils/catalogIndex';
import { findInitialSuspectTerms, findReevaluationSuspectTerms } from '../utils/reportGenerator';
import { type SuspectTermDecisions, applySuspectTermDecisions } from '../utils/suspectTerms';
import { Logger } from '../utils/logger';

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
  /**
   * The catalogue index, loaded if needed. Not the index of the moment: after a
   * draft resumed at the synthesis step, the catalogue may still be loading, and
   * the AI received scores without test names nor z.
   */
  loadCatalog: () => Promise<CatalogIndex>;
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

export const useAssessmentFlow = ({
  assessment,
  sessionKey,
  isDemoMode,
  loadCatalog,
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

  const generator = getReportGenerator(isDemoMode);

  /** The patient with the practitioner's choices on the suspect words, kept on the patient file. */
  const withDecisions = useCallback(
    (decisions?: SuspectTermDecisions): Patient => {
      const { patient } = assessment;
      if (!decisions || (decisions.masked.length === 0 && decisions.allowed.length === 0)) return patient;
      const terms = applySuspectTermDecisions(patient, decisions);
      assessment.updatePatient(terms);
      return { ...patient, ...terms };
    },
    [assessment],
  );

  /** Words of the free text that may still identify someone, to confirm before the generation. */
  const findSuspectTerms = useCallback(async (): Promise<string[]> => {
    const index = await loadCatalog();
    const { patient, observations, tests, synthesis, previousAssessment, reportType } = assessment;
    return reportType === 'reevaluation'
      ? findReevaluationSuspectTerms({ patient, previousAssessment, tests, index })
      : findInitialSuspectTerms({ patient, observations, tests, synthesis, index });
  }, [assessment, loadCatalog]);

  /** Initial report: sections + AI-reformulated subtest observations. Moves to the validation step. */
  const generateInitialReport = useCallback(
    async (decisions?: SuspectTermDecisions) => {
      let applied = false;
      const ok = await runGeneration(async () => {
        const patient = withDecisions(decisions);
        const ticket = assessment.beginGeneration();
        const { observations, tests, synthesis } = assessment;
        const index = await loadCatalog();
        const report = await generator.generateInitial({
          patient,
          observations,
          tests,
          synthesis,
          index,
          stylePreferences: practitioner?.aiStylePreferences,
        });
        applied = assessment.applyGeneratedReport(ticket, report);
        if (!isDemoMode) void refreshProfile();
      });
      if (ok && applied) {
        assessment.setStep(4);
        toast.success(isDemoMode ? 'Rapport généré (simulation)' : 'Rapport généré avec succès');
      }
    },
    [assessment, loadCatalog, generator, isDemoMode, practitioner, refreshProfile, runGeneration, toast, withDecisions],
  );

  /** Re-evaluation: 4 HTML sections (reminder, evolution, conclusion, recommendations). */
  const generateReevaluation = useCallback(
    async (decisions?: SuspectTermDecisions): Promise<boolean> => {
      let applied = false;
      const ok = await runGeneration(async () => {
        const patient = withDecisions(decisions);
        const ticket = assessment.beginGeneration();
        const { previousAssessment, tests } = assessment;
        const index = await loadCatalog();
        const sections = await generator.generateReevaluation({
          patient,
          previousAssessment,
          tests,
          index,
          stylePreferences: practitioner?.aiStylePreferences,
        });
        applied = assessment.applyGeneratedReport(ticket, { sections });
        if (!isDemoMode) void refreshProfile();
      });
      if (ok && applied) toast.success(isDemoMode ? 'Synthèse générée (simulation)' : 'Synthèse générée — relisez et ajustez si besoin.');
      return ok && applied;
    },
    [assessment, loadCatalog, generator, isDemoMode, practitioner, refreshProfile, runGeneration, toast, withDecisions],
  );

  /** Writes need the app unlocked and a fresh Supabase session (demo: nothing is written). */
  const prepareWrite = useCallback(async (): Promise<boolean> => {
    if (isDemoMode) return true;
    if (!sessionKey) {
      toast.error("L'application est verrouillée : déverrouillez-la puis réessayez.");
      return false;
    }
    await ensureFreshSession();
    return true;
  }, [isDemoMode, sessionKey, toast]);

  /**
   * Save the assessment as a formal record, then send the style feedback
   * (edited AI sections) and refresh the lists. Returns true when the caller
   * can go back to the dashboard.
   */
  const finalize = useCallback(async (): Promise<boolean> => {
    try {
      if (!(await prepareWrite())) return false;
      const index = await loadCatalog();
      const result = await assessment.finalize(index);
      if (!result.ok) {
        if (result.reason !== 'busy') toast.error(FINALIZE_ERRORS[result.reason]);
        return false;
      }
      if (result.demo) {
        toast.success('Bilan finalisé (démo, rien n’est enregistré).');
        return true;
      }
      const isHistorical = result.reportType === 'historique';

      // Style feedback loop: learn from the practitioner's corrections (fire-and-forget, no credit).
      if (!isHistorical) {
        generator
          .learnStyle({
            patient: result.patient,
            sections: result.sections,
            index,
            existingPreferences: practitioner?.aiStylePreferences,
          })
          .then((sent) => (sent ? refreshProfile() : undefined))
          .catch((err) => Logger.warn('AI', 'Style feedback extraction failed (non-blocking)', err));
      }

      loadData().catch((e) => Logger.warn('DB', 'List refresh after finalization failed', e));
      toast.success(isHistorical ? 'Bilan de référence enregistré. La réévaluation est maintenant disponible.' : 'Bilan sauvegardé.');
      return true;
    } catch (e) {
      Logger.error('DB', 'Finalization aborted before saving', e);
      toast.error("Erreur lors de l'enregistrement du bilan.");
      return false;
    }
  }, [assessment, loadCatalog, generator, loadData, prepareWrite, practitioner, refreshProfile, toast]);

  /** Save a draft and leave. Returns true when the caller can go back to the dashboard. */
  const saveAndQuit = useCallback(async (): Promise<boolean> => {
    try {
      if (!(await prepareWrite())) return false;
      const result = await assessment.saveAndClose();
      if (!result.ok) {
        toast.error(SAVE_ERRORS[result.reason]);
        return false;
      }
      // The dashboard shows « Reprendre » from the drafts list: read it again.
      loadData().catch((e) => Logger.warn('DB', 'List refresh after saving the draft failed', e));
      if (!isDemoMode) toast.success('Brouillon sauvegardé');
      return true;
    } catch (e) {
      Logger.error('DB', 'Save error', e);
      toast.error('Impossible de sauvegarder le brouillon.');
      return false;
    }
  }, [assessment, isDemoMode, loadData, prepareWrite, toast]);

  return {
    isGenerating,
    generationError,
    clearGenerationError: () => setGenerationError(null),
    findSuspectTerms,
    generateInitialReport,
    generateReevaluation,
    finalize,
    saveAndQuit,
  };
};
