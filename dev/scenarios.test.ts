import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_CATALOG } from '../data/demoCatalog';
import { createDemoTransport } from '../data/demoReport';
import { StorageService } from '../services/storage';
import { buildCatalogIndex, getScaleType } from '../utils/catalogIndex';
import { isAdministrativeSectionReady } from '../utils/patient';
import { derivePatientStatus } from '../utils/patientStatus';
import { createReportGenerator } from '../utils/reportGenerator';
import { getZFromScore, zoneFromZ } from '../utils/scoring';
import { FICTIVE_PROFILES, FICTIF_LAST_NAME, getFictiveProfile } from './fictivePatients';
import { buildFictiveTests } from './fictiveScores';
import { parseScenario, runScenario, type Scenario } from './scenarios';

const index = buildCatalogIndex(DEMO_CATALOG);
const NOW = new Date('2026-10-01T10:00:00.000Z');
const deps = () => ({ store: StorageService, index, generator: createReportGenerator(createDemoTransport(0)), now: NOW });

const scenarioOf = (search: string): Scenario => {
  const parsed = parseScenario(search);
  if (!parsed?.ok) throw new Error(`invalid: ${search}`);
  return parsed.scenario;
};

let user = 0;
beforeEach(() => {
  StorageService.setDemoMode(false);
  StorageService.setCurrentUser(`scenario-user-${(user += 1)}`);
});

const allFiles = async () => (await StorageService.loadPatientListPage({ limit: 1000 })).files;

describe('parseScenario', () => {
  it('returns null without a scenario', () => {
    expect(parseScenario('?foo=1')).toBeNull();
  });

  it('applies the defaults and the aliases', () => {
    expect(scenarioOf('?scenario=initial')).toMatchObject({ name: 'initial', step: 2, fill: 'zones', tests: null });
    expect(scenarioOf('?scenario=initial-validation')).toMatchObject({ name: 'initial', step: 4 });
    expect(scenarioOf('?scenario=dashboard').questionnaires).toBe(false);
    expect(scenarioOf('?scenario=dashboard&questionnaires=oui').questionnaires).toBe(true);
    expect(scenarioOf('?scenario=reeval-scores').profile.id).toBe('lina');
    expect(scenarioOf('?scenario=historique&etape=3&patient=noah&scores=vide&tests=bhk')).toMatchObject({
      name: 'historique',
      step: 3,
      fill: 'vide',
      tests: 'bhk',
    });
  });

  it('opens the pricing modal with abonnement or &modale= (#103)', () => {
    expect(scenarioOf('?scenario=dashboard')).toMatchObject({ modal: null });
    expect(scenarioOf('?scenario=abonnement')).toMatchObject({ name: 'dashboard', modal: 'plans' });
    expect(scenarioOf('?scenario=initial&etape=5&modale=paywall')).toMatchObject({ name: 'initial', step: 5, modal: 'paywall' });
    expect(parseScenario('?scenario=dashboard&modale=nope')).toMatchObject({ ok: false });
  });

  it('rejects an unknown scenario, step or patient', () => {
    expect(parseScenario('?scenario=nope')).toMatchObject({ ok: false });
    expect(parseScenario('?scenario=reeval&etape=5')).toMatchObject({ ok: false });
    expect(parseScenario('?scenario=initial&patient=nobody')).toMatchObject({ ok: false });
  });
});

describe('fictitious patients', () => {
  it('fill every step 1 required field, with the FICTIF last name', () => {
    for (const { patient } of FICTIVE_PROFILES) {
      expect(isAdministrativeSectionReady(patient)).toBe(true);
      expect(patient.lastName).toBe(FICTIF_LAST_NAME);
    }
  });

  it('get scores in every zone, and empty scores with scores=vide', () => {
    const leo = getFictiveProfile('leo')!;
    const { tests, missing } = buildFictiveTests(index, leo.tests, { level: leo.level, fill: 'zones' });
    const zones = new Set(
      Object.entries(tests).flatMap(([testId, subtests]) =>
        Object.entries(subtests).map(([subId, score]) => zoneFromZ(getZFromScore(score, getScaleType(index, testId, subId)))),
      ),
    );
    expect(zones).toEqual(new Set(['deficit', 'fragile', 'normal', null])); // null: the free observation
    // MABC-2 age band 2 is absent from the demo catalogue (only its composites are there).
    expect(missing).toContain('mabc-2:mabc-2__lacing');

    const empty = buildFictiveTests(index, leo.tests, { level: leo.level, fill: 'vide' }).tests;
    expect(empty.bhk).toEqual({ bhk__quality: {}, bhk__speed: {} });
  });
});

