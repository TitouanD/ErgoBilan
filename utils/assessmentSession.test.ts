import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import type { DraftPayload, Patient, PatientAssessment, ReportSection } from '../types';
import { AUTOSAVE_DEBOUNCE_MS, createAssessmentSession, initialPatient, type AssessmentStore } from './assessmentSession';
import { buildCatalogIndex } from './catalogIndex';

vi.mock('./logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), capture: vi.fn() } }));

const catalog: CategoryDef[] = [
  {
    id: 'motor',
    name: 'Motricité',
    iconKey: 'Hand',
    sortOrder: 1,
    tests: [
      {
        id: 'mabc',
        name: 'MABC-2',
        subtests: [
          { id: 'dext', name: 'Dextérité', unit: 'pts', scoreType: 'scaled', inputModel: 'numeric_4mode' },
          { id: 'balle', name: 'Viser et attraper', unit: 'pts', scoreType: 'scaled', inputModel: 'numeric_4mode' },
        ],
      },
    ],
  },
];
const index = buildCatalogIndex(catalog);

const identity: Patient = { ...initialPatient, firstName: 'Sarah', lastName: 'Martin', dob: '2018-03-01' };

const reference: PatientAssessment = {
  id: 'ref-1',
  date: '2026-01-10T00:00:00.000Z',
  kind: 'initial',
  hasFormalReport: true,
  testName: 'MABC-2',
  tests: { mabc: { dext: { value: '9', unit: 'NS' }, balle: { value: '10', unit: 'NS' } } },
};

const section = (id: string, content = 'Texte'): ReportSection => ({ id, title: id, content, status: 'draft' });

/** In-memory local storage with injectable failures. */
const makeStore = () => {
  const drafts = new Map<string, DraftPayload>();
  const patients = new Map<string, Patient>();
  const assessments = new Map<string, PatientAssessment[]>();
  const failures = { deleteDraft: 0, saveDraft: false };
  let next = 0;
  const createPatient = vi.fn(async (p: Patient) => {
    const id = `p${++next}`;
    patients.set(id, { ...p, id });
    return id;
  });
  const fns = {
    createPatient,
    ensurePatientId: vi.fn(async (p: Patient) => p.id ?? createPatient(p)),
    deleteFile: vi.fn(async (id: string) => {
      patients.delete(id);
      drafts.delete(id);
    }),
    syncPatientIdentityPreview: vi.fn(async () => {}),
    getDraft: vi.fn(async (id?: string) => drafts.get(id!) ?? null),
    saveDraft: vi.fn(async (d: DraftPayload) => {
      if (failures.saveDraft) throw new Error('IDB_WRITE');
      drafts.set(d.patient!.id!, d);
    }),
    deleteDraft: vi.fn(async (id?: string) => {
      if (failures.deleteDraft > 0) {
        failures.deleteDraft -= 1;
        throw new Error('IDB_DELETE');
      }
      drafts.delete(id!);
    }),
    addAssessment: vi.fn(async (p: Patient, a: PatientAssessment) => {
      assessments.set(p.id!, [...(assessments.get(p.id!) ?? []), a]);
    }),
    loadPatientDetails: vi.fn(async (id: string) => ({
      patient: patients.get(id)!,
      assessments: assessments.get(id) ?? [],
      followup: null,
      hasMoreAssessments: false,
      nextAssessmentOffset: 0,
    })),
    upsertPatientFollowup: vi.fn(async () => {}),
  };
  const addPatient = (p: Patient, list: PatientAssessment[] = []) => {
    patients.set(p.id!, p);
    assessments.set(p.id!, list);
  };
  return { fns, store: fns as unknown as AssessmentStore, drafts, patients, assessments, failures, addPatient };
};

/** Manual timers: `flush()` runs what is due, as the 3 s debounce would. */
const makeScheduler = () => {
  const queue = new Map<number, () => void>();
  let id = 0;
  const schedule = (fn: () => void, ms: number) => {
    expect(ms).toBe(AUTOSAVE_DEBOUNCE_MS);
    const key = ++id;
    queue.set(key, fn);
    return () => {
      queue.delete(key);
    };
  };
  const flush = async () => {
    const due = [...queue.values()];
    queue.clear();
    due.forEach((fn) => fn());
    await settle();
  };
  return { schedule, flush, pending: () => queue.size };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = (options: { demo?: boolean } = {}) => {
  const db = makeStore();
  const timers = makeScheduler();
  const session = createAssessmentSession({
    store: db.store,
    canPersist: () => !options.demo,
    isDemoMode: () => Boolean(options.demo),
    loadCatalog: async () => index,
    schedule: timers.schedule,
    now: () => new Date('2026-09-29T10:00:00.000Z'),
  });
  return { db, timers, session };
};

describe('assessmentSession', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('refuses a re-evaluation without reference and leaves the state untouched', async () => {
    const { session, db } = ctx;
    session.updateObservations({ anamnese: 'en cours' });
    db.addPatient({ ...identity, id: 'sarah' });

    expect(await session.start('reevaluation', { ...identity, id: 'sarah' })).toEqual({ ok: false, reason: 'no-reference' });
    expect(await session.start('reevaluation', identity)).toEqual({ ok: false, reason: 'no-patient' });
    expect(session.getState().observations.anamnese).toBe('en cours');
  });

  it('starts a re-evaluation from the reference subtests with empty scores', async () => {
    const { session, db } = ctx;
    db.addPatient({ ...identity, id: 'sarah' }, [reference]);

    expect(await session.start('reevaluation', { ...identity, id: 'sarah' })).toEqual({ ok: true });
    const state = session.getState();
    expect(state.reportType).toBe('reevaluation');
    expect(state.previousAssessment?.id).toBe('ref-1');
    expect(Object.keys(state.tests.mabc)).toEqual(['dext', 'balle']);
    expect(state.tests.mabc.dext.value).toBeUndefined();
  });

  it('resumes a re-evaluation draft with its reference and keeps the entered scores', async () => {
    const { session, db } = ctx;
    const newer: PatientAssessment = { ...reference, id: 'ref-2', date: '2026-06-01T00:00:00.000Z' };
    db.addPatient({ ...identity, id: 'sarah' }, [reference, newer]);
    db.drafts.set('sarah', {
      patient: { ...identity, id: 'sarah' },
      reportType: 'reevaluation',
      previousAssessmentId: 'ref-1',
      tests: { mabc: { dext: { value: '12', unit: 'NS' } } },
      step: 2,
    });

    expect(await session.resume('sarah', { stale: false })).toEqual({ ok: true });
    const state = session.getState();
    expect(state.previousAssessment?.id).toBe('ref-1');
    expect(state.tests.mabc.dext.value).toBe('12');
    expect(state.step).toBe(2);
  });

  it('turns a stale draft into a re-evaluation and deletes it', async () => {
    const { session, db } = ctx;
    db.addPatient({ ...identity, id: 'sarah' }, [reference]);
    db.drafts.set('sarah', { patient: { ...identity, id: 'sarah' }, reportType: 'initial' });

    expect(await session.resume('sarah', { stale: true })).toEqual({ ok: true });
    expect(db.drafts.has('sarah')).toBe(false);
    expect(session.getState().reportType).toBe('reevaluation');
    expect(session.getState().previousAssessment?.id).toBe('ref-1');
  });

  it('autosaves after an edit, but never re-creates the draft after finalization', async () => {
    const { session, db, timers } = ctx;
    session.updatePatient(identity);
    await settle(); // patient record created as soon as the identity is complete
    const patientId = session.getState().patient.id!;
    expect(patientId).toBe('p1');

    await timers.flush();
    expect(db.drafts.has(patientId)).toBe(true);

    session.updateObservations({ anamnese: 'modifiée' }); // autosave scheduled again
    expect(timers.pending()).toBeGreaterThan(0);
    const result = await session.finalize(index);
    expect(result.ok).toBe(true);
    await timers.flush();
    expect(db.drafts.has(patientId)).toBe(false);
    expect(db.assessments.get(patientId)).toHaveLength(1);
  });

  it('keeps the finalization when the draft cannot be deleted', async () => {
    const { session, db } = ctx;
    session.updatePatient(identity);
    await settle();
    const patientId = session.getState().patient.id!;
    db.drafts.set(patientId, { patient: session.getState().patient });
    db.failures.deleteDraft = 2;

    const result = await session.finalize(index);
    expect(result).toMatchObject({ ok: true, demo: false, reportType: 'initial' });
    expect(db.fns.deleteDraft).toHaveBeenCalledTimes(2);
    expect(db.assessments.get(patientId)).toHaveLength(1);
    expect(session.getState().patient).toEqual(initialPatient);
  });

  it('reports a failed save without closing the assessment', async () => {
    const { session, db } = ctx;
    session.updatePatient(identity);
    db.fns.addAssessment.mockRejectedValueOnce(new Error('IDB_WRITE'));

    expect(await session.finalize(index)).toEqual({ ok: false, reason: 'save-failed' });
    expect(session.getState().patient.firstName).toBe('Sarah');
  });

  it('applies the AI result without losing edits made during the generation', async () => {
    const { session } = ctx;
    session.updateTests({
      mabc: { dext: { value: '7', unit: 'NS', observation: 'lent' }, balle: { value: '10', unit: 'NS', observation: 'rate' } },
    });
    const ticket = session.beginGeneration();

    // During the generation: a score and an observation are edited.
    const during = session.getState().tests;
    session.updateTests({
      mabc: { dext: { ...during.mabc.dext, value: '8' }, balle: { ...during.mabc.balle, observation: 'attrape à deux mains' } },
    });

    const applied = session.applyGeneratedReport(ticket, {
      sections: [section('diagnostic')],
      reformulatedObservations: { dext: 'Geste lent et appliqué.', balle: 'Réceptions souvent manquées.' },
    });
    expect(applied).toBe(true);
    const { tests, sections } = session.getState();
    expect(tests.mabc.dext.value).toBe('8');
    expect(tests.mabc.dext.observation).toBe('Geste lent et appliqué.');
    expect(tests.mabc.balle.observation).toBe('attrape à deux mains');
    expect(sections.map((s) => s.id)).toEqual(['diagnostic']);
  });

  it('drops an AI result that arrives after the assessment was closed', async () => {
    const { session } = ctx;
    const ticket = session.beginGeneration();
    await session.discard();
    expect(session.applyGeneratedReport(ticket, { sections: [section('diagnostic')] })).toBe(false);
    expect(session.getState().sections).toEqual([]);
  });

  it('discards: deletes the draft and returns to the initial state', async () => {
    const { session, db } = ctx;
    session.updatePatient(identity);
    await settle();
    const patientId = session.getState().patient.id!;
    db.drafts.set(patientId, { patient: session.getState().patient });

    expect(await session.discard()).toBe(true);
    expect(db.drafts.has(patientId)).toBe(false);
    expect(session.getState().patient).toEqual(initialPatient);
  });

  it('imports the family file as a new initial assessment, and rolls back when the commit fails', async () => {
    const { session, db } = ctx;
    const family = { ...identity, reason: 'Écriture difficile' };

    expect(await session.importFamily({ patient: family }, async () => {})).toEqual({ ok: true });
    const state = session.getState();
    expect(state.patient.id).toBe('p1');
    expect(state.patient.reason).toBe('Écriture difficile');
    expect(state.reportType).toBe('initial');
    expect(state.step).toBe(1);
    expect(db.drafts.get('p1')?.reportType).toBe('initial');

    const failing = await session.importFamily({ patient: family }, async () => {
      throw new Error('SUPABASE_DELETE');
    });
    expect(failing).toEqual({ ok: false, reason: 'error' });
    expect(db.patients.has('p2')).toBe(false);
    expect(session.getState().patient.id).toBe('p1'); // the current assessment is untouched
  });

  it('writes nothing in demo mode', async () => {
    const demo = setup({ demo: true });
    const { session, db, timers } = demo;
    await session.importFamily({ patient: { ...identity, id: 'demo-elya' }, tests: reference.tests });
    session.updateObservations({ anamnese: 'démo' });
    await timers.flush();
    expect(await session.resume('demo-elya', { stale: false })).toEqual({ ok: false, reason: 'demo' });
    expect(await session.saveAndClose()).toEqual({ ok: true });
    expect(await session.finalize(index)).toEqual({ ok: true, demo: true });

    expect(timers.pending()).toBe(0);
    for (const fn of [db.fns.createPatient, db.fns.saveDraft, db.fns.deleteDraft, db.fns.addAssessment, db.fns.upsertPatientFollowup]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
