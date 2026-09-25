/**
 * ai.ts — report generation through the `generate` edge function.
 *
 * Callers pass an already pseudonymized payload (see `anonymizeDeep`); this
 * module calls the edge tasks, parses the JSON answers and re-hydrates the
 * placeholders with the real patient values.
 *
 * Initial report = 2 edge calls sharing one credit: `report_bio` then
 * `report_diagnostic` (same generation session id). Re-evaluation = one call
 * (`report_reevaluation`), one credit.
 */

import { callAIProxyTask } from './aiProxy';
import { cleanAndParseJson } from '../utils/aiHelpers';
import type { ClinicalSynthesis, Patient, ReportSection } from '../types';
import { hydrateReport } from '../utils/anonymizer';
import { sanitizeReportText } from '../utils/textSanitizer';
import { sectionToHtml } from '../utils/reportContent';
import { Logger } from '../utils/logger';

interface BioResponse {
  mandat_referencement?: string;
  mandat_evaluation?: string;
  profil_occupationnel?: string;
}

interface DiagResponse {
  synthese_diagnostic?: string;
  projet_accompagnement?: string;
  recommandations?: string;
  objectifs_generaux?: string;
  reformulated_observations?: Array<{ subtestId: string; text: string }>;
}

interface ReevaluationResponse {
  resume_initial?: string;
  evolution_commentee?: string;
  recommandations?: string;
  conclusion?: string;
}

// ─── Style preferences (practitioners.ai_style_preferences) ─────────────────

interface StylePrefs {
  global: string;
  sections: Partial<Record<string, string>>;
}

const parseStylePrefs = (raw: string | undefined): StylePrefs => {
  if (!raw) return { global: '', sections: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      global: String(parsed?.global || '').trim(),
      sections: parsed?.sections && typeof parsed.sections === 'object' ? parsed.sections : {},
    };
  } catch {
    return { global: raw.trim(), sections: {} }; // legacy plain string
  }
};

/** Global rules + the rules of the given sections, as the text block injected in the prompt. */
const buildStyleBlock = (raw: string | undefined, sectionIds: string[]): string | undefined => {
  const prefs = parseStylePrefs(raw);
  const parts = [prefs.global, ...sectionIds.map((id) => prefs.sections[id])].filter((p): p is string => Boolean(p?.trim()));
  return parts.length > 0 ? parts.join('\n') : undefined;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Patients aged 20 and more get the adult rehabilitation prompt. */
export const getAiProfile = (age: string): 'adult' | 'pediatric' => {
  const lower = age.toLowerCase();
  if (lower.includes('mois') && !lower.includes('an')) return 'pediatric';
  const years = parseInt(lower.match(/(\d+)/)?.[1] ?? '0', 10);
  return years >= 20 ? 'adult' : 'pediatric';
};

const NOT_GENERATED = 'Non généré.';

/**
 * Last "bio" answer whose diagnostic failed. The server keeps the generation
 * session reusable for 20 minutes (GENERATION_REUSE_WINDOW_MINUTES in the edge
 * function) and releases its lock on a diagnostic failure, so retrying the same
 * payload only replays the diagnostic, without a new credit.
 */
const BIO_REUSE_WINDOW_MS = 15 * 60 * 1000;
let pendingBio: { key: string; bio: BioResponse; generationId: string; at: number } | null = null;

const makeSection = (id: string, title: string, content: string, contentFormat: ReportSection['contentFormat'] = 'plain'): ReportSection => ({
  id,
  title,
  content,
  originalContent: sectionToHtml({ content, contentFormat }),
  contentFormat,
  status: 'draft',
  isAiGenerated: true,
});

/** Parse a task answer; an empty or unparseable answer is an error (never a silent "Non généré." report). */
const parseAnswer = <T extends object>(text: string | null, task: string): T => {
  const parsed = cleanAndParseJson(text ?? undefined);
  if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
    Logger.error('AI', `Empty or invalid answer for ${task}`);
    throw new Error('AI_EMPTY_RESPONSE');
  }
  return parsed as T;
};

// ─── Public API ─────────────────────────────────────────────────────────────

/** Pseudonymized inputs of an initial report. */
export interface InitialReportPayload {
  questionnaire: string;
  observations: string;
  scoresEvidence: unknown;
  childContext: string;
  synthesis: ClinicalSynthesis;
}

export interface InitialReportResult {
  sections: ReportSection[];
  /** subtestId → reformulated clinical observation (shown in the annexes). */
  reformulatedObservations: Record<string, string>;
}

/** Pseudonymized inputs of a re-evaluation. */
export interface ReevaluationPayload {
  childContext: string;
  previousScoresSummary: string;
  newScoresSummary: string;
  evolutionSummary: string;
  previousReportContext?: string;
}

