/**
 * scenarios.ts — dev scenarios: open a given screen in one URL, with
 * fictitious patients written in the local database (IndexedDB) of the
 * signed-in account. Development only (`npm run dev`), see docs/VERIFICATION.md.
 *
 *   /?scenario=dashboard                      every patient status
 *   /?scenario=initial&etape=2                initial assessment at step 2
 *   /?scenario=reeval&etape=1                 re-evaluation (its reference is created)
 *   /?scenario=historique&etape=2             historical assessment
 *   /?scenario=abonnement                     dashboard with the « Votre abonnement » modal
 *   &patient=<profile>  &tests=bhk,mabc-2|tout  &scores=vide
 *   /?scenario=dashboard&questionnaires=oui   plus parent questionnaires (dev/fictiveQuestionnaires.ts)
 *   &modale=abonnement|paywall|cgv             open the pricing modal (or the terms of sale) on top
 *   &vente=fermee                              pricing modal as in production while Stripe is in test mode (#110)
 *   /?scenario=accueil[&essai=refuse]         welcome screen after sign-up, last step (trial granted or denied, #113)
 *
 * The data goes through the app's own paths: the patient record, the finalized
 * assessments and the draft are written with StorageService, then the app
 * resumes the draft as when the practitioner clicks « Reprendre ». Report
 * sections come from the report generator with the demo transport: no AI call.
 */

import type { PatientAssessment, Patient, ReportSection, TestData } from '../types';
import { buildAssessmentRecord } from '../utils/assessment';
import { buildDraft, initialAssessmentState, type AssessmentState, type ReportType } from '../utils/assessmentInProgress';
import type { CatalogIndex } from '../utils/catalogIndex';
import { reminderDueAt } from '../utils/patientStatus';
import { getPatientAgeForIdentity } from '../utils/patient';
import type { ReportGenerator } from '../utils/reportGenerator';
import { FICTIVE_PROFILES, getFictiveProfile, isFictivePatient, type FictiveProfile } from './fictivePatients';
import { buildFictiveTests, parseTestsParam, type ScoreFill } from './fictiveScores';
import type { StorageService } from '../services/storage';

export type ScenarioName = 'dashboard' | 'initial' | 'reeval' | 'historique';
/** Modal opened on top of the scenario screen (`&modale=`): the pricing modal (plans or paywall) or the terms of sale. */
export type ScenarioModal = 'plans' | 'paywall' | 'cgv';
const MODALS: Record<string, ScenarioModal> = { abonnement: 'plans', paywall: 'paywall', cgv: 'cgv' };
/** Welcome screen after sign-up (`scenario=accueil`), opened at its last step, with the trial granted or denied (#113). */
export type ScenarioWelcome = { trialDenied: boolean };

export interface Scenario {
  name: ScenarioName;
  step: number;
  profile: FictiveProfile;
  /** Raw `tests` parameter (null: the profile's tests). */
  tests: string | null;
  fill: ScoreFill;
  /** Dashboard: show fictitious parent questionnaires (`questionnaires=oui`), kept in memory only. */
  questionnaires: boolean;
  modal: ScenarioModal | null;
  /** Pricing modal shown as in production while online payment is not open (`vente=fermee`, #110). */
  paymentClosed: boolean;
  welcome: ScenarioWelcome | null;
}

/** Steps of each flow (components/assessment/shared/AssessmentStepper.tsx). */
const STEP_COUNT: Record<Exclude<ScenarioName, 'dashboard'>, number> = { initial: 5, reeval: 4, historique: 3 };
const DEFAULTS: Record<ScenarioName, { step: number; profile: string }> = {
  dashboard: { step: 0, profile: 'leo' },
  initial: { step: 2, profile: 'leo' },
  reeval: { step: 1, profile: 'lina' },
  historique: { step: 2, profile: 'ines' },
};
/** Shortcut names, e.g. `scenario=initial-scores`. */
const ALIASES: Record<string, { name: ScenarioName; step: number; modal?: ScenarioModal; welcome?: true }> = {
  abonnement: { name: 'dashboard', step: 0, modal: 'plans' },
  accueil: { name: 'dashboard', step: 0, welcome: true },
  'initial-dossier': { name: 'initial', step: 1 },
  'initial-scores': { name: 'initial', step: 2 },
  'initial-diagnostic': { name: 'initial', step: 3 },
  'initial-validation': { name: 'initial', step: 4 },
  'initial-visualisation': { name: 'initial', step: 5 },
  'reeval-scores': { name: 'reeval', step: 1 },
  'reeval-evolution': { name: 'reeval', step: 2 },
  'reeval-validation': { name: 'reeval', step: 3 },
  'reeval-export': { name: 'reeval', step: 4 },
};

