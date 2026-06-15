/**
 * usePendingProcessor — Handles importing a pending family questionnaire
 * into the assessment workflow (decryption, patient creation, draft bootstrap).
 */

import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../services/db';
import { decryptData, importQuestionnaireKey } from '../utils/crypto';
import { StorageService } from '../services/storage';
import type { PendingQuestionnaire, PatientFile, Patient } from '../types';
import { DEMO_PATIENTS } from '../data/demoData';
import { Logger } from '../utils/logger';
import type { AssessmentHandle } from './useAssessmentFlow';

interface UsePendingProcessorParams {
  sessionKey: CryptoKey | null;
  isDemoMode: boolean;
  assessment: AssessmentHandle;
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
            const newId = 'demo-leo';
            const newPatient = { ...DEMO_PATIENTS.LEO.patient, id: newId };
            const newTests = { ...DEMO_PATIENTS.LEO.tests };
            const newObs = { ...DEMO_PATIENTS.LEO.observations };

            setPatientFiles((prev) => [
              { id: newId, patient: newPatient, assessments: [], lastInteraction: new Date().toISOString() },
              ...prev,
            ]);
            setPendingQuestionnaires((prev) => prev.filter((i) => i.id !== q.id));

            assessment.resetAssessment();
            assessment.setPatient(newPatient);
            assessment.setTests(newTests);
            assessment.setObservations(newObs);

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

        if (!data?.family_encrypted_data) return null;

        const [kIv, kContent] = data.practitioner_encrypted_key.split(':');
        const keyStr = await decryptData({ iv: kIv, content: kContent }, sessionKey) as string;
        const qKey = await importQuestionnaireKey(keyStr);

        const [dIv, dContent] = data.family_encrypted_data.split(':');
        const payload = await decryptData({ iv: dIv, content: dContent }, qKey) as Record<string, unknown> | null;

        if (payload?.patient) {
          const basePatient = { ...(payload.patient as Patient) };
          const newId = await StorageService.createPatient(basePatient);
          const newPatient = { ...basePatient, id: newId };

          const initialDraft = {
            patient: newPatient,
            tests: {},
            observations: { anamnese: '', motricite: '', coordination: '', spatial: '', graphique: '' },
            synthesis: { diagnosticInput: '', projectInput: '', recommendationsInput: '' },
            sections: [],
            reportType: 'initial' as const,
            step: 1,
            timestamp: new Date().toISOString(),
          };
          await StorageService.saveDraft(initialDraft);
          loadData();

          await supabase.from('pending_questionnaires').delete().eq('id', q.id);

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
    [sessionKey, orgKey, isDemoMode, assessment, setPatientFiles, setPendingQuestionnaires, loadData, toast],
  );

  return { processingQueueId, handleProcessPending };
};
