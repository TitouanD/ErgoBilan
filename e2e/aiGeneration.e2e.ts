/**
 * End-to-end test of the AI generation: fictional demo record → payload →
 * anonymization → transport → answer → re-hydration → report sections.
 * See docs/AI_PIPELINE.md §9 for the rules (cost, scope, when to run it).
 *
 *   npm run e2e:ai                          dry run: demo transport, no network, free
 *   E2E_AI_LIVE=1 npm run e2e:ai            live: production edge `generate` + Gemini (PAID)
 *   E2E_AI=reevaluation|style|all|a,b ...   flows (default: initial)
 *
 * Every request is checked before it leaves: no identifier of the fictional
 * patient in it, else the run stops before the paid call. Each step is written
 * to `.e2e-trace/` (ignored by git).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_CATALOG } from '../data/demoCatalog';
import { DEMO_PATIENTS } from '../data/demoData';
import { createDemoTransport } from '../data/demoReport';
import type { Patient, PatientAssessment, ReportSection } from '../types';
import { initialPatient } from '../utils/assessmentInProgress';
import { buildCatalogIndex } from '../utils/catalogIndex';
import {
  type AIAnswer,
  type AIRequest,
  type AITransport,
  type InitialReportInput,
  type ReevaluationInput,
  createReportGenerator,
  findInitialSuspectTerms,
  findReevaluationSuspectTerms,
} from '../utils/reportGenerator';
import { type EdgeExchange, installEdgeFetch, signInTestAccount } from './liveEdge';

// ─── Run settings ───────────────────────────────────────────────────────────

type Flow = 'initial' | 'reevaluation' | 'style';
/** Paid edge calls of each flow; the fetch wrapper refuses any call beyond their sum. */
const CALLS: Record<Flow, number> = { initial: 2, reevaluation: 1, style: 1 };
const MAX_CALLS = 4;

const parseFlows = (raw: string | undefined): Flow[] => {
  const words = (raw || 'initial').split(/[,\s]+/).filter(Boolean);
  const flows = words.includes('all') ? (Object.keys(CALLS) as Flow[]) : (words as Flow[]);
  const unknown = flows.filter((f) => !(f in CALLS));
  if (unknown.length > 0) throw new Error(`E2E_AI : parcours inconnu(s) ${unknown.join(', ')} (initial, reevaluation, style, all)`);
  return [...new Set(flows)];
};

const FLOWS = parseFlows(process.env.E2E_AI);
const LIVE = process.env.E2E_AI_LIVE === '1';
const PLANNED_CALLS = Math.min(
  MAX_CALLS,
  FLOWS.reduce((sum, f) => sum + CALLS[f], 0),
);
const TRACE_DIR = resolve('.e2e-trace', `${new Date().toISOString().replace(/[:.]/g, '-')}-${LIVE ? 'live' : 'dry'}`);

// ─── Fictional records (demo data) ──────────────────────────────────────────

const index = buildCatalogIndex(DEMO_CATALOG);

const elya = (): InitialReportInput => ({
  patient: { ...initialPatient, ...DEMO_PATIENTS.ELYA.patient, id: 'demo-elya' },
  observations: DEMO_PATIENTS.ELYA.observations,
  tests: DEMO_PATIENTS.ELYA.tests,
  synthesis: { diagnosticInput: 'Fragilité de la motricité fine.', projectInput: '', recommendationsInput: '' },
  index,
});

const sarahInitial = DEMO_PATIENTS.SARAH.reports[0];
const sarah = (): ReevaluationInput => ({
  patient: { ...initialPatient, ...DEMO_PATIENTS.SARAH.patient, id: 'demo-sarah' },
  previousAssessment: {
    id: sarahInitial.id,
    date: '2026-03-30T10:00:00.000Z',
    kind: 'initial',
    hasFormalReport: true,
    testName: 'Bilan initial',
    tests: sarahInitial.tests,
    report: { status: 'completed', patientName: sarahInitial.patientName, sections: sarahInitial.sections as ReportSection[] },
  } as PatientAssessment,
  tests: DEMO_PATIENTS.SARAH.reports[1].tests,
  index,
});