export type ParsedScenario = { ok: true; scenario: Scenario } | { ok: false; error: string } | null;

/** The scenario asked by the URL query, or null when there is none. */
export const parseScenario = (search: string): ParsedScenario => {
  const params = new URLSearchParams(search);
  const raw = params.get('scenario')?.trim();
  if (!raw) return null;
  const alias = ALIASES[raw];
  const name = (alias?.name ?? raw) as ScenarioName;
  if (!(name in DEFAULTS)) return { ok: false, error: `Scénario inconnu : ${raw} (dashboard, initial, reeval, historique)` };

  const stepParam = params.get('etape');
  const step = stepParam ? Number(stepParam) : (alias?.step ?? DEFAULTS[name].step);
  if (name !== 'dashboard' && (!Number.isInteger(step) || step < 1 || step > STEP_COUNT[name])) {
    return { ok: false, error: `Étape ${stepParam} invalide pour ${name} (1 à ${STEP_COUNT[name]})` };
  }
  const profileId = params.get('patient') ?? DEFAULTS[name].profile;
  const profile = getFictiveProfile(profileId);
  if (!profile) return { ok: false, error: `Patient fictif inconnu : ${profileId} (${FICTIVE_PROFILES.map((p) => p.id).join(', ')})` };
  const modalParam = params.get('modale');
  const modal = modalParam ? MODALS[modalParam] : (alias?.modal ?? null);
  if (modal === undefined) return { ok: false, error: `Modale inconnue : ${modalParam} (${Object.keys(MODALS).join(', ')})` };

  return {
    ok: true,
    scenario: {
      name,
      step,
      profile,
      tests: params.get('tests'),
      fill: params.get('scores') === 'vide' ? 'vide' : 'zones',
      questionnaires: params.get('questionnaires') === 'oui',
      modal,
      paymentClosed: params.get('vente') === 'fermee',
      welcome: alias?.welcome ? { trialDenied: params.get('essai') === 'refuse' } : null,
    },
  };
};

export type ScenarioStore = Pick<
  typeof StorageService,
  'createPatient' | 'saveDraft' | 'addAssessment' | 'upsertPatientFollowup' | 'loadPatientListPage' | 'deleteFile'
>;

export interface ScenarioDeps {
  store: ScenarioStore;
  index: CatalogIndex;
  /** Report generator with the demo transport (no AI call). */
  generator: Pick<ReportGenerator, 'generateInitial' | 'generateReevaluation'>;
  now: Date;
}

export interface ScenarioResult {
  /** Patient whose draft the app resumes; null = stay on the dashboard. */
  open: string | null;
  /** Tests or subtests of the profiles absent from the loaded catalogue. */
  missing: string[];
}

const monthsAgo = (now: Date, months: number): string => {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
};

const SYNTHESIS = {
  diagnosticInput: 'Difficultés graphomotrices avec un retentissement scolaire. Coordination fragile.',
  projectInput: 'Séances hebdomadaires de rééducation graphomotrice pendant 6 mois.',
  recommendationsInput: 'Temps majoré, réduction de la copie, ordinateur à envisager.',
};

/** Delete every fictitious patient (or only those of the given first names). Returns the count. */
export const purgeFictivePatients = async (store: Pick<ScenarioStore, 'loadPatientListPage' | 'deleteFile'>, firstNames?: string[]) => {
  const { files } = await store.loadPatientListPage({ limit: 100_000 });
  const targets = files.filter((f) => isFictivePatient(f.patient) && (!firstNames || firstNames.includes(f.patient.firstName)));
  for (const f of targets) await store.deleteFile(f.id);
  return targets.length;
};

