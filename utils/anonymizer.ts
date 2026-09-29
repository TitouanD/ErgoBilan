/**
 * anonymizer.ts — anonymization of what is sent to the AI (see CONTEXT.md),
 * and re-hydration of the generated report afterwards.
 *
 * Every identifying value of the patient file (child, parents, siblings,
 * school, doctors, followed-by professionals, contact details) is replaced by
 * a placeholder such as `{{PATIENT_PRENOM}}` or `{{PARENT_1}}`. Numbered
 * placeholders keep the mapping reversible. Matching is case-insensitive and
 * bounded by word boundaries so a short first name ("Ali") never corrupts a
 * longer word ("qualité").
 *
 * Words the practitioner chose to mask (`aiMaskedTerms`) become
 * `{{PERSONNE_n}}`. Precise dates become `{{DATE_n}} (il y a 8 mois)`: the AI
 * can still reason on durations, and the report gets the real date back.
 *
 * Use `createAnonymization(patient).deep` on the whole payload rather than
 * anonymizing fields one by one: any new field added to the payload is then
 * covered automatically. The same instance re-hydrates the answer, since it
 * holds the date placeholders it created.
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
  [/\{\{PERSONNE_\d+\}\}/g, 'cette personne'],
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
        if (t.length >= MIN_TOKEN_LENGTH && t !== v && !STOP_TOKENS.has(t.toLowerCase()))
          list.push({ value: t, placeholder, caseSensitive: true });
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

  (patient.aiMaskedTerms ?? []).forEach((term, i) => add(term, `{{PERSONNE_${i + 1}}}`));

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

/** Apply `fn` to every string nested in `value` (objects, arrays). Keys are left untouched. */
const mapStrings = <T>(value: T, fn: (s: string) => string): T => {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, walk(child)]));
    return v;
  };
  return walk(value) as T;
};

/** Pseudonymize one text (identifiers of the patient file only, dates kept). */
export const anonymizeText = (text: string, patient: Patient): string => applyReplacements(text, buildReplacements(patient));

/** Pseudonymize every string nested in `value` (identifiers of the patient file only, dates kept). */
export const anonymizeDeep = <T>(value: T, patient: Patient): T => {
  const replacements = buildReplacements(patient);
  return mapStrings(value, (s) => applyReplacements(s, replacements));
};

const hydrateWith = (text: string, replacements: Replacement[], options: { asHtml?: boolean }): string => {
  const byPlaceholder = new Map<string, string>();
  for (const r of replacements) {
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

/**
 * Replace placeholders in a generated text with the real values (identifiers
 * of the patient file). `asHtml` escapes the injected values (they come from
 * the patient file, partly typed by the family in the portal) when the output is HTML.
 */
export const hydrateReport = (text: string, patient: Patient, options: { asHtml?: boolean } = {}): string =>
  hydrateWith(text, buildReplacements(patient), options);

// ─── Dates ──────────────────────────────────────────────────────────────────

const MONTH_BY_NAME = new Map<string, number>(
  ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'].map((m, i) => [
    m,
    i + 1,
  ]),
);
MONTH_BY_NAME.set('fevrier', 2).set('aout', 8).set('decembre', 12);

const YEAR = '((?:19|20)\\d{2})';
const MONTH_NAME = `(${[...MONTH_BY_NAME.keys()].join('|')})`;
const NOT_BEFORE = '(?<![\\p{L}\\p{N}/.-])';
const NOT_AFTER = '(?![\\p{L}\\p{N}]|[/.-]\\d)';
/**
 * A precise date: 12/03/2024, 12-03-2024, 2024-03-12, 03/2024, 12 mars 2024,
 * 1er mars 2024, mars 2024. A year alone is kept (not precise enough).
 */
const DATE_PATTERN = new RegExp(
  [
    `${NOT_BEFORE}(\\d{1,2})[/.-](\\d{1,2})[/.-]${YEAR}${NOT_AFTER}`,
    `${NOT_BEFORE}${YEAR}-(\\d{1,2})-(\\d{1,2})${NOT_AFTER}`,
    `${NOT_BEFORE}(\\d{1,2})[/.-]${YEAR}${NOT_AFTER}`,
    `(?<![\\p{L}\\p{N}])(?:(\\d{1,2})(?:er)?\\s+)?${MONTH_NAME}\\s+${YEAR}(?![\\p{L}\\p{N}])`,
  ].join('|'),
  'giu',
);
const DATE_GROUPS = 11;

