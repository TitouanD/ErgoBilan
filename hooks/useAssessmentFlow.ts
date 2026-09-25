/**
 * useAssessmentFlow — AI generation, finalization and "save & quit" for the
 * assessment in progress (initial, re-evaluation and historical flows).
 *
 * Everything sent to the AI goes through `anonymizeDeep` as a whole payload.
 * In demo mode nothing leaves the browser: generations are simulated.
 */

import { useCallback, useRef, useState } from 'react';
import { AIService, describeGenerationError } from '../services/ai';
import { callAIProxyTask } from '../services/aiProxy';
import { StorageService } from '../services/storage';
import { ensureFreshSession } from '../services/db';
import type { AssessmentContextType } from '../contexts/AssessmentContext';
import type { Patient, PractitionerProfile, ReportSection, TestData } from '../types';
import { anonymizeDeep } from '../utils/anonymizer';
import { buildInitialReportPayload, buildReevaluationPayload } from '../utils/aiPayload';
import { buildAssessmentRecord } from '../utils/assessment';
import type { CatalogIndex } from '../utils/catalogIndex';
import { getPatientAgeForIdentity, isPatientCreationReady } from '../utils/patient';
import { buildDeltaEntries } from '../utils/reevaluationHelpers';
import { htmlToPlainText, sectionToPlainText } from '../utils/reportContent';
import { DEMO_REEVALUATION_SECTIONS, DEMO_SECTIONS } from '../data/demoReport';
import { Logger } from '../utils/logger';

const FOLLOWUP_DELAY_MONTHS = 6;
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

const addMonths = (iso: string, months: number): string => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
};

/** Sections the practitioner edited after generation (anonymized), for the style feedback loop. */
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