export const runScenario = async (scenario: Scenario, deps: ScenarioDeps): Promise<ScenarioResult> => {
  const { store, index, generator, now } = deps;
  const missing = new Set<string>();

  const scoresOf = (profile: FictiveProfile, options: { fill?: ScoreFill; shift?: number; tests?: string | null } = {}): TestData => {
    const wanted = parseTestsParam(options.tests ?? null, index) ?? profile.tests;
    const result = buildFictiveTests(index, wanted, { level: profile.level, fill: options.fill ?? 'zones', shift: options.shift });
    result.missing.forEach((m) => missing.add(m));
    return result.tests;
  };

  const createPatient = async (profile: FictiveProfile): Promise<Patient> => {
    // The step 1 « Notes cliniques d'entretien » are kept on the patient.
    const fields = { ...profile.patient, interviewNotes: profile.notes };
    const id = await store.createPatient(fields);
    return { ...fields, id, age: getPatientAgeForIdentity(fields) };
  };

  const observationsOf = (profile: FictiveProfile) => ({ ...initialAssessmentState.observations, anamnese: profile.notes });

  const initialSections = async (patient: Patient, profile: FictiveProfile, tests: TestData): Promise<ReportSection[]> =>
    (await generator.generateInitial({ patient, observations: observationsOf(profile), tests, synthesis: SYNTHESIS, index })).sections;

  /** A finalized initial assessment, as `finalize` writes it (record + re-evaluation reminder). */
  const finalizedInitial = async (patient: Patient, profile: FictiveProfile, ago: number): Promise<PatientAssessment> => {
    const date = monthsAgo(now, ago);
    const tests = scoresOf(profile);
    const record = buildAssessmentRecord({
      kind: 'initial',
      date,
      tests,
      sections: await initialSections(patient, profile, tests),
      patientName: `${patient.firstName} ${patient.lastName}`,
      index,
    });
    await store.addAssessment(patient, record);
    await store.upsertPatientFollowup({
      patientId: patient.id!,
      status: 'upcoming',
      dueAt: reminderDueAt(date),
      note: 'Rappel généré après bilan initial',
    });
    return record;
  };

  const saveDraft = (patient: Patient, patch: Partial<AssessmentState> & { reportType: ReportType; step: number }) =>
    store.saveDraft(buildDraft({ ...initialAssessmentState, ...patch, patient }, patient, now));

  // ─── Dashboard: one patient per status ────────────────────────────────────
  if (scenario.name === 'dashboard') {
    await purgeFictivePatients(store);
    const byId = (id: string) => getFictiveProfile(id)!;
    const finalizedSince: Array<[string, number]> = [
      ['chloe', 13], // reminder overdue
      ['ines', 7], // reminder due
      ['leo', 2], // reminder upcoming
    ];
    for (const [id, ago] of finalizedSince) await finalizedInitial(await createPatient(byId(id)), byId(id), ago);

    const adam = byId('adam'); // stale draft: an initial draft left after the finalized report
    const adamPatient = await createPatient(adam);
    await finalizedInitial(adamPatient, adam, 3);
    await saveDraft(adamPatient, { reportType: 'initial', step: 2, tests: scoresOf(adam), observations: observationsOf(adam) });

    const lina = byId('lina'); // re-evaluation in progress
    const linaPatient = await createPatient(lina);
    const reference = await finalizedInitial(linaPatient, lina, 8);
    await saveDraft(linaPatient, {
      reportType: 'reevaluation',
      step: 1,
      previousAssessment: reference,
      tests: scoresOf(lina, { shift: 0.7 }),
    });

    const noah = byId('noah'); // initial assessment in progress, no report yet
    const noahPatient = await createPatient(noah);
    await saveDraft(noahPatient, { reportType: 'initial', step: 2, tests: scoresOf(noah), observations: observationsOf(noah) });
    return { open: null, missing: [...missing] };
  }

  // ─── One assessment in progress ───────────────────────────────────────────
  const { profile, step, fill } = scenario;
  await purgeFictivePatients(store, [profile.patient.firstName]);
  const patient = await createPatient(profile);

  if (scenario.name === 'reeval') {
    const reference = await finalizedInitial(patient, profile, 6);
    const tests = scoresOf(profile, { fill, shift: 0.7, tests: scenario.tests });
    const sections = step >= 3 ? await generator.generateReevaluation({ patient, previousAssessment: reference, tests, index }) : [];
    await saveDraft(patient, { reportType: 'reevaluation', step, previousAssessment: reference, tests, sections });
    return { open: patient.id!, missing: [...missing] };
  }

  const tests = step >= 2 ? scoresOf(profile, { fill, tests: scenario.tests }) : {};
  const observations = observationsOf(profile);
  if (scenario.name === 'historique') {
    const sections = step >= 3 ? await initialSections(patient, profile, tests) : [];
    await saveDraft(patient, {
      reportType: 'historique',
      step,
      assessmentDate: monthsAgo(now, 12).slice(0, 10),
      tests,
      observations,
      sections,
    });
    return { open: patient.id!, missing: [...missing] };
  }

  const sections = step >= 4 ? await initialSections(patient, profile, tests) : [];
  await saveDraft(patient, {
    reportType: 'initial',
    step,
    tests,
    observations,
    synthesis: step >= 3 ? SYNTHESIS : initialAssessmentState.synthesis,
    sections,
  });
  return { open: patient.id!, missing: [...missing] };
};
