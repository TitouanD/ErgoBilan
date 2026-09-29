/**
 * useAssessmentLauncher — starts or resumes an assessment (utils/assessmentInProgress.ts does the
 * work, see utils/assessmentInProgress.ts) and turns refusals into messages.
 *
 * - New initial / historical assessment (optionally for an existing patient).
 * - Re-evaluation: starts from the reference assessment's tests with empty
 *   scores. Refused when no reference exists.
 * - Draft resume, including re-evaluation drafts and stale drafts (turned into
 *   a re-evaluation).
 */

import { useCallback } from 'react';
import type { AssessmentContextType, ReportType } from '../contexts/AssessmentContext';
import type { DashboardDraftMeta, Patient, PatientAssessment, PatientFile } from '../types';
import { isStaleDraft } from '../utils/assessmentInProgress';

interface Params {
  assessment: AssessmentContextType;
  patientFiles: PatientFile[];
  draftsIndex: Record<string, DashboardDraftMeta>;
  toast: { error: (m: string) => void; info: (m: string) => void };
}

const NO_PATIENT = 'Impossible de démarrer la réévaluation : patient introuvable.';
const NO_REFERENCE = "Aucun bilan de référence pour ce patient : réalisez ou importez d'abord un bilan initial.";

export const useAssessmentLauncher = ({ assessment, patientFiles, draftsIndex, toast }: Params) => {
  /** Start a new assessment. Returns false when it cannot start (e.g. re-evaluation without reference). */
  const startAssessment = useCallback(
    async (type: ReportType, patient?: Patient, knownAssessments?: PatientAssessment[]): Promise<boolean> => {
      const result = await assessment.start(type, patient, knownAssessments);
      if (result.ok) return true;
      if (result.reason === 'no-reference') toast.info(NO_REFERENCE);
      else toast.error(NO_PATIENT);
      return false;
    },
    [assessment, toast],
  );

  /** Resume the patient's draft. Returns false when nothing could be opened. */
  const resumeDraft = useCallback(
    async (patientId: string): Promise<boolean> => {
      const hasFormalReport = patientFiles.find((f) => f.id === patientId)?.previewMeta?.flags?.hasInitialReport ?? false;
      const result = await assessment.resume(patientId, { stale: isStaleDraft(draftsIndex[patientId], hasFormalReport) });
      if (result.ok) return true;
      if (result.reason === 'demo') toast.info('Brouillons désactivés en démo.');
      else if (result.reason === 'no-reference') toast.info(NO_REFERENCE);
      else if (result.reason === 'no-patient') toast.error(NO_PATIENT);
      else toast.error('Impossible de charger ce brouillon.');
      return false;
    },
    [assessment, draftsIndex, patientFiles, toast],
  );

  return { startAssessment, resumeDraft };
};
