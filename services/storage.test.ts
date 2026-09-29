import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getLocalDB, type LocalPatientRow } from './localDB';
import { StorageService } from './storage';

const USER = 'test-user-67';
const meta = { flags: { hasInitialReport: true } } as unknown as LocalPatientRow['previewMeta'];

const row = (id: string, lastInteraction: string | undefined, archived = false): LocalPatientRow =>
  ({
    id,
    patient: { firstName: id } as LocalPatientRow['patient'],
    archived,
    lastInteraction,
    previewMeta: meta,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as LocalPatientRow;

// Unsorted on purpose, with ties on lastInteraction (Dexie then orders by id)
// and a row without lastInteraction (absent from the index, never listed).
const ROWS: LocalPatientRow[] = [
  row('p3', '2026-03-01T10:00:00.000Z'),
  row('p1', '2026-05-01T10:00:00.000Z', true),
  row('p7', '2026-01-01T10:00:00.000Z'),
  row('p2', '2026-04-01T10:00:00.000Z'),
  row('p5', '2026-04-01T10:00:00.000Z'),
  row('p4', '2026-02-01T10:00:00.000Z'),
  row('p6', '2026-04-01T10:00:00.000Z'),
  row('p8', undefined),
];
// lastInteraction descending, ties by id descending.
const EXPECTED = ['p1', 'p6', 'p5', 'p2', 'p3', 'p4', 'p7'];

beforeAll(async () => {
  StorageService.setDemoMode(false);
  StorageService.setCurrentUser(USER);
  const db = getLocalDB(USER);
  await db.patients.bulkPut(ROWS);
  await db.followups.put({
    id: 'f5',
    patientId: 'p5',
    status: 'scheduled',
    dueAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as never);
});

afterAll(() => StorageService.reset());

describe('StorageService.loadPatientListPage', () => {
  it('pagine par lastInteraction décroissant, hasMore et nextOffset exacts', async () => {
    const p1 = await StorageService.loadPatientListPage({ offset: 0, limit: 3 });
    expect(p1.files.map((f) => f.id)).toEqual(EXPECTED.slice(0, 3));
    expect(p1).toMatchObject({ hasMore: true, nextOffset: 3 });

    const p2 = await StorageService.loadPatientListPage({ offset: p1.nextOffset, limit: 3 });
    expect(p2.files.map((f) => f.id)).toEqual(EXPECTED.slice(3, 6));
    expect(p2).toMatchObject({ hasMore: true, nextOffset: 6 });

    const p3 = await StorageService.loadPatientListPage({ offset: p2.nextOffset, limit: 3 });
    expect(p3.files.map((f) => f.id)).toEqual(EXPECTED.slice(6));
    expect(p3).toMatchObject({ hasMore: false, nextOffset: 9 });
  });

  it('hasMore est faux quand la page tombe pile sur la fin, et au-delà de la fin', async () => {
    const exact = await StorageService.loadPatientListPage({ offset: 0, limit: 7 });
    expect(exact.files.map((f) => f.id)).toEqual(EXPECTED);
    expect(exact).toMatchObject({ hasMore: false, nextOffset: 7 });

    const beyond = await StorageService.loadPatientListPage({ offset: 20, limit: 3 });
    expect(beyond).toEqual({ files: [], hasMore: false, nextOffset: 23 });
  });

  it('page par défaut (50) : tout, archivés compris, avec le suivi joint', async () => {
    const all = await StorageService.loadPatientListPage();
    expect(all.files.map((f) => f.id)).toEqual(EXPECTED);
    expect(all).toMatchObject({ hasMore: false, nextOffset: 50 });
    const byId = new Map(all.files.map((f) => [f.id, f]));
    expect(byId.get('p1')?.archived).toBe(true);
    expect(byId.get('p5')?.followup).toMatchObject({ id: 'f5', dueAt: '2026-06-01T00:00:00.000Z' });
    expect(byId.get('p6')?.followup).toBeNull();
    expect(byId.get('p6')?.assessments).toEqual([]);
  });
});
