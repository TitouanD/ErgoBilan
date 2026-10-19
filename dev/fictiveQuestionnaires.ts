/**
 * fictiveQuestionnaires.ts — fictitious parent questionnaires for the dashboard
 * scenario (`?scenario=dashboard&questionnaires=oui`) and the tests.
 * Development only: never imported by the production build.
 *
 * The rows are encrypted as the portal does it (link key wrapped with the
 * practitioner's sessionKey, family answers `{ patient, timestamp }` encrypted
 * with the link key), so the dashboard decrypts them by the real path
 * (utils/familyQuestionnaire.ts). They live in memory only: nothing is written
 * to Supabase, and « Importer » or « Supprimer » on them fails (unknown id).
 */

import type { Patient, PendingQuestionnaire } from '../types';
import { encryptToEnvelope, generateQuestionnaireKey, generateSymetricKey } from '../utils/crypto';
import { getFictiveProfile } from './fictivePatients';

export const FICTIVE_QUESTIONNAIRE_PREFIX = 'fictif-q';

/** A questionnaire as stored in `pending_questionnaires`, sealed with `sessionKey`. */
export const sealQuestionnaire = async (
  sessionKey: CryptoKey,
  row: { id: string; label: string; createdAt: string; patient?: Patient },
): Promise<PendingQuestionnaire> => {
  const { key, keyString } = await generateQuestionnaireKey();
  return {
    id: row.id,
    label: row.label,
    status: row.patient ? 'completed' : 'pending',
    createdAt: row.createdAt,
    practitionerEncryptedKey: await encryptToEnvelope(keyString, sessionKey),
    familyEncryptedData: row.patient ? await encryptToEnvelope({ patient: row.patient, timestamp: row.createdAt }, key) : undefined,
  };
};

/**
 * Two answered questionnaires (Léo and Adam FICTIF), one answered but sealed with
 * another practitioner key (cannot be decrypted: keeps its generic label), one
 * still waiting for the family.
 */
export const buildFictiveQuestionnaires = async (sessionKey: CryptoKey, now: Date): Promise<PendingQuestionnaire[]> => {
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const label = (n: number, createdAt: string) => `Dossier #${n} (${new Date(createdAt).toLocaleDateString('fr-FR')})`;
  const rows = [
    { n: 1, ago: 9, patient: getFictiveProfile('leo')!.patient },
    { n: 2, ago: 6, patient: getFictiveProfile('adam')!.patient },
    { n: 3, ago: 4, patient: getFictiveProfile('noah')!.patient, otherKey: true },
    { n: 4, ago: 1 },
  ];
  const otherKey = await generateSymetricKey();
  return Promise.all(
    rows.map(({ n, ago, patient, otherKey: sealedElsewhere }) => {
      const createdAt = daysAgo(ago);
      return sealQuestionnaire(sealedElsewhere ? otherKey : sessionKey, {
        id: `${FICTIVE_QUESTIONNAIRE_PREFIX}${n}`,
        label: label(n, createdAt),
        createdAt,
        patient,
      });
    }),
  );
};
