/**
 * assessmentInProgress — the assessment in progress ("bilan en cours", see
 * CONTEXT.md): its state and its lifecycle, outside React so every scenario
 * can be tested in node with an in-memory store.
 *
 * Screens call intentions (start, resume, importFamily, saveAndClose, discard,
 * finalize, applyGeneratedReport) and field edits; the ordering rules live here:
 *
 * - Every lifecycle change bumps a token. An autosave, a patient creation or an
 *   AI result started for an older assessment is dropped instead of writing
 *   into the new one (or re-creating a draft after finalization).
 * - The patient record is created as soon as the identity is complete, and a
 *   draft is autosaved 3 s after the last change (only when `canPersist`).
 * - The patient file holds the identity: every draft save writes it there, and
 *   a resumed draft takes the identity from the file, not from its own copy.
 * - Finalization is acquired once the formal record is saved: the follow-up
 *   and the draft cleanup that follow are best effort.
 */

import type { StorageService } from '../services/storage';
import type { ClinicalSynthesis, DraftPayload, Observations, Patient, PatientAssessment, ReportSection, TestData } from '../types';
import { buildAssessmentRecord, buildEmptyTestsFrom, getAssessmentTests, getLatestFormalAssessment } from './assessment';
import type { CatalogIndex } from './catalogIndex';
import { Logger } from './logger';
import { getPatientAgeForIdentity, isPatientCreationReady } from './patient';
import { reminderDueAt } from './patientStatus';
import { normalizeTestData } from './scoring';

export type ReportType = 'initial' | 'reevaluation' | 'historique';

export const AUTOSAVE_DEBOUNCE_MS = 3_000;
const DRAFT_VERSION = 3;

export interface AssessmentState {
  patient: Patient;
  tests: TestData;
  observations: Observations;
  synthesis: ClinicalSynthesis;
  sections: ReportSection[];
  /** Page layout chosen at the export step; null = default layout (utils/reportData.ts resolvePages). */
  reportPages: string[][] | null;
  reportType: ReportType;
  /** Date of the original assessment (historical flow only), ISO string. */
  historicalDate: string;
  step: number;
  /** Reference assessment of a re-evaluation. */
  previousAssessment: PatientAssessment | null;
  isAutoSaving: boolean;
}

/** What the assessment in progress needs from the local storage (StorageService, which also serves the demo). */
export type AssessmentStore = Pick<
  typeof StorageService,
  | 'ensurePatientId'
  | 'createPatient'
  | 'deleteFile'
  | 'syncPatientIdentityPreview'
  | 'getDraft'
  | 'saveDraft'
  | 'deleteDraft'
  | 'addAssessment'
  | 'loadPatientDetails'
  | 'upsertPatientFollowup'
>;

export interface AssessmentInProgressDeps {
  store: AssessmentStore;
  /** Drafts and patient records may be written (app unlocked, not in demo). Read at each use. */
  canPersist: () => boolean;
  isDemoMode: () => boolean;
  loadCatalog: () => Promise<CatalogIndex>;
  /** Runs `fn` after `ms` and returns a cancel function (injected by tests). */
  schedule?: (fn: () => void, ms: number) => () => void;
  now?: () => Date;
}

export type Outcome<R extends string> = { ok: true } | { ok: false; reason: R };

export type EnsurePatientOutcome = { ok: true; patient: Patient } | { ok: false; reason: 'identity-incomplete' | 'creation-failed' };

export type FinalizeOutcome =
  | { ok: true; demo: true }
  | { ok: true; demo: false; patient: Patient; sections: ReportSection[]; reportType: ReportType }
  | { ok: false; reason: 'busy' | 'identity-incomplete' | 'creation-failed' | 'save-failed' };

/** What was sent to the AI, to apply its result on the same assessment only. */
export interface GenerationTicket {
  token: number;
  tests: TestData;
}

export interface GeneratedReport {
  sections: ReportSection[];
  /** AI-reformulated observations, by subtest id. */
  reformulatedObservations?: Record<string, string>;
}