/** One corrected AI section, without any name: learnStyle sends it. */
const STYLE_SECTIONS: ReportSection[] = [
  {
    id: 'recommandations',
    title: 'Recommandations',
    content: "Poursuivre la rééducation en ergothérapie à raison d'une séance hebdomadaire.",
    originalContent: '<p>Poursuivre la rééducation une fois par semaine.</p>',
    contentFormat: 'plain',
    status: 'validated',
    isAiGenerated: true,
  },
];

// ─── Checks ─────────────────────────────────────────────────────────────────

const TITLES = new Set(['mme', 'mlle', 'madame', 'monsieur', 'dr', 'docteur', 'pr', 'professeur']);

const strings = (values: unknown[]): string[] => values.flatMap((v) => (typeof v === 'string' && v.trim().length >= 2 ? [v.trim()] : []));

/**
 * Identifying values of the patient file, listed here independently of
 * utils/anonymizer.ts: none may appear in a request (whole word). Whole values
 * are searched in any case; the capitalized words of the name fields
 * ("Ravel" in "Mme Ravel") are searched as written.
 */
const identifiers = (p: Patient): Array<{ value: string; anyCase: boolean }> => {
  const names = strings([
    p.firstName,
    p.lastName,
    p.parentNames,
    p.parent1Name,
    p.parent2Name,
    p.teacher,
    p.prescribingDoctor,
    p.treatingDoctor,
  ]);
  const whole = strings([
    ...names,
    p.dob,
    p.address,
    p.parent1Address,
    p.parent2Address,
    p.parentPhone,
    p.parent1Phone,
    p.parent2Phone,
    p.parentEmail,
    p.parent1Email,
    p.parent2Email,
    p.school,
    ...(p.siblings ?? []).map((s) => s.firstName),
    ...(p.medicalTracking ?? []).map((t) => t.contact),
  ]);
  const words = names
    .flatMap((v) => v.split(/[\s,;/&.]+/))
    .filter((w) => w.length >= 3 && /^\p{Lu}\p{Ll}/u.test(w) && !TITLES.has(w.toLowerCase()));
  return [...whole.map((value) => ({ value, anyCase: true })), ...words.map((value) => ({ value, anyCase: false }))];
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findLeaks = (request: AIRequest, patient: Patient): string[] => {
  const sent = JSON.stringify(request.payload);
  const found = identifiers(patient).filter(({ value, anyCase }) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`, anyCase ? 'iu' : 'u').test(sent),
  );
  return [...new Set(found.map((f) => f.value))];
};

const NOT_GENERATED = 'Non généré.';
const HTML_ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z]{2,8});/i;

/** `firstName`: expected in the report (initial report); the re-evaluation prompt forbids the name. */
const expectHydratedSections = (sections: ReportSection[], ids: string[], firstName?: string) => {
  expect(sections.map((s) => s.id)).toEqual(ids);
  for (const s of sections) {
    expect(s.content.trim(), `section ${s.id} vide`).not.toBe('');
    expect(s.content, `section ${s.id} non générée`).not.toContain(NOT_GENERATED);
    expect(s.content, `marqueur restant dans ${s.id}`).not.toMatch(/\{\{|\}\}/);
    // A plain section is escaped when rendered: an entity would show as is (#74).
    if (s.contentFormat === 'plain') expect(s.content, `entité HTML dans ${s.id}`).not.toMatch(HTML_ENTITY);
  }
  if (!firstName) return;
  expect(
    sections.some((s) => s.content.includes(firstName)),
    `prénom ${firstName} absent du rapport réhydraté`,
  ).toBe(true);
};

// ─── Transport and trace ────────────────────────────────────────────────────

interface Step {
  request: AIRequest;
  answer?: AIAnswer;
  error?: string;
}

/** Wrap the transport: check each request before it leaves, record request and answer. */
const recorder = (inner: AITransport, patient: Patient) => {
  const steps: Step[] = [];
  const transport: AITransport = async (request) => {
    const step: Step = { request };
    steps.push(step);
    const leaks = findLeaks(request, patient);
    if (leaks.length > 0) {
      step.error = `PII_LEAK: ${leaks.join(', ')}`;
      throw new Error(step.error); // before the network: no paid call
    }
    try {
      step.answer = await inner(request);
      return step.answer;
    } catch (e) {
      step.error = e instanceof Error ? e.message : String(e);
      throw e;
    }
  };
  return { transport, steps };
};

const parseIfJson = (text: string | null | undefined): unknown => {
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const writeTrace = (flow: Flow, steps: Step[], result: unknown) => {
  const dir = join(TRACE_DIR, flow);
  mkdirSync(dir, { recursive: true });
  steps.forEach((step, i) => {
    const prefix = `${String(i + 1).padStart(2, '0')}-${step.request.task}`;
    writeFileSync(join(dir, `${prefix}.1-requete-pseudonymisee.json`), JSON.stringify(step.request, null, 2));
    writeFileSync(
      join(dir, `${prefix}.2-reponse.json`),
      JSON.stringify({ error: step.error, generationId: step.answer?.generationId, text: parseIfJson(step.answer?.text) }, null, 2),
    );
  });
  writeFileSync(join(dir, '3-rapport-rehydrate.json'), JSON.stringify(result, null, 2));
};

// ─── Run ────────────────────────────────────────────────────────────────────

let edge: { exchanges: EdgeExchange[]; restore: () => void } | null = null;
let account: Awaited<ReturnType<typeof signInTestAccount>> | null = null;
let liveTransport: AITransport | null = null;
const summary: Record<string, unknown> = { mode: LIVE ? 'live' : 'dry', flows: FLOWS, plannedCalls: PLANNED_CALLS };

const makeTransport = (): AITransport => liveTransport ?? createDemoTransport(0);

beforeAll(async () => {
  mkdirSync(TRACE_DIR, { recursive: true });
  console.info(
    [
      `\n[e2e:ai] mode ${LIVE ? 'RÉEL (edge de production + Gemini PAYANT)' : 'à blanc (transport démo, aucun appel réseau)'}`,
      `[e2e:ai] parcours : ${FLOWS.join(', ')} ; appels payants ${LIVE ? '' : 'qui seraient '}envoyés : ${PLANNED_CALLS}`,
      LIVE
        ? '[e2e:ai] Coût MINIME : une exécution réelle quand tout est vert (check, tests, mode à blanc). Jamais en boucle pour déboguer.'
        : '',
      `[e2e:ai] trace : ${TRACE_DIR}\n`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (!LIVE) return;

  edge = installEdgeFetch(PLANNED_CALLS);
  account = await signInTestAccount();
  const row = await account.readAccount();
  if (row.is_admin) throw new Error(`${account.email} est admin : l'e2e tourne uniquement avec le compte de test dédié (§9).`);
  summary.account = account.email;
  summary.creditsBefore = row.credits;
  const { callAIProxyTask } = await import('../services/aiProxy');
  liveTransport = callAIProxyTask;
});

afterAll(async () => {
  if (account) summary.creditsAfter = (await account.readAccount()).credits;
  if (edge) {
    summary.edgeCalls = edge.exchanges.length;
    writeFileSync(
      join(TRACE_DIR, 'http-edge.json'),
      JSON.stringify(
        edge.exchanges.map((x) => ({ status: x.status, body: parseIfJson(x.body) })),
        null,
        2,
      ),
    );
  }
  writeFileSync(join(TRACE_DIR, 'resume.json'), JSON.stringify(summary, null, 2));
  console.info(`[e2e:ai] ${JSON.stringify(summary)}`);
  await account?.close();
  edge?.restore();
});

/** Credits after a flow: debited once for a report, never for style learning (non-admin account). */
const expectCreditDelta = async (before: number | undefined, delta: number) => {
  if (!account || before === undefined) return;
  expect((await account.readAccount()).credits).toBe(before + delta);
};

describe(`génération IA de bout en bout (${LIVE ? 'réel' : 'à blanc'})`, () => {
  it('le contrôle de fuite repère les identifiants non pseudonymisés, pas les titres ni les mots courants', () => {
    const { patient } = elya();
    const request: AIRequest = {
      task: 'report_bio',
      payload: { text: `Elya RAVEL, suivie par Mme Leroux et le Dr. Giraud à l'école ; sa mère, Mme Ravel.` },
    };
    expect(findLeaks(request, patient)).toEqual(expect.arrayContaining(['Elya', 'RAVEL', 'Mme Leroux', 'Leroux', 'Giraud', 'Ravel']));
    expect(findLeaks({ task: 'report_bio', payload: { text: "Mme {{ENSEIGNANT}} signale à l'école une lenteur." } }, patient)).toEqual([]);
  });

  it.runIf(FLOWS.includes('initial'))('bilan initial : bio puis diagnostic sur la même session, un crédit', async () => {
    const input = elya();
    expect(findInitialSuspectTerms(input)).toEqual([]);
    const before = account ? (await account.readAccount()).credits : undefined;
    const { transport, steps } = recorder(makeTransport(), input.patient);

    let report: Awaited<ReturnType<ReturnType<typeof createReportGenerator>['generateInitial']>> | undefined;
    try {
      report = await createReportGenerator(transport).generateInitial(input);
    } finally {
      writeTrace('initial', steps, report ?? null);
    }

    expect(steps.map((s) => s.request.task)).toEqual(['report_bio', 'report_diagnostic']);
    if (LIVE) {
      expect(steps[0].answer?.generationId).toBeTruthy();
      expect(steps[1].request.generationId).toBe(steps[0].answer?.generationId);
    }
    expectHydratedSections(
      report.sections,
      ['mandat_ref', 'mandat_eval', 'profil', 'diagnostic', 'objectifs', 'project', 'recommandations'],
      input.patient.firstName,
    );
    for (const [id, text] of Object.entries(report.reformulatedObservations))
      expect(text, `entité HTML dans l'observation ${id}`).not.toMatch(HTML_ENTITY);
    await expectCreditDelta(before, -1);
  });

  it.runIf(FLOWS.includes('reevaluation'))('réévaluation : une tâche HTML, un crédit', async () => {
    const input = sarah();
    expect(findReevaluationSuspectTerms(input)).toEqual([]);
    const before = account ? (await account.readAccount()).credits : undefined;
    const { transport, steps } = recorder(makeTransport(), input.patient);

    let sections: ReportSection[] | undefined;
    try {
      sections = await createReportGenerator(transport).generateReevaluation(input);
    } finally {
      writeTrace('reevaluation', steps, sections ?? null);
    }

    expect(steps.map((s) => s.request.task)).toEqual(['report_reevaluation']);
    // The initial report sections leave as context: without them the "Rappel" is written from the scores alone.
    expect(steps[0].request.payload.previousReportContext, 'contexte du bilan initial absent').toMatch(/dysgraphie/);
    expectHydratedSections(sections, ['resume_initial', 'evolution', 'conclusion', 'recommandations_reev']);
    await expectCreditDelta(before, -1);
  });

  it.runIf(FLOWS.includes('style'))('apprentissage du style : une correction envoyée, aucun crédit', async () => {
    const patient: Patient = { ...initialPatient, ...DEMO_PATIENTS.SARAH.patient, id: 'demo-sarah' };
    const row = account ? await account.readAccount() : undefined;
    const { transport, steps } = recorder(makeTransport(), patient);

    let sent: boolean | undefined;
    try {
      sent = await createReportGenerator(transport).learnStyle({
        patient,
        sections: STYLE_SECTIONS,
        index,
        existingPreferences: row?.ai_style_preferences ?? '',
      });
    } finally {
      writeTrace('style', steps, { sent });
    }

    expect(sent).toBe(true);
    expect(steps.map((s) => s.request.task)).toEqual(['extract_style_feedback']);
    if (account && row) {
      const after = await account.readAccount();
      expect(after.credits).toBe(row.credits);
      expect(after.ai_style_preferences).toBeTruthy();
    }
  });
});
