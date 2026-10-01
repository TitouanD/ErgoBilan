/**
 * usePendingProcessor — Handles importing a pending family questionnaire
 * into the assessment workflow: decryption here, patient and draft creation in
 * the assessment in progress (`importFamily`).
 */

import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../services/db';
import { decryptEnvelope, importQuestionnaireKey } from '../utils/crypto';
import type { PendingQuestionnaire, PatientFile, Patient } from '../types';
import { DEMO_PATIENTS } from '../data/demoData';
import { Logger } from '../utils/logger';
import type { AssessmentContextType } from '../contexts/AssessmentContext';

interface UsePendingProcessorParams {
  sessionKey: CryptoKey | null;
  isDemoMode: boolean;
  assessment: AssessmentContextType;
  setPatientFiles: Dispatch<SetStateAction<PatientFile[]>>;
  setPendingQuestionnaires: Dispatch<SetStateAction<PendingQuestionnaire[]>>;
  loadData: () => Promise<void>;
  toast: { success: (m: string) => void; error: (m: string) => void };
}

export const usePendingProcessor = ({
  sessionKey,
  isDemoMode,
  assessment,
  setPatientFiles,
  setPendingQuestionnaires,
  loadData,
  toast,
}: UsePendingProcessorParams) => {
  const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);

  const handleProcessPending = useCallback(
    async (q: PendingQuestionnaire): Promise<'assessment' | null> => {
      // ---- Demo path ----
      if (isDemoMode) {
        setProcessingQueueId(q.id);
        return new Promise((resolve) => {
          setTimeout(() => {
            const newId = DEMO_PATIENTS.ELYA.id;
            const newPatient = { ...DEMO_PATIENTS.ELYA.patient, id: newId };
            const newTests = { ...DEMO_PATIENTS.ELYA.tests };
            const newObs = { ...DEMO_PATIENTS.ELYA.observations };

            setPatientFiles((prev) => [
              { id: newId, patient: newPatient, assessments: [], lastInteraction: new Date().toISOString() },
              ...prev,
            ]);
            setPendingQuestionnaires((prev) => prev.filter((i) => i.id !== q.id));

            void assessment.importFamily({ patient: newPatient, tests: newTests, observations: newObs });

            setProcessingQueueId(null);
            toast.success('Dossier importé et déchiffré');
            resolve('assessment');
          }, 1500);
        });
      }

      // ---- Real path ----
      if (!sessionKey) return null;

      setProcessingQueueId(q.id);
      try {
        const { data } = await supabase
          .from('pending_questionnaires')
          .select('family_encrypted_data, practitioner_encrypted_key')
          .eq('id', q.id)
          .single();

        if (!data?.family_encrypted_data) {
          toast.error("Ce questionnaire n'a pas encore été rempli par la famille.");
          return null;
        }

        const keyStr = (await decryptEnvelope(data.practitioner_encrypted_key, sessionKey)) as string;
        const qKey = await importQuestionnaireKey(keyStr);

        const payload = (await decryptEnvelope(data.family_encrypted_data, qKey)) as Record<string, unknown> | null;

        if (payload?.patient) {
          // SECURITY/PRIVACY GUARANTEE: deleting the row isolates the family's submission
          // from later edits (the link becomes invalid; local changes are never written
          // back). `importFamily` rolls the local import back if the deletion fails, so a
          // retry cannot create a duplicate patient.
          const result = await assessment.importFamily({ patient: payload.patient as Patient }, async () => {
            const { error: deleteError } = await supabase.from('pending_questionnaires').delete().eq('id', q.id);
            if (deleteError) throw deleteError;
          });
          if (!result.ok) {
            toast.error('Erreur importation.');
            return null;
          }
          setPendingQuestionnaires((prev) => prev.filter((i) => i.id !== q.id));
          void loadData();
          toast.success('Dossier importé');
          return 'assessment';
        }

        return null;
      } catch (e) {
        Logger.error('CRYPTO', 'Import Error', e);
        toast.error('Erreur importation.');
        return null;
      } finally {
        setProcessingQueueId(null);
      }
    },
    [sessionKey, isDemoMode, assessment, setPatientFiles, setPendingQuestionnaires, loadData, toast],
  );

  return { processingQueueId, handleProcessPending };
};