export const AIService = {
  generateInitialReport: async (payload: InitialReportPayload, patient: Patient, stylePreferences?: string): Promise<InitialReportResult> => {
    Logger.info('AI', 'Starting initial report generation', { patientId: patient.id });
    const profile = getAiProfile(patient.age);
    const hydrate = (text: string | undefined) => sanitizeReportText(hydrateReport(text || NOT_GENERATED, patient));

    const bioPayload = {
      profile,
      childContext: payload.childContext,
      safeQuestionnaire: payload.questionnaire,
      styleDirectives: buildStyleBlock(stylePreferences, ['mandat_ref', 'mandat_eval', 'profil']),
    };
    const runDiagnostic = async (bio: BioResponse, generationId: string | undefined) => {
      const diagResponse = await callAIProxyTask({
        task: 'report_diagnostic',
        payload: {
          profile,
          childContext: payload.childContext,
          profilContext: bio.profil_occupationnel || 'Non disponible',
          safeObservations: payload.observations,
          scoresEvidence: payload.scoresEvidence,
          synthesis: payload.synthesis,
          styleDirectives: buildStyleBlock(stylePreferences, ['diagnostic', 'objectifs', 'project', 'recommandations']),
        },
        generationId,
      });
      return parseAnswer<DiagResponse>(diagResponse.text, 'report_diagnostic');
    };
    const runFromBio = async () => {
      const bioResponse = await callAIProxyTask({ task: 'report_bio', payload: bioPayload });
      const bio = parseAnswer<BioResponse>(bioResponse.text, 'report_bio');
      try {
        return { bio, diag: await runDiagnostic(bio, bioResponse.generationId) };
      } catch (e) {
        // Keep the paid "bio" step: a retry resumes at the diagnostic (see pendingBio).
        if (bioResponse.generationId) pendingBio = { key: JSON.stringify(bioPayload), bio, generationId: bioResponse.generationId, at: Date.now() };
        throw e;
      }
    };

    const resumable = pendingBio && pendingBio.key === JSON.stringify(bioPayload) && Date.now() - pendingBio.at < BIO_REUSE_WINDOW_MS ? pendingBio : null;
    pendingBio = null;
    let result: { bio: BioResponse; diag: DiagResponse };
    if (resumable) {
      Logger.info('AI', 'Resuming the initial report at the diagnostic step (same generation session)');
      try {
        result = { bio: resumable.bio, diag: await runDiagnostic(resumable.bio, resumable.generationId) };
      } catch (e) {
        if (!(e instanceof Error && e.message === 'INVALID_GENERATION_SESSION')) {
          pendingBio = { ...resumable };
          throw e;
        }
        result = await runFromBio(); // the session expired server-side: start over once
      }
    } else {
      result = await runFromBio();
    }
    const { bio, diag } = result;

    const reformulatedObservations: Record<string, string> = {};
    for (const entry of diag.reformulated_observations ?? []) {
      if (entry?.subtestId && entry?.text) reformulatedObservations[entry.subtestId] = hydrate(entry.text);
    }

    return {
      reformulatedObservations,
      sections: [
        makeSection('mandat_ref', 'Mandat de référencement en ergothérapie', hydrate(bio.mandat_referencement)),
        makeSection('mandat_eval', "Mandat d'évaluation en ergothérapie", hydrate(bio.mandat_evaluation)),
        makeSection('profil', 'Profil occupationnel', hydrate(bio.profil_occupationnel)),
        makeSection('diagnostic', 'Diagnostic en ergothérapie', hydrate(diag.synthese_diagnostic)),
        makeSection('objectifs', 'Les objectifs généraux', hydrate(diag.objectifs_generaux)),
        makeSection('project', "Projet d'accompagnement", hydrate(diag.projet_accompagnement)),
        makeSection('recommandations', profile === 'adult' ? 'Préconisations' : 'Recommandations', hydrate(diag.recommandations)),
      ],
    };
  },

  /** The re-evaluation answer is HTML: injected patient values are escaped. */
  generateReevaluation: async (payload: ReevaluationPayload, patient: Patient, stylePreferences?: string): Promise<ReportSection[]> => {
    Logger.info('AI', 'Starting re-evaluation generation', { patientId: patient.id });
    const response = await callAIProxyTask({
      task: 'report_reevaluation',
      payload: {
        ...payload,
        profile: getAiProfile(patient.age),
        // Only the recommendations have section-specific rules shared with the initial report.
        styleDirectives: buildStyleBlock(stylePreferences, ['recommandations']),
      },
    });
    const json = parseAnswer<ReevaluationResponse>(response.text, 'report_reevaluation');
    const hydrate = (text: string | undefined) => sanitizeReportText(hydrateReport(text || NOT_GENERATED, patient, { asHtml: true }));

    return [
      makeSection('resume_initial', 'Rappel du bilan initial', hydrate(json.resume_initial), 'html'),
      makeSection('evolution', 'Évolution des résultats', hydrate(json.evolution_commentee), 'html'),
      makeSection('conclusion', 'Conclusion', hydrate(json.conclusion), 'html'),
      makeSection('recommandations_reev', 'Préconisations', hydrate(json.recommandations), 'html'),
    ];
  },
};

/**
 * User-facing message for a generation error, or 'CREDIT_INSUFFICIENT' when
 * the caller must open the paywall instead of showing a message.
 */
export const describeGenerationError = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  if (msg === 'CREDIT_INSUFFICIENT') return 'CREDIT_INSUFFICIENT';
  if (msg === 'RATE_LIMITED') return 'Trop de requêtes. Réessayez dans quelques minutes.';
  if (msg === 'SESSION_EXPIRED') return 'Session expirée. Veuillez vous reconnecter.';
  if (msg === 'TIMEOUT_AI') return 'Le serveur IA ne répond pas. Réessayez dans quelques instants.';
  if (msg === 'GENERATION_SESSION_BUSY') return 'Une génération est déjà en cours. Attendez quelques instants, puis réessayez.';
  if (msg === 'AI_EMPTY_RESPONSE') return "L'IA n'a pas renvoyé de contenu exploitable. Réessayez dans quelques instants.";
  if (msg === 'INVALID_GENERATION_SESSION' || msg === 'MISSING_GENERATION_SESSION')
    return 'La session de génération a expiré. Relancez la génération.';
  return msg || 'Erreur inconnue.';
};