describe('runScenario', () => {
  it('initial at step 4: a draft with the scores and the generated sections, resumed by the app', async () => {
    const result = await runScenario(scenarioOf('?scenario=initial&etape=4'), deps());
    const draft = await StorageService.getDraft(result.open!);
    expect(draft).toMatchObject({ reportType: 'initial', step: 4, patient: { firstName: 'Léo', lastName: FICTIF_LAST_NAME } });
    expect(Object.keys(draft!.tests!)).toEqual(expect.arrayContaining(['bhk', 'mabc-2', 'custom_observations']));
    expect(draft!.sections!.length).toBeGreaterThan(0);
    expect(draft!.sections!.every((s) => s.content.trim().length > 0)).toBe(true);
  });

  it('reloading the same scenario replaces its patient instead of adding one', async () => {
    await runScenario(scenarioOf('?scenario=initial'), deps());
    await runScenario(scenarioOf('?scenario=reeval'), deps());
    await runScenario(scenarioOf('?scenario=initial'), deps());
    const names = (await allFiles()).map((f) => f.patient.firstName).sort();
    expect(names).toEqual(['Lina', 'Léo']);
  });

  it('re-evaluation: a finalized reference and a draft pointing to it', async () => {
    const result = await runScenario(scenarioOf('?scenario=reeval&etape=3'), deps());
    const { assessments } = await StorageService.loadPatientDetails(result.open!);
    expect(assessments).toHaveLength(1);
    const draft = await StorageService.getDraft(result.open!);
    expect(draft).toMatchObject({ reportType: 'reevaluation', step: 3, previousAssessmentId: assessments[0].id });
    expect(draft!.sections!.length).toBeGreaterThan(0);
  });

  it('dashboard: one patient per status', async () => {
    await runScenario(scenarioOf('?scenario=initial&patient=noah'), deps());
    const result = await runScenario(scenarioOf('?scenario=dashboard'), deps());
    expect(result.open).toBeNull();

    const drafts = await StorageService.getDraftsMetadata();
    const status = Object.fromEntries(
      (await allFiles()).map((f) => {
        const s = derivePatientStatus(f, drafts[f.id], NOW);
        return [
          f.patient.firstName,
          { reminder: s.reminder?.status ?? null, draft: s.draft ? `${s.draft.meta.reportType}${s.draft.stale ? ' périmé' : ''}` : null },
        ];
      }),
    );
    expect(status).toEqual({
      Chloé: { reminder: 'overdue', draft: null },
      Inès: { reminder: 'due', draft: null },
      Léo: { reminder: 'upcoming', draft: null },
      Adam: { reminder: 'upcoming', draft: 'initial périmé' },
      Lina: { reminder: 'due', draft: 'reevaluation' },
      Noah: { reminder: null, draft: 'initial' },
    });
  });

  it('never touches a real patient', async () => {
    const realId = await StorageService.createPatient({ ...getFictiveProfile('leo')!.patient, lastName: 'Martin' });
    await runScenario(scenarioOf('?scenario=dashboard'), deps());
    expect((await allFiles()).some((f) => f.id === realId)).toBe(true);
  });
});

describe('buildFictiveTests : ordre des sous-tests (#90)', () => {
  it("ajoute un test entier dans l'ordre d'affichage du catalogue, pas dans celui renvoyé par la base", () => {
    const shuffled = buildCatalogIndex([
      {
        id: 'cat',
        name: 'Cat',
        iconKey: 'Box',
        sortOrder: 1,
        tests: [
          {
            id: 't',
            name: 'Test',
            subtests: [
              {
                id: 'indice',
                name: 'Indice',
                unit: '',
                scoreType: 'standard',
                inputModel: 'numeric_4mode',
                displayGroupOrder: 2,
                displayOrder: 3,
              },
              { id: 'b', name: 'B', unit: '', scoreType: 'scaled', inputModel: 'numeric_4mode', displayGroupOrder: 1, displayOrder: 2 },
              { id: 'a', name: 'A', unit: '', scoreType: 'scaled', inputModel: 'numeric_4mode', displayGroupOrder: 1, displayOrder: 1 },
            ],
          },
        ],
      },
    ]);
    const { tests } = buildFictiveTests(shuffled, [{ testId: 't' }], { level: 0, fill: 'vide' });
    expect(Object.keys(tests.t)).toEqual(['a', 'b', 'indice']);
  });
});
