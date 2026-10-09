import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildFictiveQuestionnaires, sealQuestionnaire } from '../dev/fictiveQuestionnaires';
import { generateSymetricKey } from './crypto';
import { decryptFamilySubmission, questionnaireDisplayLabel, submissionChildName, withChildNames } from './familyQuestionnaire';
import type { Patient } from '../types';

beforeAll(() => {
  // crypto.ts reads window.crypto (browser); Node exposes the same WebCrypto globally.
  vi.stubGlobal('window', { crypto: globalThis.crypto });
});

const CREATED_AT = '2026-09-28T10:00:00.000Z';
const child = (firstName: string, lastName: string) => ({ firstName, lastName }) as Patient;

describe('questionnaire familial : nom de l’enfant (#98)', () => {
  it('un questionnaire complété affiche « Prénom Nom (date) » au lieu de « Dossier #n »', async () => {
    const sessionKey = await generateSymetricKey();
    const row = await sealQuestionnaire(sessionKey, {
      id: 'q1',
      label: 'Dossier #1 (28/09/2026)',
      createdAt: CREATED_AT,
      patient: child('Léa', 'MARTIN'),
    });

    const [named] = await withChildNames([row], sessionKey);

    expect(named.childName).toBe('Léa MARTIN');
    expect(questionnaireDisplayLabel(named)).toBe('Léa MARTIN (28/09/2026)');
  });

  it('garde le libellé générique si le déchiffrement échoue', async () => {
    const sessionKey = await generateSymetricKey();
    const otherKey = await generateSymetricKey();
    const sealedElsewhere = await sealQuestionnaire(otherKey, {
      id: 'q2',
      label: 'Dossier #2 (28/09/2026)',
      createdAt: CREATED_AT,
      patient: child('Léa', 'MARTIN'),
    });
    const corrupted = { ...sealedElsewhere, id: 'q3', practitionerEncryptedKey: 'pas-une-enveloppe' };

    const named = await withChildNames([sealedElsewhere, corrupted], sessionKey);

    expect(named.map((q) => q.childName)).toEqual([undefined, undefined]);
    expect(named.map(questionnaireDisplayLabel)).toEqual(['Dossier #2 (28/09/2026)', 'Dossier #2 (28/09/2026)']);
  });

  it('garde le libellé générique si le nom est vide, ou si la famille n’a pas répondu', async () => {
    const sessionKey = await generateSymetricKey();
    const blank = await sealQuestionnaire(sessionKey, { id: 'q4', label: 'Dossier #4', createdAt: CREATED_AT, patient: child(' ', '') });
    const waiting = await sealQuestionnaire(sessionKey, { id: 'q5', label: 'Dossier #5', createdAt: CREATED_AT });

    const named = await withChildNames([blank, waiting], sessionKey);

    expect(named.map(questionnaireDisplayLabel)).toEqual(['Dossier #4', 'Dossier #5']);
    expect(waiting.status).toBe('pending');
    // A pending row never shows a name, even if one was set.
    expect(questionnaireDisplayLabel({ ...waiting, childName: 'Léa MARTIN' })).toBe('Dossier #5');
  });

  it('décompose prénom et nom, l’un ou l’autre pouvant manquer', () => {
    expect(submissionChildName({ patient: child(' Léa ', 'MARTIN ') })).toBe('Léa MARTIN');
    expect(submissionChildName({ patient: child('Léa', '') })).toBe('Léa');
    expect(submissionChildName(null)).toBeNull();
    expect(submissionChildName({})).toBeNull();
  });

  it('decryptFamilySubmission rend la saisie de la famille (chemin de l’import)', async () => {
    const sessionKey = await generateSymetricKey();
    const row = await sealQuestionnaire(sessionKey, { id: 'q6', label: 'x', createdAt: CREATED_AT, patient: child('Léa', 'MARTIN') });

    const submission = await decryptFamilySubmission(row.practitionerEncryptedKey, row.familyEncryptedData!, sessionKey);

    expect(submission).toEqual({ patient: child('Léa', 'MARTIN'), timestamp: CREATED_AT });
    await expect(
      decryptFamilySubmission(row.practitionerEncryptedKey, row.familyEncryptedData!, await generateSymetricKey()),
    ).rejects.toThrow();
  });

  it('les questionnaires fictifs du scénario : deux noms, un repli, un en attente', async () => {
    const sessionKey = await generateSymetricKey();
    const rows = await withChildNames(await buildFictiveQuestionnaires(sessionKey, new Date('2026-10-01T09:00:00.000Z')), sessionKey);

    expect(rows.map(questionnaireDisplayLabel)).toEqual([
      'Léo FICTIF (22/09/2026)',
      'Adam FICTIF (25/09/2026)',
      'Dossier #3 (27/09/2026)',
      'Dossier #4 (30/09/2026)',
    ]);
  });
});
