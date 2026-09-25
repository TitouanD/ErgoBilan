/**
 * useAssessmentLauncher — starts or resumes an assessment in the context.
 *
 * - New initial / historical assessment (optionally for an existing patient).
 * - Re-evaluation: loads the reference assessment (latest formal one) and starts
 *   from its tests with empty scores. Refused when no reference exists.
 * - Draft resume, including re-evaluation drafts (their reference assessment is
 *   restored) and "stale" drafts: an initial/historical draft for a patient who
 *   meanwhile got a formal report is turned into a re-evaluation.
 */

import { useCallback } from 'react';
import type { AssessmentContextType, ReportType } from '../contexts/AssessmentContext';
import type { DashboardDraftMeta, Patient, PatientAssessment, PatientFile } from '../types';
import { StorageService } from '../services/storage';
import { buildEmptyTestsFrom, getAssessmentTests, getLatestFormalAssessment } from '../utils/assessment';
import type { CatalogIndex } from '../utils/catalogIndex';
import { Logger } from '../utils/logger';
import { getPatientAgeForIdentity } from '../utils/patient';

interface Params {
  assessment: AssessmentContextType;
  isDemoMode: boolean;
  ensureCatalogLoaded: () => Promise<CatalogIndex>;
  patientFiles: PatientFile[];
  draftsIndex: Record<string, DashboardDraftMeta>;
  toast: { error: (m: string) => void; info: (m: string) => void };
}

/** Initial/historical draft left behind although the patient already has a formal report. */
export const isStaleDraft = (meta: DashboardDraftMeta | undefined | null, hasFormalReport: boolean): boolean =>
  Boolean(meta) && hasFormalReport && meta!.reportType !== 'reevaluation';

export const useAssessmentLauncher = ({ assessment, isDemoMode, ensureCatalogLoaded, patientFiles, draftsIndex, toast }: Params) => {
  /** Put the reference assessment in the context (tests rebuilt from flat results for old records). */
  const applyReference = useCallback(
    async (reference: PatientAssessment, withEmptyScores: boolean) => {
      const index = await ensureCatalogLoaded();
      const referenceTests = getAssessmentTests(reference, index);
      assessment.setPreviousAssessment({ ...reference, tests: referenceTests });
      if (withEmptyScores) assessment.updateTests(buildEmptyTestsFrom(referenceTests));
    },
    [assessment, ensureCatalogLoaded],
  );

  const loadAssessments = useCallback(async (patientId: string): Promise<PatientAssessment[]> => {
    const details = await StorageService.loadPatientDetails(patientId);
    return details.assessments ?? [];
  }, []);

  /** Start a new assessment. Returns false when it cannot start (e.g. re-evaluation without reference). */
  const startAssessment = useCallback(
    async (type: ReportType, patient?: Patient, knownAssessments?: PatientAssessment[]): Promise<boolean> => {
      let reference: PatientAssessment | null = null;
      if (type === 'reevaluation') {
        if (!patient?.id) {
          Logger.error('DB', 'Re-evaluation requested without a patient id');
          toast.error('Impossible de démarrer la réévaluation : patient introuvable.');
          return false;
        }
        reference = getLatestFormalAssessment(knownAssessments ?? (await loadAssessments(patient.id)));
        if (!reference) {
          toast.info("Aucun bilan de référence pour ce patient : réalisez ou importez d'abord un bilan initial.");
          return false;
        }
      }
      assessment.resetAssessment();
      assessment.setReportType(type);
      // The stored age is the one computed when the file was last saved: refresh it for the new report.
      if (patient) assessment.setPatient({ ...patient, age: getPatientAgeForIdentity(patient) });
      if (reference) await applyReference(reference, true);
      return true;
    },
    [assessment, applyReference, loadAssessments, toast],
  );

  /** Resume the patient's draft. Returns false when nothing could be opened. */
  const resumeDraft = useCallback(
    async (patientId: string): Promise<boolean> => {
      if (isDemoMode) {
        toast.info('Brouillons désactivés en démo.');
        return false;
      }
      try {
        const file = patientFiles.find((f) => f.id === patientId);
        const hasFormalReport = file?.previewMeta?.flags?.hasInitialReport ?? false;

        if (isStaleDraft(draftsIndex[patientId], hasFormalReport)) {
          await StorageService.deleteDraft(patientId);
          const details = await StorageService.loadPatientDetails(patientId);
          return startAssessment('reevaluation', details.patient, details.assessments);
        }

        const draft = await StorageService.getDraft(patientId);
        if (!draft) {
          toast.error('Impossible de charger ce brouillon.');
          return false;
        }
        assessment.resetAssessment();
        assessment.loadFromDraft(draft);

        if (draft.reportType === 'reevaluation') {
          const assessments = await loadAssessments(patientId);
          const reference = assessments.find((a) => a.id === draft.previousAssessmentId) ?? getLatestFormalAssessment(assessments);
          const hasScores = Object.keys(draft.tests ?? {}).length > 0;
          if (reference) await applyReference(reference, !hasScores);
        }
        return true;
      } catch (e) {
        Logger.error('DB', 'Draft resume failed', e);
        toast.error('Impossible de charger ce brouillon.');
        return false;
      }
    },
    [assessment, applyReference, draftsIndex, isDemoMode, loadAssessments, patientFiles, startAssessment, toast],
  );

  return { startAssessment, resumeDraft };
};
