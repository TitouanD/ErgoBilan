/**
 * usePendingProcessor — Handles importing a pending family questionnaire
 * into the assessment workflow (decryption, patient creation, draft bootstrap).
 */

import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../services/db';
import { decryptData, importQuestionnaireKey } from '../utils/crypto';
import { StorageService } from '../services/storage';
import type { DraftPayload, PendingQuestionnaire, PatientFile, Patient } from '../types';
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

            assessment.resetAssessment();
            assessment.setPatient(newPatient);
            assessment.updateTests(newTests);
            assessment.updateObservations(newObs);

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

        const [kIv, kContent] = data.practitioner_encrypted_key.split(':');
        const keyStr = await decryptData({ iv: kIv, content: kContent }, sessionKey) as string;
        const qKey = await importQuestionnaireKey(keyStr);

        const [dIv, dContent] = data.family_encrypted_data.split(':');
        const payload = await decryptData({ iv: dIv, content: dContent }, qKey) as Record<string, unknown> | null;

        if (payload?.patient) {
          const basePatient = { ...(payload.patient as Patient) };
          const newId = await StorageService.createPatient(basePatient);
          const newPatient = { ...basePatient, id: newId };
          const initialDraft: DraftPayload = { patient: newPatient, reportType: 'initial', step: 1, timestamp: new Date().toISOString() };

          // SECURITY/PRIVACY GUARANTEE: deleting the row isolates the family's submission
          // from later edits (the link becomes invalid; local changes are never written
          // back). If the draft or the deletion fails, the local import is rolled back so
          // a retry cannot create a duplicate patient.
          try {
            await StorageService.saveDraft(initialDraft);
            const { error: deleteError } = await supabase.from('pending_questionnaires').delete().eq('id', q.id);
            if (deleteError) throw deleteError;
          } catch (importError) {
            await StorageService.deleteFile(newId).catch((rollbackError) => Logger.error('DB', 'Import rollback failed', rollbackError));
            throw importError;
          }
          setPendingQuestionnaires((prev) => prev.filter((i) => i.id !== q.id));
          void loadData();

          assessment.resetAssessment();
          assessment.loadFromDraft(initialDraft);
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