// The patient id stays undefined until the local record is created.
export const initialPatient: Patient = {
  firstName: '',
  lastName: '',
  dob: '',
  age: '',
  gender: '',
  address: '',
  parentNames: '',
  parentPhone: '',
  parentEmail: '',
  parent1Name: '',
  parent1Phone: '',
  parent1Email: '',
  parent2Name: '',
  parent2Phone: '',
  parent2Email: '',
  guardArrangement: '',
  siblings: [],
  school: '',
  classLevel: '',
  schoolType: '',
  schoolTrack: '',
  schoolRepeatYear: '',
  teacher: '',
  carePlan: '',
  avs: '',
  avsDetails: '',
  prescribingDoctor: '',
  medicalDiagnosis: '',
  medicalTreatments: '',
  medicalFollowup: '',
  reason: '',
  familyExpectations: '',
  pregnancyBirth: '',
  developmentMotor: '',
  developmentLanguage: '',
  sleep: '',
  sensory: '',
  crawlingFourPattes: '',
  crawlingRamper: '',
  meals: '',
  dressing: '',
  continence: '',
  timeSpace: '',
  dressingAutonomy: '',
  dressingObservations: '',
  hygieneTeeth: '',
  hygieneHands: '',
  hygieneBath: '',
  hygieneFace: '',
  hygieneHair: '',
  hygieneContinenceStatus: '',
  hygieneObservations: '',
  timeSpaceClockReading: '',
  timeSpaceObservations: '',
  schoolAttention: '',
  schoolFavoriteSubjects: '',
  schoolDislikedSubjects: '',
  classroomBehavior: '',
  schoolOrganization: '',
  schoolMemory: '',
  schoolParticipation: '',
  peerRelations: '',
  homeworkHabits: '',
  writingIssues: '',
  writingDifficultyTags: '',
  toolUsage: '',
  schoolAccommodations: '',
  emotionalGlobalTags: '',
  emotionalReactionTags: '',
  emotionalNotes: '',
  prescribingDoctorProfession: '',
  remarks: '',
  priorities: '',
};

const initialObs: Observations = { anamnese: '', motricite: '', coordination: '', spatial: '', graphique: '' };
const initialSynthesis: ClinicalSynthesis = { diagnosticInput: '', projectInput: '', recommendationsInput: '' };

export const initialAssessmentState: AssessmentState = {
  patient: initialPatient,
  tests: {},
  observations: initialObs,
  synthesis: initialSynthesis,
  sections: [],
  reportPages: null,
  reportType: 'initial',
  historicalDate: '',
  step: 1,
  previousAssessment: null,
  isAutoSaving: false,
};

export const buildDraft = (state: AssessmentState, patient: Patient, now: Date): DraftPayload => ({
  patient,
  tests: state.tests,
  observations: state.observations,
  synthesis: state.synthesis,
  sections: state.sections,
  ...(state.reportPages ? { reportPages: state.reportPages } : {}),
  reportType: state.reportType,
  historicalDate: state.historicalDate || undefined,
  previousAssessmentId: state.previousAssessment?.id,
  step: state.step,
  version: DRAFT_VERSION,
  timestamp: now.toISOString(),
});

/** State of a draft, merged with the defaults so drafts saved by older versions still load. */
const stateFromDraft = (draft: DraftPayload): AssessmentState => ({
  ...initialAssessmentState,
  ...(draft.patient ? { patient: { ...initialPatient, ...draft.patient } } : {}),
  ...(draft.tests ? { tests: normalizeTestData(draft.tests) } : {}),
  ...(draft.observations ? { observations: { ...initialObs, ...draft.observations } } : {}),
  ...(draft.synthesis ? { synthesis: { ...initialSynthesis, ...draft.synthesis } } : {}),
  ...(draft.sections ? { sections: [...draft.sections] } : {}),
  ...(Array.isArray(draft.reportPages) ? { reportPages: draft.reportPages } : {}),
  ...(draft.reportType ? { reportType: draft.reportType } : {}),
  ...(draft.historicalDate ? { historicalDate: draft.historicalDate } : {}),
  ...(draft.step ? { step: draft.step } : {}),
});

