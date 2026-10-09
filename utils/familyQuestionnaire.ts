/**
 * familyQuestionnaire.ts — reading a family questionnaire (parent portal) on
 * the practitioner side.
 *
 * The family's answers live in Supabase only encrypted (`family_encrypted_data`,
 * key of the link); that key is itself stored encrypted with the practitioner's
 * `sessionKey` (`practitioner_encrypted_key`). Everything is decrypted in the
 * browser: the child's name is never written in clear to Supabase. The
 * `label` column keeps its generic `Dossier #N (date)` (docs/WORKFLOWS.md §7).
 */

import type { Patient, PendingQuestionnaire } from '../types';
import { decryptEnvelope, importQuestionnaireKey } from './crypto';
import { Logger } from './logger';

export interface FamilySubmission {
  patient?: Patient;
  timestamp?: string;
}

/** Decrypt the family's submission: link key with the sessionKey, then the data. Throws on a wrong key or a malformed envelope. */
export const decryptFamilySubmission = async (
  practitionerEncryptedKey: string,
  familyEncryptedData: string,
  sessionKey: CryptoKey,
): Promise<FamilySubmission | null> => {
  const keyString = (await decryptEnvelope(practitionerEncryptedKey, sessionKey)) as string;
  const questionnaireKey = await importQuestionnaireKey(keyString);
  return (await decryptEnvelope(familyEncryptedData, questionnaireKey)) as FamilySubmission | null;
};

/** « Prénom Nom » of the child of a submission, or null when both are empty. */
export const submissionChildName = (submission: FamilySubmission | null): string | null => {
  const patient = submission?.patient;
  const name = [patient?.firstName, patient?.lastName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return name || null;
};

/**
 * Add the child's name to the completed questionnaires that carry their encrypted
 * data. A row that cannot be decrypted keeps no name (its generic label is shown).
 */
export const withChildNames = async (rows: PendingQuestionnaire[], sessionKey: CryptoKey): Promise<PendingQuestionnaire[]> =>
  Promise.all(
    rows.map(async (row) => {
      if (row.status !== 'completed' || !row.familyEncryptedData || !row.practitionerEncryptedKey) return row;
      try {
        const childName = submissionChildName(
          await decryptFamilySubmission(row.practitionerEncryptedKey, row.familyEncryptedData, sessionKey),
        );
        return childName ? { ...row, childName } : row;
      } catch (e) {
        Logger.warn('CRYPTO', 'Questionnaire name decryption failed', { questionnaireId: row.id, error: e });
        return row;
      }
    }),
  );

/** Label shown on the dashboard: « Prénom Nom (date) » once the family answered, the generic label otherwise. */
export const questionnaireDisplayLabel = (q: Pick<PendingQuestionnaire, 'label' | 'status' | 'createdAt' | 'childName'>): string => {
  if (q.status !== 'completed' || !q.childName) return q.label;
  const date = new Date(q.createdAt);
  return Number.isNaN(date.getTime()) ? q.childName : `${q.childName} (${date.toLocaleDateString('fr-FR')})`;
};
