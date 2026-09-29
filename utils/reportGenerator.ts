/**
 * reportGenerator.ts — the only way to call the AI: report generation and
 * style learning, with the transport injected.
 *
 * It takes the data of the assessment, builds the payload (`aiPayload.ts`),
 * anonymizes it as a whole (`createAnonymization`), calls the transport,
 * parses the answer and re-hydrates it. Callers never see an un-anonymized
 * payload. Transports: the edge function `generate` (`services/aiProxy.ts`),
 * the demo (`data/demoReport.ts`) and fakes in the tests.
 *
 * Initial report = 2 tasks sharing one credit: `report_bio` then
 * `report_diagnostic` (same generation session id). Re-evaluation = one task
 * (`report_reevaluation`), one credit. Style learning = `extract_style_feedback`, no credit.
 */

import type { ClinicalSynthesis, Observations, Patient, PatientAssessment, ReportSection, TestData } from '../types';
import { cleanAndParseJson } from './aiHelpers';
import { type InitialReportPayload, type ReevaluationPayload, buildInitialReportPayload, buildReevaluationPayload } from './aiPayload';
import { type Anonymization, createAnonymization } from './anonymizer';
import type { CatalogIndex } from './catalogIndex';
import { Logger } from './logger';
import { buildDeltaEntries } from './reevaluationHelpers';
import { htmlToPlainText, sectionToHtml, sectionToPlainText } from './reportContent';
import { ADULT_RECOMMENDATIONS_TITLE, type InitialSectionId, type ReevaluationSectionId, sectionTitle } from './reportSections';
import { findSuspectTerms } from './suspectTerms';
import { sanitizeReportText } from './textSanitizer';

// ─── Transport ──────────────────────────────────────────────────────────────

export type AITask = 'report_bio' | 'report_diagnostic' | 'extract_style_feedback' | 'report_reevaluation';

export interface AIRequest {
  task: AITask;
  payload: Record<string, unknown>;
  generationId?: string;
}

export interface AIAnswer {
  text: string | null;
  generationId?: string;
}

/** Sends one task. Errors are thrown as `Error(code)` (CREDIT_INSUFFICIENT, RATE_LIMITED…). */
export type AITransport = (request: AIRequest) => Promise<AIAnswer>;

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface InitialReportInput {
  patient: Patient;
  observations: Observations;
  tests: TestData;
  synthesis: ClinicalSynthesis;
  index: CatalogIndex;
  /** practitioners.ai_style_preferences */
  stylePreferences?: string;
}

export interface ReevaluationInput {
  patient: Patient;
  previousAssessment: PatientAssessment | null;
  tests: TestData;
  index: CatalogIndex;
  stylePreferences?: string;
}

export interface StyleLessonInput {
  patient: Patient;
  /** Sections of the finalized report. */
  sections: ReportSection[];
  index: CatalogIndex;
  existingPreferences?: string;
}

export interface InitialReportResult {
  sections: ReportSection[];
  /** subtestId → reformulated clinical observation (shown in the annexes). */
  reformulatedObservations: Record<string, string>;
}

// ─── Answers ────────────────────────────────────────────────────────────────

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

/**
 * Section ids known by the style-feedback schema (edge `extract_style_feedback`).
 * Re-evaluation recommendations share the rules of the initial ones; the other
 * re-evaluation sections have no dedicated slot and only feed the global rules.
 */
const STYLE_SECTION_ALIASES: Record<string, string> = { recommandations_reev: 'recommandations' };

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Patients aged 20 and more get the adult rehabilitation prompt. */
export const getAiProfile = (age: string): 'adult' | 'pediatric' => {
  const lower = age.toLowerCase();
  if (lower.includes('mois') && !lower.includes('an')) return 'pediatric';
  const years = parseInt(lower.match(/(\d+)/)?.[1] ?? '0', 10);
  return years >= 20 ? 'adult' : 'pediatric';
};

const NOT_GENERATED = 'Non généré.';

