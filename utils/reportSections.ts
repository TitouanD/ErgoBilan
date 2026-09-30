/**
 * reportSections.ts — ids and titles of the sections the AI writes (front side).
 *
 * The ids are stored in the reports and read by the page layout
 * (`utils/reportData.ts`), the re-evaluation context (`utils/aiPayload.ts`)
 * and the style preferences. The edge function `generate` keeps its own list
 * of answer keys (`supabase/functions/generate/prompts.ts`).
 */

export const INITIAL_SECTIONS = [
  { id: 'mandat_ref', title: 'Mandat de référencement en ergothérapie' },
  { id: 'mandat_eval', title: "Mandat d'évaluation en ergothérapie" },
  { id: 'profil', title: 'Profil occupationnel' },
  { id: 'diagnostic', title: 'Diagnostic en ergothérapie' },
  { id: 'objectifs', title: 'Les objectifs généraux' },
  { id: 'project', title: "Projet d'accompagnement" },
  { id: 'recommandations', title: 'Recommandations' },
] as const;

export const REEVALUATION_SECTIONS = [
  { id: 'resume_initial', title: 'Rappel du bilan initial' },
  { id: 'evolution', title: 'Évolution des résultats' },
  { id: 'conclusion', title: 'Conclusion' },
  { id: 'recommandations_reev', title: 'Préconisations' },
] as const;

export type InitialSectionId = (typeof INITIAL_SECTIONS)[number]['id'];
export type ReevaluationSectionId = (typeof REEVALUATION_SECTIONS)[number]['id'];

/** Title of the recommendations of an adult (rehabilitation profile). */
export const ADULT_RECOMMENDATIONS_TITLE = 'Préconisations';

export const sectionTitle = (id: InitialSectionId | ReevaluationSectionId): string =>
  [...INITIAL_SECTIONS, ...REEVALUATION_SECTIONS].find((s) => s.id === id)!.title;