/** Reformulated observations, applied only where the practitioner did not change the observation since the request. */
const applyReformulations = (current: TestData, sent: TestData, reformulated: Record<string, string>): TestData =>
  Object.fromEntries(
    Object.entries(current).map(([testId, subtests]) => [
      testId,
      Object.fromEntries(
        Object.entries(subtests).map(([subId, score]) => {
          const text = reformulated[subId];
          const unchanged = (score.observation ?? '') === (sent[testId]?.[subId]?.observation ?? '');
          return [subId, text && unchanged ? { ...score, observation: text } : score];
        }),
      ),
    ]),
  );

/** The patient as stored: with its record id and the age computed today. */
const withRecord = (patient: Patient, id = patient.id): Patient => ({ ...patient, id, age: getPatientAgeForIdentity(patient) });

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

export const createAssessmentInProgress = (deps: AssessmentInProgressDeps) => {
  const { store } = deps;
  const schedule = deps.schedule ?? defaultSchedule;
  const now = deps.now ?? (() => new Date());

  let state: AssessmentState = initialAssessmentState;
  /** Incremented by every lifecycle change; async work started for an older token is dropped. */
  let token = 0;
  const listeners = new Set<() => void>();
  let cancelAutosave: (() => void) | null = null;
  let createPromise: Promise<string> | null = null;
  let runningAutosaves = 0;
  let finalizing = false;
  /** The patient as last written to its file, so an unchanged identity is not written again. */
  let writtenPatient = '';

  const emit = () => listeners.forEach((l) => l());

  const setAutoSaving = (value: boolean) => {
    if (state.isAutoSaving === value) return;
    state = { ...state, isAutoSaving: value };
    emit();
  };

  /** Replace the state after an edit or a load, then create the patient record and schedule the autosave. */
  const change = (patch: Partial<AssessmentState>) => {
    state = { ...state, ...patch };
    emit();
    if (!deps.canPersist() || !isPatientCreationReady(state.patient)) return;
    if (!state.patient.id) void ensurePatientId(state.patient);
    scheduleAutosave();
  };

  /** Create the local patient record once (concurrent callers share the same promise). */
  const ensurePatientId = async (snapshot: Patient): Promise<string | null> => {
    if (snapshot.id) return snapshot.id;
    if (!isPatientCreationReady(snapshot)) return null;
    if (!createPromise) {
      const startedFor = token;
      const toCreate = withRecord(snapshot);
      const promise: Promise<string> = store
        .ensurePatientId(toCreate)
        .then((id) => {
          if (startedFor === token && !state.patient.id) change({ patient: { ...state.patient, id, age: toCreate.age } });
          return id;
        })
        .finally(() => {
          if (createPromise === promise) createPromise = null;
        });
      createPromise = promise;
    }
    try {
      return await createPromise;
    } catch (e) {
      Logger.error('DB', 'Failed to create patient ID', e);
      return null;
    }
  };

  const scheduleAutosave = () => {
    cancelAutosave?.();
    const startedFor = token;
    cancelAutosave = schedule(() => {
      cancelAutosave = null;
      void autosave(startedFor);
    }, AUTOSAVE_DEBOUNCE_MS);
  };

  const autosave = async (startedFor: number) => {
    if (startedFor !== token || !deps.canPersist()) return;
    runningAutosaves += 1;
    setAutoSaving(true);
    const snapshot = state;
    try {
      const patientId = snapshot.patient.id || (await ensurePatientId(snapshot.patient));
      if (!patientId || startedFor !== token) return;
      const patient = withRecord(snapshot.patient, patientId);
      // The draft is still saved if the file cannot be written: the next autosave retries.
      await writePatientFile(patient).catch((e) => Logger.warn('DB', 'Patient file update failed', e));
      await store.saveDraft(buildDraft(snapshot, patient, now()));
    } catch (e) {
      Logger.error('DB', 'Autosave draft failed', e, { patientId: snapshot.patient.id ?? null });
    } finally {
      if (startedFor === token) {
        runningAutosaves = Math.max(0, runningAutosaves - 1);
        if (runningAutosaves === 0) setAutoSaving(false);
      }
    }
  };

  const reset = () => {
    token += 1;
    cancelAutosave?.();
    cancelAutosave = null;
    createPromise = null;
    runningAutosaves = 0;
    writtenPatient = '';
    state = initialAssessmentState;
    emit();
  };

  /** Put the reference assessment in the state (tests rebuilt from flat results for old records). */
  const applyReference = async (reference: PatientAssessment, withEmptyScores: boolean) => {
    const startedFor = token;
    const index = await deps.loadCatalog();
    if (startedFor !== token) return;
    const referenceTests = getAssessmentTests(reference, index);
    change({
      previousAssessment: { ...reference, tests: referenceTests },
      ...(withEmptyScores ? { tests: normalizeTestData(buildEmptyTestsFrom(referenceTests)) } : {}),
    });
  };

  /** Patient with its local record created (and its age refreshed), written back into the state. */
  const ensurePatient = async (options?: { syncPreview?: boolean }): Promise<EnsurePatientOutcome> => {
    const current = state.patient;
    // An existing record is kept even if the identity was emptied since (old files may lack a date of birth).
    if (!current.id && !isPatientCreationReady(current)) return { ok: false, reason: 'identity-incomplete' };
    const id = await ensurePatientId(current);
    if (!id) return { ok: false, reason: 'creation-failed' };
    const patient = withRecord(state.patient, id);
    if (state.patient.id !== id || state.patient.age !== patient.age) change({ patient });
    if (options?.syncPreview) await writePatientFile(patient);
    return { ok: true, patient };
  };

  /** The patient file holds the identity: the draft copy is only a fallback when the file is missing (#80). */
  const writePatientFile = async (patient: Patient) => {
    const key = JSON.stringify(patient);
    if (key === writtenPatient) return;
    await store.syncPatientIdentityPreview(patient.id!, patient);
    writtenPatient = key;
  };

  const deleteDraftBestEffort = async (patientId: string) => {
    try {
      await store.deleteDraft(patientId);
    } catch {
      try {
        await store.deleteDraft(patientId);
      } catch (e) {
        Logger.warn('DB', 'Draft cleanup failed after finalization', { patientId, error: e });
      }
    }
  };

  // ─── Lifecycle intentions ─────────────────────────────────────────────────

  /** Start a new assessment. A re-evaluation needs a patient with a formal report (its reference). */
  const start = async (
    type: ReportType,
    patient?: Patient,
    knownAssessments?: PatientAssessment[],
  ): Promise<Outcome<'no-patient' | 'no-reference'>> => {
    let reference: PatientAssessment | null = null;
    if (type === 'reevaluation') {
      if (!patient?.id) {
        Logger.error('DB', 'Re-evaluation requested without a patient id');
        return { ok: false, reason: 'no-patient' };
      }
      reference = getLatestFormalAssessment(knownAssessments ?? (await store.loadPatientDetails(patient.id)).assessments);
      if (!reference) return { ok: false, reason: 'no-reference' };
    }
    reset();
    // The stored age is the one computed when the file was last saved: refresh it for the new report.
    change({
      reportType: type,
      ...(patient ? { patient: withRecord(patient) } : {}),
    });
    if (reference) await applyReference(reference, true);
    return { ok: true };
  };

  /**
   * Resume the patient's draft, restoring the reference of a re-evaluation.
   * A stale draft is deleted and a re-evaluation starts instead.
   */
  const resume = async (
    patientId: string,
    options: { stale: boolean },
  ): Promise<Outcome<'demo' | 'not-found' | 'no-patient' | 'no-reference' | 'error'>> => {
    if (deps.isDemoMode()) return { ok: false, reason: 'demo' };
    try {
      if (options.stale) {
        await store.deleteDraft(patientId);
        const details = await store.loadPatientDetails(patientId);
        return await start('reevaluation', details.patient, details.assessments);
      }
      const draft = await store.getDraft(patientId);
      if (!draft) return { ok: false, reason: 'not-found' };
      // The identity may have been corrected in the patient file since the draft was saved.
      const details = await store.loadPatientDetails(patientId).catch(() => null);
      reset();
      const restored = stateFromDraft(draft);
      change(details ? { ...restored, patient: { ...initialPatient, ...details.patient } } : restored);
      if (draft.reportType === 'reevaluation') {
        const { assessments } = details ?? (await store.loadPatientDetails(patientId));
        const reference = assessments.find((a) => a.id === draft.previousAssessmentId) ?? getLatestFormalAssessment(assessments);
        if (reference) await applyReference(reference, Object.keys(draft.tests ?? {}).length === 0);
      }
      return { ok: true };
    } catch (e) {
      Logger.error('DB', 'Draft resume failed', e);
      return { ok: false, reason: 'error' };
    }
  };

  /**
   * Open the file sent by the family as a new initial assessment. The patient
   * and its draft are created first; `commit` (removal of the submission) runs
   * last, and a failure rolls the local import back so a retry cannot create a
   * duplicate patient. In demo, the given data is opened without any write.
   */
  const importFamily = async (
    data: { patient: Patient; tests?: TestData; observations?: Partial<Observations> },
    commit?: () => Promise<void>,
  ): Promise<Outcome<'error'>> => {
    if (deps.isDemoMode()) {
      reset();
      change({
        patient: { ...initialPatient, ...data.patient },
        tests: normalizeTestData(data.tests ?? {}),
        observations: { ...initialObs, ...data.observations },
      });
      return { ok: true };
    }
    try {
      const newId = await store.createPatient({ ...data.patient });
      const draft: DraftPayload = {
        patient: { ...data.patient, id: newId },
        reportType: 'initial',
        step: 1,
        timestamp: now().toISOString(),
      };
      try {
        await store.saveDraft(draft);
        await commit?.();
      } catch (importError) {
        await store.deleteFile(newId).catch((rollbackError) => Logger.error('DB', 'Import rollback failed', rollbackError));
        throw importError;
      }
      reset();
      change(stateFromDraft(draft));
      return { ok: true };
    } catch (e) {
      Logger.error('DB', 'Family import failed', e);
      return { ok: false, reason: 'error' };
    }
  };

  /** Save a draft and close the assessment. */
  const saveAndClose = async (): Promise<Outcome<'identity-incomplete' | 'creation-failed' | 'error'>> => {
    if (deps.isDemoMode()) {
      reset();
      return { ok: true };
    }
    const persisted = await ensurePatient();
    if (!persisted.ok) return persisted;
    try {
      await writePatientFile(persisted.patient);
      await store.saveDraft(buildDraft(state, persisted.patient, now()));
    } catch (e) {
      Logger.error('DB', 'Save error', e);
      return { ok: false, reason: 'error' };
    }
    reset();
    return { ok: true };
  };

  /** Close the assessment without keeping it: its draft is deleted. Returns true when a draft was deleted. */
  const discard = async (): Promise<boolean> => {
    const patientId = state.patient.id;
    reset();
    if (!patientId || deps.isDemoMode()) return false;
    await store.deleteDraft(patientId).catch((e) => Logger.error('DB', 'Draft discard failed', e, { patientId }));
    return true;
  };

  /**
   * Save the assessment as a formal record and close it. Once the record is
   * saved the finalization is acquired: the next follow-up and the draft
   * deletion are best effort.
   */
  const finalize = async (index: CatalogIndex): Promise<FinalizeOutcome> => {
    if (deps.isDemoMode()) {
      reset();
      return { ok: true, demo: true };
    }
    if (finalizing) return { ok: false, reason: 'busy' }; // double click
    finalizing = true;
    try {
      const persisted = await ensurePatient();
      if (!persisted.ok) return persisted;
      const { patient } = persisted;
      const { reportType, historicalDate, tests, sections, reportPages, previousAssessment } = state;
      const date = reportType === 'historique' && historicalDate ? historicalDate : now().toISOString();
      const record = buildAssessmentRecord({
        // A historical import is the initial assessment done outside the app.
        kind: reportType === 'reevaluation' ? 'reevaluation' : 'initial',
        date,
        tests,
        sections,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        previousAssessmentId: reportType === 'reevaluation' ? previousAssessment?.id : undefined,
        pages: reportPages,
        index,
      });
      try {
        await store.addAssessment(patient, record);
      } catch (e) {
        Logger.error('DB', 'Finalization failed', e);
        return { ok: false, reason: 'save-failed' };
      }

      // Next re-evaluation reminder, 6 months after this assessment.
      try {
        await store.upsertPatientFollowup({
          patientId: patient.id!,
          status: 'upcoming',
          dueAt: reminderDueAt(date),
          note: reportType === 'reevaluation' ? 'Rappel généré après réévaluation' : 'Rappel généré après bilan initial',
        });
      } catch (e) {
        Logger.warn('DB', 'Follow-up update failed (non-blocking)', e);
      }

      // Reset first: cancels any pending autosave so the draft is not re-created after deletion.
      reset();
      await deleteDraftBestEffort(patient.id!);
      return { ok: true, demo: false, patient, sections, reportType };
    } finally {
      finalizing = false;
    }
  };

  /** Snapshot taken when an AI generation starts. */
  const beginGeneration = (): GenerationTicket => ({ token, tests: state.tests });

  /**
   * Apply an AI result to the current state. Scores and observations edited
   * during the generation are kept. Returns false (nothing applied) when the
   * assessment was closed or replaced meanwhile.
   */
  const applyGeneratedReport = (ticket: GenerationTicket, report: GeneratedReport): boolean => {
    if (ticket.token !== token) return false;
    const reformulated = report.reformulatedObservations ?? {};
    const tests =
      Object.keys(reformulated).length > 0 ? normalizeTestData(applyReformulations(state.tests, ticket.tests, reformulated)) : state.tests;
    change({ tests, sections: report.sections });
    return true;
  };

  // ─── Field edits ──────────────────────────────────────────────────────────

  const edits = {
    updatePatient: (data: Partial<Patient>) => change({ patient: { ...state.patient, ...data } }),
    /** Replace all scores (the caller always passes the full object so deletions persist). */
    updateTests: (data: TestData) => change({ tests: normalizeTestData(data) }),
    updateObservations: (data: Partial<Observations>) => change({ observations: { ...state.observations, ...data } }),
    updateSynthesis: (data: Partial<ClinicalSynthesis>) => change({ synthesis: { ...state.synthesis, ...data } }),
    setSections: (sections: ReportSection[]) => change({ sections }),
    /** Page layout of the export step (saved with the draft, then with the finalized report). */
    setReportPages: (reportPages: string[][]) => change({ reportPages }),
    /** Patch a section (creates it when missing, e.g. the "Page École"). */
    updateSection: (id: string, update: Partial<ReportSection>) =>
      change({
        sections: state.sections.some((s) => s.id === id)
          ? state.sections.map((s) => (s.id === id ? { ...s, ...update } : s))
          : [...state.sections, { id, title: update.title || id, content: update.content || '', status: 'draft' as const, ...update }],
      }),
    setHistoricalDate: (historicalDate: string) => change({ historicalDate }),
    setStep: (step: number) => change({ step }),
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ...edits,
    ensurePatient,
    start,
    resume,
    importFamily,
    saveAndClose,
    discard,
    finalize,
    beginGeneration,
    applyGeneratedReport,
  };
};

export type AssessmentInProgress = ReturnType<typeof createAssessmentInProgress>;