const makeSection = (
  id: InitialSectionId | ReevaluationSectionId,
  content: string,
  contentFormat: ReportSection['contentFormat'] = 'plain',
  title = sectionTitle(id),
): ReportSection => ({
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

// ─── Anonymized payloads (also used to list the suspect words) ──────────────

const initialRequest = (input: InitialReportInput, now: Date): { anonymization: Anonymization; payload: InitialReportPayload } => {
  const anonymization = createAnonymization(input.patient, now);
  const payload = anonymization.deep(
    buildInitialReportPayload({
      patient: input.patient,
      observations: input.observations,
      tests: input.tests,
      synthesis: input.synthesis,
      index: input.index,
    }),
  );
  return { anonymization, payload };
};

const reevaluationRequest = (input: ReevaluationInput, now: Date): { anonymization: Anonymization; payload: ReevaluationPayload } => {
  const anonymization = createAnonymization(input.patient, now);
  const previousTests = input.previousAssessment?.tests ?? {};
  const payload = anonymization.deep(
    buildReevaluationPayload({
      patient: input.patient,
      previousAssessment: input.previousAssessment,
      previousTests,
      newTests: input.tests,
      deltas: buildDeltaEntries(previousTests, input.tests, input.index),
      index: input.index,
      reevaluationDate: now,
    }),
  );
  return { anonymization, payload };
};

/** Words of the anonymized initial payload that may still identify someone (see suspectTerms.ts). */
export const findInitialSuspectTerms = (input: InitialReportInput, now = new Date()): string[] =>
  findSuspectTerms(initialRequest(input, now).payload, { index: input.index, allowed: input.patient.aiAllowedTerms });

export const findReevaluationSuspectTerms = (input: ReevaluationInput, now = new Date()): string[] =>
  findSuspectTerms(reevaluationRequest(input, now).payload, { index: input.index, allowed: input.patient.aiAllowedTerms });

// ─── Generator ──────────────────────────────────────────────────────────────

/**
 * Last "bio" answer whose diagnostic failed. The server keeps the generation
 * session reusable for 20 minutes (GENERATION_REUSE_WINDOW_MINUTES in the edge
 * function) and releases its lock on a diagnostic failure, so retrying the same
 * payload only replays the diagnostic, without a new credit.
 */
const BIO_REUSE_WINDOW_MS = 15 * 60 * 1000;

export const createReportGenerator = (transport: AITransport, options: { now?: () => Date } = {}) => {
  const now = options.now ?? (() => new Date());
  let pendingBio: { key: string; bio: BioResponse; generationId: string; at: number } | null = null;

  const generateInitial = async (input: InitialReportInput): Promise<InitialReportResult> => {
    const { patient, stylePreferences } = input;
    Logger.info('AI', 'Starting initial report generation', { patientId: patient.id });
    const { anonymization, payload } = initialRequest(input, now());
    const profile = getAiProfile(patient.age);
    const hydrate = (text: string | undefined) => sanitizeReportText(anonymization.hydrate(text || NOT_GENERATED));

    const bioPayload = {
      profile,
      childContext: payload.childContext,
      safeQuestionnaire: payload.questionnaire,
      styleDirectives: buildStyleBlock(stylePreferences, ['mandat_ref', 'mandat_eval', 'profil']),
    };
    const runDiagnostic = async (bio: BioResponse, generationId: string | undefined) => {
      const diagResponse = await transport({
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
      const bioResponse = await transport({ task: 'report_bio', payload: bioPayload });
      const bio = parseAnswer<BioResponse>(bioResponse.text, 'report_bio');
      try {
        return { bio, diag: await runDiagnostic(bio, bioResponse.generationId) };
      } catch (e) {
        // Keep the paid "bio" step: a retry resumes at the diagnostic (see pendingBio).
        if (bioResponse.generationId)
          pendingBio = { key: JSON.stringify(bioPayload), bio, generationId: bioResponse.generationId, at: Date.now() };
        throw e;
      }
    };

    const resumable =
      pendingBio && pendingBio.key === JSON.stringify(bioPayload) && Date.now() - pendingBio.at < BIO_REUSE_WINDOW_MS ? pendingBio : null;
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
        makeSection('mandat_ref', hydrate(bio.mandat_referencement)),
        makeSection('mandat_eval', hydrate(bio.mandat_evaluation)),
        makeSection('profil', hydrate(bio.profil_occupationnel)),
        makeSection('diagnostic', hydrate(diag.synthese_diagnostic)),
        makeSection('objectifs', hydrate(diag.objectifs_generaux)),
        makeSection('project', hydrate(diag.projet_accompagnement)),
        makeSection(
          'recommandations',
          hydrate(diag.recommandations),
          'plain',
          profile === 'adult' ? ADULT_RECOMMENDATIONS_TITLE : undefined,
        ),
      ],
    };
  };

  /** The re-evaluation answer is HTML: injected patient values are escaped. */
  const generateReevaluation = async (input: ReevaluationInput): Promise<ReportSection[]> => {
    Logger.info('AI', 'Starting re-evaluation generation', { patientId: input.patient.id });
    const { anonymization, payload } = reevaluationRequest(input, now());
    const response = await transport({
      task: 'report_reevaluation',
      payload: {
        ...payload,
        profile: getAiProfile(input.patient.age),
        // Only the recommendations have section-specific rules shared with the initial report.
        styleDirectives: buildStyleBlock(input.stylePreferences, ['recommandations']),
      },
    });
    const json = parseAnswer<ReevaluationResponse>(response.text, 'report_reevaluation');
    const hydrate = (text: string | undefined) => sanitizeReportText(anonymization.hydrate(text || NOT_GENERATED, { asHtml: true }));

    return [
      makeSection('resume_initial', hydrate(json.resume_initial), 'html'),
      makeSection('evolution', hydrate(json.evolution_commentee), 'html'),
      makeSection('conclusion', hydrate(json.conclusion), 'html'),
      makeSection('recommandations_reev', hydrate(json.recommandations), 'html'),
    ];
  };

  /**
   * Learn from the practitioner's corrections of the AI sections. A correction
   * that still holds a suspect word is not sent (no confirmation is possible at
   * this point). Returns false when nothing was sent.
   */
  const learnStyle = async (input: StyleLessonInput): Promise<boolean> => {
    const anonymization = createAnonymization(input.patient, now());
    const diffs = input.sections
      .filter((s) => s.isAiGenerated && s.originalContent)
      .map((s) => ({ s, original: htmlToPlainText(s.originalContent!), corrected: sectionToPlainText(s) }))
      .filter(({ original, corrected }) => original !== corrected)
      .map(({ s, original, corrected }) => anonymization.deep({ sectionId: STYLE_SECTION_ALIASES[s.id] ?? s.id, original, corrected }))
      .filter((diff) => {
        const suspects = findSuspectTerms(diff, { index: input.index, allowed: input.patient.aiAllowedTerms });
        if (suspects.length > 0)
          Logger.info('AI', 'Style correction not sent: it holds suspect words', { sectionId: diff.sectionId, count: suspects.length });
        return suspects.length === 0;
      });
    if (diffs.length === 0) return false;
    await transport({ task: 'extract_style_feedback', payload: { diffs, existingPreferences: input.existingPreferences || '' } });
    return true;
  };

  return { generateInitial, generateReevaluation, learnStyle };
};

export type ReportGenerator = ReturnType<typeof createReportGenerator>;

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