/** Year and month (1-12) of a matched date, or null when it is not a real date. */
const parseDateMatch = (groups: Array<string | undefined>): { year: number; month: number } | null => {
  const [d1, m1, y1, y2, m2, d2, m3, y3, d4, monthName, y4] = groups;
  const n = (v: string | undefined) => (v === undefined ? NaN : parseInt(v, 10));
  let year: number;
  let month: number;
  let day = 1;
  if (y1 !== undefined) [year, month, day] = [n(y1), n(m1), n(d1)];
  else if (y2 !== undefined) [year, month, day] = [n(y2), n(m2), n(d2)];
  else if (y3 !== undefined) [year, month] = [n(y3), n(m3)];
  else [year, month, day] = [n(y4), MONTH_BY_NAME.get((monthName ?? '').toLowerCase()) ?? NaN, d4 === undefined ? 1 : n(d4)];
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return null;
  return { year, month };
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** "il y a 8 mois", "dans 1 an et 2 mois", "ce mois-ci" (month precision). */
export const describeDateDistance = (date: { year: number; month: number }, now: Date): string => {
  const diff = (now.getFullYear() - date.year) * 12 + (now.getMonth() + 1 - date.month);
  if (diff === 0) return 'ce mois-ci';
  const abs = Math.abs(diff);
  const years = Math.floor(abs / 12);
  const months = abs % 12;
  const span = [years ? plural(years, 'an', 'ans') : '', months ? `${months} mois` : ''].filter(Boolean).join(' et ');
  return diff > 0 ? `il y a ${span}` : `dans ${span}`;
};

// ─── Anonymization of one generation ────────────────────────────────────────

export interface Anonymization {
  /** Anonymize every string nested in `value`: identifiers, masked words, precise dates. */
  deep: <T>(value: T) => T;
  /** Put the real values back into a generated text. `asHtml` escapes them. */
  hydrate: (text: string, options?: { asHtml?: boolean }) => string;
}

/** A date placeholder, with the distance the AI may have copied after it. */
const DATE_PLACEHOLDER_IN_ANSWER = /(\{\{DATE_\d+\}\})(?:\s*\((?:il y a|dans|ce mois-ci)[^)]*\))?/g;

/**
 * One anonymization per generation: the date placeholders it creates are only
 * known by this instance, so the same instance must re-hydrate the answer.
 * Placeholders are numbered in order of appearance, hence stable for a given payload.
 */
export const createAnonymization = (patient: Patient, now: Date = new Date()): Anonymization => {
  const replacements = buildReplacements(patient);
  const dateByPlaceholder = new Map<string, string>();
  const placeholderByDate = new Map<string, string>();

  const maskDates = (text: string) =>
    text.replace(DATE_PATTERN, (match: string, ...rest: unknown[]) => {
      const parsed = parseDateMatch(rest.slice(0, DATE_GROUPS) as Array<string | undefined>);
      if (!parsed) return match;
      let placeholder = placeholderByDate.get(match);
      if (!placeholder) {
        placeholder = `{{DATE_${placeholderByDate.size + 1}}}`;
        placeholderByDate.set(match, placeholder);
        dateByPlaceholder.set(placeholder, match);
      }
      return `${placeholder} (${describeDateDistance(parsed, now)})`;
    });

  return {
    deep: (value) => mapStrings(value, (s) => maskDates(applyReplacements(s, replacements))),
    hydrate: (text, options = {}) => {
      const withDates = text.replace(DATE_PLACEHOLDER_IN_ANSWER, (found, placeholder: string) => {
        const value = dateByPlaceholder.get(placeholder);
        if (value === undefined) return found;
        return options.asHtml ? escapeHtml(value) : value;
      });
      return hydrateWith(withDates, replacements, options);
    },
  };
};