export const useAssessmentFlow = ({ assessment, sessionKey, isDemoMode, catalogIndex, practitioner, refreshProfile, loadData, toast }: Params) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const finalizingRef = useRef(false);
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
    const ok = await runGeneration(async () => {
      if (isDemoMode) {
        await simulate();
        assessment.setSections(DEMO_SECTIONS);
        return;
      }
      const { patient, observations, tests, synthesis } = assessment;
      const payload = anonymizeDeep(buildInitialReportPayload({ patient, observations, tests, synthesis, index: catalogIndex }), patient);
      const { sections, reformulatedObservations } = await AIService.generateInitialReport(payload, patient, practitioner?.aiStylePreferences);

      if (Object.keys(reformulatedObservations).length > 0) {
        const updated: TestData = Object.fromEntries(
          Object.entries(tests).map(([testId, subtests]) => [
            testId,
            Object.fromEntries(
              Object.entries(subtests).map(([subId, score]) => [
                subId,
                reformulatedObservations[subId] ? { ...score, observation: reformulatedObservations[subId] } : score,
              ]),
            ),
          ]),
        );
        assessment.updateTests(updated);
      }
      assessment.setSections(sections);
      void refreshProfile();
    });
    if (ok) {
      assessment.setStep(4);
      toast.success(isDemoMode ? 'Rapport généré (simulation)' : 'Rapport généré avec succès');
    }
  }, [assessment, catalogIndex, isDemoMode, practitioner, refreshProfile, runGeneration, toast]);

  /** Re-evaluation: 4 HTML sections (reminder, evolution, conclusion, recommendations). */
  const generateReevaluation = useCallback(async (): Promise<boolean> => {
    const ok = await runGeneration(async () => {
      if (isDemoMode) {
        await simulate();
        assessment.setSections(DEMO_REEVALUATION_SECTIONS);
        return;
      }
      const { patient, previousAssessment, tests } = assessment;
      const previousTests = previousAssessment?.tests ?? {};
      const deltas = buildDeltaEntries(previousTests, tests, catalogIndex);
      const payload = anonymizeDeep(
        buildReevaluationPayload({ patient, previousAssessment, previousTests, newTests: tests, deltas, index: catalogIndex }),
        patient,
      );
      assessment.setSections(await AIService.generateReevaluation(payload, patient, practitioner?.aiStylePreferences));
      void refreshProfile();
    });
    if (ok) toast.success(isDemoMode ? 'Synthèse générée (simulation)' : 'Synthèse générée — relisez et ajustez si besoin.');
    return ok;
  }, [assessment, catalogIndex, isDemoMode, practitioner, refreshProfile, runGeneration, toast]);

  /** Create the local patient record if needed and return an up-to-date snapshot. */
  const persistPatient = useCallback(async (): Promise<Patient | null> => {
    const patient: Patient = { ...assessment.patient, age: getPatientAgeForIdentity(assessment.patient) };
    if (!patient.id) {
      if (!isPatientCreationReady(patient)) {
        toast.error('Nom, prénom et date de naissance requis.');
        return null;
      }
      const id = await assessment.ensurePatientId(patient);
      if (!id) {
        toast.error('Impossible de créer le dossier patient.');
        return null;
      }
      patient.id = id;
      assessment.updatePatient({ id, age: patient.age });
    }
    return patient;
  }, [assessment, toast]);

  /**
   * Save the assessment as a formal record, schedule the next follow-up, send
   * the style feedback (edited AI sections) and clean the draft.
   * Returns true when the caller can go back to the dashboard.
   */
  const finalize = useCallback(async (): Promise<boolean> => {
    if (isDemoMode) {
      assessment.resetAssessment();
      toast.success('Bilan validé (démo, rien n’est enregistré).');
      return true;
    }
    if (!sessionKey) {
      toast.error("L'application est verrouillée : déverrouillez-la puis réessayez.");
      return false;
    }
    if (finalizingRef.current) return false; // double click
    finalizingRef.current = true;
    try {
      await ensureFreshSession();
      const patient = await persistPatient();
      if (!patient?.id) return false;
      const { reportType, historicalDate, tests, sections, previousAssessment } = assessment;
      const isHistorical = reportType === 'historique';
      const date = isHistorical && historicalDate ? historicalDate : new Date().toISOString();

      const record = buildAssessmentRecord({
        // A historical import is the initial assessment done outside the app.
        kind: reportType === 'reevaluation' ? 'reevaluation' : 'initial',
        date,
        tests,
        sections,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        previousAssessmentId: reportType === 'reevaluation' ? previousAssessment?.id : undefined,
        index: catalogIndex,
      });
      await StorageService.addAssessment(patient, record);

      // Next re-evaluation reminder, 6 months after this assessment (best effort).
      try {
        await StorageService.upsertPatientFollowup({
          patientId: patient.id,
          status: 'upcoming',
          dueAt: addMonths(date, FOLLOWUP_DELAY_MONTHS),
          note: reportType === 'reevaluation' ? 'Rappel généré après réévaluation' : 'Rappel généré après bilan initial',
        });
      } catch (e) {
        Logger.warn('DB', 'Follow-up update failed (non-blocking)', e);
      }

      // Style feedback loop: learn from the practitioner's corrections (fire-and-forget, no credit).
      const diffs = isHistorical ? [] : buildStyleDiffs(sections, patient);
      if (diffs.length > 0) {
        callAIProxyTask({ task: 'extract_style_feedback', payload: { diffs, existingPreferences: practitioner?.aiStylePreferences || '' } })
          .then(() => refreshProfile())
          .catch((err) => Logger.warn('AI', 'Style feedback extraction failed (non-blocking)', err));
      }

      // Reset first: cancels any pending autosave so the draft is not re-created after deletion.
      assessment.resetAssessment();
      await StorageService.deleteDraft(patient.id);
      await loadData();
      toast.success(isHistorical ? 'Bilan de référence enregistré. La réévaluation est maintenant disponible.' : 'Bilan sauvegardé.');
      return true;
    } catch (e) {
      Logger.error('DB', 'Finalization failed', e);
      toast.error("Erreur lors de l'enregistrement du bilan.");
      return false;
    } finally {
      finalizingRef.current = false;
    }
  }, [assessment, catalogIndex, isDemoMode, loadData, persistPatient, practitioner, refreshProfile, sessionKey, toast]);

  /** Save a draft and leave. Returns true when the caller can go back to the dashboard. */
  const saveAndQuit = useCallback(async (): Promise<boolean> => {
    if (isDemoMode) {
      assessment.resetAssessment();
      return true;
    }
    if (!sessionKey) {
      toast.error("L'application est verrouillée : déverrouillez-la puis réessayez.");
      return false;
    }
    try {
      await ensureFreshSession();
      const patient = await persistPatient();
      if (!patient) return false;
      await StorageService.saveDraft(assessment.buildDraft(patient));
      assessment.resetAssessment();
      toast.success('Brouillon sauvegardé');
      return true;
    } catch (e) {
      Logger.error('DB', 'Save error', e);
      toast.error('Impossible de sauvegarder le brouillon.');
      return false;
    }
  }, [assessment, isDemoMode, persistPatient, sessionKey, toast]);

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
