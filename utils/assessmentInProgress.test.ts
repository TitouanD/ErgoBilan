import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategoryDef } from '../data/testCatalog';
import type { DraftPayload, Patient, PatientAssessment, ReportSection } from '../types';
import { AUTOSAVE_DEBOUNCE_MS, createAssessmentInProgress, initialPatient, type AssessmentStore } from './assessmentInProgress';
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
  const bilan = createAssessmentInProgress({
    store: db.store,
    canPersist: () => !options.demo,
    isDemoMode: () => Boolean(options.demo),
    loadCatalog: async () => index,
    schedule: timers.schedule,
    now: () => new Date('2026-09-29T10:00:00.000Z'),
  });
  return { db, timers, bilan };
};

describe('assessmentInProgress', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('refuses a re-evaluation without reference and leaves the state untouched', async () => {
    const { bilan, db } = ctx;
    bilan.updateObservations({ anamnese: 'en cours' });
    db.addPatient({ ...identity, id: 'sarah' });

    expect(await bilan.start('reevaluation', { ...identity, id: 'sarah' })).toEqual({ ok: false, reason: 'no-reference' });
    expect(await bilan.start('reevaluation', identity)).toEqual({ ok: false, reason: 'no-patient' });
    expect(bilan.getState().observations.anamnese).toBe('en cours');
  });

  it('starts a re-evaluation from the reference subtests with empty scores', async () => {
    const { bilan, db } = ctx;
    db.addPatient({ ...identity, id: 'sarah' }, [reference]);

    expect(await bilan.start('reevaluation', { ...identity, id: 'sarah' })).toEqual({ ok: true });
    const state = bilan.getState();
    expect(state.reportType).toBe('reevaluation');
    expect(state.previousAssessment?.id).toBe('ref-1');
    expect(Object.keys(state.tests.mabc)).toEqual(['dext', 'balle']);
    expect(state.tests.mabc.dext.value).toBeUndefined();
  });

  it('resumes a re-evaluation draft with its reference and keeps the entered scores', async () => {
    const { bilan, db } = ctx;
    const newer: PatientAssessment = { ...reference, id: 'ref-2', date: '2026-06-01T00:00:00.000Z' };
    db.addPatient({ ...identity, id: 'sarah' }, [reference, newer]);
    db.drafts.set('sarah', {
      patient: { ...identity, id: 'sarah' },
      reportType: 'reevaluation',
      previousAssessmentId: 'ref-1',
      tests: { mabc: { dext: { value: '12', unit: 'NS' } } },
      step: 2,
    });

    expect(await bilan.resume('sarah', { stale: false })).toEqual({ ok: true });
    const state = bilan.getState();
    expect(state.previousAssessment?.id).toBe('ref-1');
    expect(state.tests.mabc.dext.value).toBe('12');
    expect(state.step).toBe(2);
  });

  it('turns a stale draft into a re-evaluation and deletes it', async () => {
    const { bilan, db } = ctx;
    db.addPatient({ ...identity, id: 'sarah' }, [reference]);
    db.drafts.set('sarah', { patient: { ...identity, id: 'sarah' }, reportType: 'initial' });

    expect(await bilan.resume('sarah', { stale: true })).toEqual({ ok: true });
    expect(db.drafts.has('sarah')).toBe(false);
    expect(bilan.getState().reportType).toBe('reevaluation');
    expect(bilan.getState().previousAssessment?.id).toBe('ref-1');
  });

  it('autosaves after an edit, but never re-creates the draft after finalization', async () => {
    const { bilan, db, timers } = ctx;
    bilan.updatePatient(identity);
    await settle(); // patient record created as soon as the identity is complete
    const patientId = bilan.getState().patient.id!;
    expect(patientId).toBe('p1');

    await timers.flush();
    expect(db.drafts.has(patientId)).toBe(true);

    bilan.updateObservations({ anamnese: 'modifiée' }); // autosave scheduled again
    expect(timers.pending()).toBeGreaterThan(0);
    const result = await bilan.finalize(index);
    expect(result.ok).toBe(true);
    await timers.flush();
    expect(db.drafts.has(patientId)).toBe(false);
    expect(db.assessments.get(patientId)).toHaveLength(1);
  });

  it('keeps the report layout in the draft and in the finalized report (#59)', async () => {
    const { bilan, db } = ctx;
    const layout = [['diagnostic'], ['mandat_ref'], ['annexes']];
    bilan.updatePatient(identity);
    bilan.setSections([section('mandat_ref'), section('diagnostic')]);
    bilan.setReportPages(layout);
    expect(await bilan.saveAndClose()).toEqual({ ok: true });
    const patientId = 'p1';
    expect(db.drafts.get(patientId)?.reportPages).toEqual(layout);
    expect(bilan.getState().reportPages).toBeNull();

    expect(await bilan.resume(patientId, { stale: false })).toEqual({ ok: true });
    expect(bilan.getState().reportPages).toEqual(layout);
    expect((await bilan.finalize(index)).ok).toBe(true);
    expect(db.assessments.get(patientId)?.[0].report?.pages).toEqual(layout);
  });

  it('resumes a draft saved without layout (older versions)', async () => {
    const { bilan, db } = ctx;
    db.addPatient({ ...identity, id: 'ancien' });
    db.drafts.set('ancien', { patient: { ...identity, id: 'ancien' }, sections: [section('diagnostic')], step: 5 });
    expect(await bilan.resume('ancien', { stale: false })).toEqual({ ok: true });
    expect(bilan.getState().reportPages).toBeNull();
    expect((await bilan.finalize(index)).ok).toBe(true);
    expect(db.assessments.get('ancien')?.[0].report).not.toHaveProperty('pages');
  });

  it('keeps the finalization when the draft cannot be deleted', async () => {
    const { bilan, db } = ctx;
    bilan.updatePatient(identity);
    await settle();
    const patientId = bilan.getState().patient.id!;
    db.drafts.set(patientId, { patient: bilan.getState().patient });
    db.failures.deleteDraft = 2;

    const result = await bilan.finalize(index);
    expect(result).toMatchObject({ ok: true, demo: false, reportType: 'initial' });
    expect(db.fns.deleteDraft).toHaveBeenCalledTimes(2);
    expect(db.assessments.get(patientId)).toHaveLength(1);
    expect(bilan.getState().patient).toEqual(initialPatient);
  });

  it('saves the draft of an existing patient whose identity is incomplete', async () => {
    const { bilan, db } = ctx;
    const oldFile: Patient = { ...identity, id: 'ancien', dob: '' };
    db.addPatient(oldFile, [reference]);
    expect(await bilan.start('reevaluation', oldFile)).toEqual({ ok: true });

    expect(await bilan.saveAndClose()).toEqual({ ok: true });
    expect(db.drafts.get('ancien')?.reportType).toBe('reevaluation');
  });

  it('reports a failed save without closing the assessment', async () => {
    const { bilan, db } = ctx;
    bilan.updatePatient(identity);
    db.fns.addAssessment.mockRejectedValueOnce(new Error('IDB_WRITE'));

    expect(await bilan.finalize(index)).toEqual({ ok: false, reason: 'save-failed' });
    expect(bilan.getState().patient.firstName).toBe('Sarah');
  });

  it('applies the AI result without losing edits made during the generation', async () => {
    const { bilan } = ctx;
    bilan.updateTests({
      mabc: { dext: { value: '7', unit: 'NS', observation: 'lent' }, balle: { value: '10', unit: 'NS', observation: 'rate' } },
    });
    const ticket = bilan.beginGeneration();

    // During the generation: a score and an observation are edited.
    const during = bilan.getState().tests;
    bilan.updateTests({
      mabc: { dext: { ...during.mabc.dext, value: '8' }, balle: { ...during.mabc.balle, observation: 'attrape à deux mains' } },
    });

    const applied = bilan.applyGeneratedReport(ticket, {
      sections: [section('diagnostic')],
      reformulatedObservations: { dext: 'Geste lent et appliqué.', balle: 'Réceptions souvent manquées.' },
    });
    expect(applied).toBe(true);
    const { tests, sections } = bilan.getState();
    expect(tests.mabc.dext.value).toBe('8');
    expect(tests.mabc.dext.observation).toBe('Geste lent et appliqué.');
    expect(tests.mabc.balle.observation).toBe('attrape à deux mains');
    expect(sections.map((s) => s.id)).toEqual(['diagnostic']);
  });

  it('drops an AI result that arrives after the assessment was closed', async () => {
    const { bilan } = ctx;
    const ticket = bilan.beginGeneration();
    await bilan.discard();
    expect(bilan.applyGeneratedReport(ticket, { sections: [section('diagnostic')] })).toBe(false);
    expect(bilan.getState().sections).toEqual([]);
  });

  it('discards: deletes the draft and returns to the initial state', async () => {
    const { bilan, db } = ctx;
    bilan.updatePatient(identity);
    await settle();
    const patientId = bilan.getState().patient.id!;
    db.drafts.set(patientId, { patient: bilan.getState().patient });

    expect(await bilan.discard()).toBe(true);
    expect(db.drafts.has(patientId)).toBe(false);
    expect(bilan.getState().patient).toEqual(initialPatient);
  });

  it('imports the family file as a new initial assessment, and rolls back when the commit fails', async () => {
    const { bilan, db } = ctx;
    const family = { ...identity, reason: 'Écriture difficile' };

    expect(await bilan.importFamily({ patient: family }, async () => {})).toEqual({ ok: true });
    const state = bilan.getState();
    expect(state.patient.id).toBe('p1');
    expect(state.patient.reason).toBe('Écriture difficile');
    expect(state.reportType).toBe('initial');
    expect(state.step).toBe(1);
    expect(db.drafts.get('p1')?.reportType).toBe('initial');

    const failing = await bilan.importFamily({ patient: family }, async () => {
      throw new Error('SUPABASE_DELETE');
    });
    expect(failing).toEqual({ ok: false, reason: 'error' });
    expect(db.patients.has('p2')).toBe(false);
    expect(bilan.getState().patient.id).toBe('p1'); // the current assessment is untouched
  });

  it('writes nothing in demo mode', async () => {
    const demo = setup({ demo: true });
    const { bilan, db, timers } = demo;
    await bilan.importFamily({ patient: { ...identity, id: 'demo-elya' }, tests: reference.tests });
    bilan.updateObservations({ anamnese: 'démo' });
    await timers.flush();
    expect(await bilan.resume('demo-elya', { stale: false })).toEqual({ ok: false, reason: 'demo' });
    expect(await bilan.saveAndClose()).toEqual({ ok: true });
    expect(await bilan.finalize(index)).toEqual({ ok: true, demo: true });

    expect(timers.pending()).toBe(0);
    for (const fn of [db.fns.createPatient, db.fns.saveDraft, db.fns.deleteDraft, db.fns.addAssessment, db.fns.upsertPatientFollowup]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
