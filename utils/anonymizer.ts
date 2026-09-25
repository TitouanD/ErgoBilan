/**
 * anonymizer.ts — pseudonymization of patient identifiers before any text is
 * sent to the AI, and re-hydration of the generated report afterwards.
 *
 * Every identifying value of the patient file (child, parents, siblings,
 * school, doctors, followed-by professionals, contact details) is replaced by
 * a placeholder such as `{{PATIENT_PRENOM}}` or `{{PARENT_1}}`. Numbered
 * placeholders keep the mapping reversible. Matching is case-insensitive and
 * bounded by word boundaries so a short first name ("Ali") never corrupts a
 * longer word ("qualité").
 *
 * Use `anonymizeDeep` on the whole payload rather than anonymizing fields one
 * by one: any new field added to the payload is then covered automatically.
 */

import type { Patient } from '../types';
import { escapeHtml } from './reportContent';

interface Replacement {
  value: string;
  placeholder: string;
  /** Proper-noun token (a part of a multi-word name): matched case-sensitively to avoid hitting common words. */
  caseSensitive?: boolean;
}

/** Neutral wording used when the model returns a placeholder we cannot map back. */
const RESIDUAL_FALLBACKS: Array<[RegExp, string]> = [
  [/\{\{PATIENT_[A-Z_]+\}\}/g, "l'enfant"],
  [/\{\{PARENTS?(?:_\d+)?\}\}/g, 'le parent'],
  [/\{\{FRATRIE_\d+\}\}/g, 'un membre de la fratrie'],
  [/\{\{PROFESSIONNEL_\d+\}\}/g, 'le professionnel'],
  [/\{\{MEDECIN(?:_TRAITANT)?\}\}/g, 'le médecin'],
  [/\{\{ECOLE\}\}/g, "l'établissement scolaire"],
  [/\{\{ENSEIGNANT\}\}/g, "l'enseignant(e)"],
  [/\{\{[A-Z0-9_]+\}\}/g, ''],
];

const MIN_VALUE_LENGTH = 2;
const MIN_TOKEN_LENGTH = 3;
/** Titles and connectors found inside name fields: never treated as identifying tokens. */
const STOP_TOKENS = new Set(['mme', 'mlle', 'madame', 'monsieur', 'mr', 'dr', 'docteur', 'pr', 'professeur', 'les', 'et', 'des', 'chez']);

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Build the full replacement table for a patient (longest values first). */
export const buildReplacements = (patient: Patient): Replacement[] => {
  const list: Replacement[] = [];
  const add = (value: unknown, placeholder: string, splitTokens = false) => {
    const v = clean(value);
    if (v.length < MIN_VALUE_LENGTH) return;
    list.push({ value: v, placeholder });
    if (splitTokens) {
      for (const token of v.split(/[\s,;/&]+/)) {
        const t = token.replace(/\.$/, '');
        if (t.length >= MIN_TOKEN_LENGTH && t !== v && !STOP_TOKENS.has(t.toLowerCase())) list.push({ value: t, placeholder, caseSensitive: true });
      }
    }
  };

  add(`${clean(patient.firstName)} ${clean(patient.lastName)}`, '{{PATIENT_NOM_COMPLET}}');
  add(patient.firstName, '{{PATIENT_PRENOM}}');
  add(patient.lastName, '{{PATIENT_NOM}}');
  add(patient.dob, '{{DATE_NAISSANCE}}');
  add(patient.address, '{{ADRESSE}}');

  add(patient.parent1Name, '{{PARENT_1}}', true);
  add(patient.parent2Name, '{{PARENT_2}}', true);
  add(patient.parentNames, '{{PARENTS}}', true);
  [patient.parentPhone, patient.parent1Phone, patient.parent2Phone].forEach((v) => add(v, '{{TELEPHONE}}'));
  [patient.parentEmail, patient.parent1Email, patient.parent2Email].forEach((v) => add(v, '{{EMAIL}}'));
  [patient.parent1Address, patient.parent2Address].forEach((v) => add(v, '{{ADRESSE}}'));

  (patient.siblings ?? []).forEach((s, i) => add(s.firstName, `{{FRATRIE_${i + 1}}}`));

  add(patient.school, '{{ECOLE}}');
  add(patient.teacher, '{{ENSEIGNANT}}', true);
  add(patient.prescribingDoctor, '{{MEDECIN}}', true);
  add(patient.treatingDoctor, '{{MEDECIN_TRAITANT}}', true);
  (patient.medicalTracking ?? []).forEach((t, i) => {
    add(t.name, `{{PROFESSIONNEL_${i + 1}}}`, true);
    add(t.contact, `{{PROFESSIONNEL_${i + 1}}}`);
  });

  // Longest first so "Léa Martin" is replaced before "Léa"; dedupe on value.
  const seen = new Set<string>();
  return list
    .sort((a, b) => b.value.length - a.value.length)
    .filter((r) => {
      const key = `${r.caseSensitive ? 'cs' : 'ci'}:${r.value.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex matching `value` as a whole word (Unicode letters/digits count as word characters). */
const wordRegex = (value: string, caseSensitive: boolean) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`, caseSensitive ? 'gu' : 'giu');

const applyReplacements = (text: string, replacements: Replacement[]): string =>
  replacements.reduce((acc, r) => acc.replace(wordRegex(r.value, !!r.caseSensitive), r.placeholder), text);

/** Pseudonymize one text. */
export const anonymizeText = (text: string, patient: Patient): string => applyReplacements(text, buildReplacements(patient));


/** Pseudonymize every string nested in `value` (objects, arrays). Keys are left untouched. */
export const anonymizeDeep = <T>(value: T, patient: Patient): T => {
  const replacements = buildReplacements(patient);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return applyReplacements(v, replacements);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, walk(child)]));
    return v;
  };
  return walk(value) as T;
};

/**
 * Replace placeholders in a generated text with the real values.
 * `asHtml` escapes the injected values (they come from the patient file,
 * partly typed by the family in the portal) when the output is HTML.
 */
export const hydrateReport = (text: string, patient: Patient, options: { asHtml?: boolean } = {}): string => {
  const byPlaceholder = new Map<string, string>();
  for (const r of buildReplacements(patient)) {
    if (!r.caseSensitive && !byPlaceholder.has(r.placeholder)) byPlaceholder.set(r.placeholder, r.value);
  }
  let result = text.replace(/\{\{[A-Z0-9_]+\}\}/g, (placeholder) => {
    const value = byPlaceholder.get(placeholder);
    if (value === undefined) return placeholder;
    return options.asHtml ? escapeHtml(value) : value;
  });
  for (const [pattern, fallback] of RESIDUAL_FALLBACKS) result = result.replace(pattern, fallback);
  return result;
};
