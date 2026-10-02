/**
 * suspectTerms.ts — words of an anonymized payload that may still identify
 * someone: a name typed in the free text but absent from the patient file
 * (nickname, grandparent, another therapist, town).
 *
 * Regexes cannot guarantee anonymity of free text: the suspects are shown to
 * the practitioner before the generation, who masks them (default) or allows
 * them. Both choices are kept on the patient file (`aiMaskedTerms`,
 * `aiAllowedTerms`), so a word is asked about once.
 *
 * A word is suspect when it starts with a capital letter outside the start of
 * a sentence, or follows a title (Mme, M., Dr, Pr). Ignored: catalogue names,
 * words in capitals only (TDAH, MABC, placeholders), months, days and a short
 * list of common words.
 */

import type { Patient } from '../types';
import type { CatalogIndex } from './catalogIndex';

const TITLES = ['m', 'mme', 'mlle', 'mr', 'madame', 'monsieur', 'dr', 'docteur', 'pr', 'professeur'];

const COMMON_WORDS = [
  ...TITLES,
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
  'france',
  'français',
  'française',
  'europe',
  'internet',
  'noël',
  'pâques',
  'toussaint',
  'ergothérapie',
  'ergothérapeute',
  'orthophonie',
  'orthophoniste',
  'kinésithérapie',
  'kinésithérapeute',
  'psychomotricité',
  'psychomotricien',
  'psychomotricienne',
  'psychologue',
  'neuropsychologue',
  'pédiatre',
  'neuropédiatre',
  'orthoptiste',
  'médecin',
  'maternelle',
  'primaire',
  'collège',
  'lycée',
  'école',
  'classe',
];

/** Sentence start: nothing before, or one of these characters (spaces skipped). */
const SENTENCE_START = new Set(['.', '!', '?', ':', ';', '\n', '[', ']', '(', '-', '–', '—', '•', '*', '«', '"', '/', '|', '>', '{']);
const WORD = /\p{L}[\p{L}'’-]*/gu;
/** Elision before a capitalized word: d'Emma, l'Hôpital, qu'Emma. */
const ELISION = /^(?:[dljmnstc]|qu)['’]/iu;

const catalogWords = (index: CatalogIndex): Set<string> => {
  const names: string[] = [];
  for (const test of index.testById.values()) names.push(test.name);
  for (const category of index.categoryByTestId.values()) names.push(category.name);
  for (const subtest of index.subtestByKey.values()) {
    names.push(subtest.name);
    for (const option of subtest.inputConfig?.options ?? []) names.push(option.label);
  }
  return new Set(names.flatMap((n) => n.match(WORD) ?? []).map((w) => w.toLowerCase()));
};

const collectStrings = (value: unknown, out: string[]): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
};

/** Suspect words of `value` (every nested string), in order of appearance, without duplicates. */
export const findSuspectTerms = (value: unknown, options: { index: CatalogIndex; allowed?: string[] }): string[] => {
  const known = new Set([...COMMON_WORDS, ...catalogWords(options.index), ...(options.allowed ?? []).map((w) => w.toLowerCase())]);
  const found = new Map<string, string>();

  for (const text of collectStrings(value, [])) {
    let previousWord = '';
    let previousEnd = 0;
    for (const match of text.matchAll(WORD)) {
      const start = match.index!;
      const between = text.slice(previousEnd, start);
      const raw = match[0].replace(/[-'’]+$/, '');
      const word = raw.replace(ELISION, '');
      const before = text.slice(0, start).replace(/[ \t]+$/, '');
      const atSentenceStart = before === '' || SENTENCE_START.has(before.slice(-1));
      // A title is capitalized (Mme, M., Dr): the unit « m » of « 10 m en 5 s » is not one.
      const afterTitle = /^\p{Lu}/u.test(previousWord) && TITLES.includes(previousWord.toLowerCase()) && /^\.?\s+$/.test(between);
      previousWord = word;
      previousEnd = start + match[0].length;

      if (word.length < 2 || known.has(word.toLowerCase())) continue;
      if (word === word.toUpperCase()) continue;
      const capitalized = /^\p{Lu}/u.test(word);
      const elided = word !== raw;
      if (afterTitle || (capitalized && (!atSentenceStart || elided))) {
        const key = word.toLowerCase();
        if (!found.has(key)) found.set(key, word);
      }
    }
  }
  return [...found.values()];
};

/** Practitioner's choices on the suspect words of one generation. */
export interface SuspectTermDecisions {
  masked: string[];
  allowed: string[];
}

const mergeTerms = (current: string[] | undefined, added: string[]): string[] => {
  const seen = new Set((current ?? []).map((t) => t.toLowerCase()));
  const result = [...(current ?? [])];
  for (const term of added) {
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    result.push(term);
  }
  return result;
};

/** The patient fields updated with the choices (kept for the next generations). */
export const applySuspectTermDecisions = (
  patient: Patient,
  decisions: SuspectTermDecisions,
): Pick<Patient, 'aiMaskedTerms' | 'aiAllowedTerms'> => ({
  aiMaskedTerms: mergeTerms(patient.aiMaskedTerms, decisions.masked),
  aiAllowedTerms: mergeTerms(patient.aiAllowedTerms, decisions.allowed),
});
