/**
 * localDB — Dexie (IndexedDB) database for local-first PHI storage.
 * No data is sent to any server. Stores patients, drafts, assessments and
 * follow-ups — in plaintext for now (docs/TECH_DEBT.md P0-1).
 *
 * Supabase is still used for: auth, subscriptions, catalogue, portal questionnaires.
 *
 * Each practitioner gets a fully isolated database named `ErgoBilanDB_${userId}`.
 * Isolation is enforced at the DB level — no userId/orgId filtering in queries.
 * Organization info is non-medical and belongs on Supabase (practitioner profile only).
 */

import Dexie, { type Table } from 'dexie';
import type {
  DraftPayload,
  Patient,
  PatientAssessment,
  PatientDashboardPreviewMeta,
  PatientFollowupStatus,
} from '../types';
import { Logger } from '../utils/logger';

// ─── Row types ────────────────────────────────────────────────────────────────
// Note: no userId or organizationId — isolation is enforced by the per-user DB name.

export interface LocalPatientRow {
  /** UUID generated client-side via crypto.randomUUID() */
  id: string;
  patient: Patient;
  archived: boolean;
  lastInteraction: string; // ISO timestamp
  /** Computed preview metadata for dashboard cards */
  previewMeta?: PatientDashboardPreviewMeta;
  createdAt: string;
  updatedAt: string;
}

export interface LocalDraftRow {
  /** Auto-incremented primary key */
  id?: number;
  patientId: string;
  draftData: DraftPayload;
  updatedAt: string;
}

export interface LocalAssessmentRow {
  /** UUID generated client-side */
  id: string;
  patientId: string;
  kind: PatientAssessment['kind'];
  hasFormalReport: boolean;
  date: string; // ISO timestamp
  testName?: string;
  previousAssessmentId?: string;
  results?: PatientAssessment['results'];
  tests?: PatientAssessment['tests'];
  report?: PatientAssessment['report'];
  createdAt: string;
}

export interface LocalFollowupRow {
  /** UUID generated client-side */
  id: string;
  /** Unique per patient */
  patientId: string;
  organizationId?: string | null;
  status: PatientFollowupStatus;
  dueAt: string;
  snoozedUntil?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Dexie database definition ────────────────────────────────────────────────

class ErgoBilanDB extends Dexie {
  patients!: Table<LocalPatientRow>;
  drafts!: Table<LocalDraftRow>;
  assessments!: Table<LocalAssessmentRow>;
  followups!: Table<LocalFollowupRow>;

  constructor(userId: string) {
    super(`ErgoBilanDB_${userId}`);
    this.version(1).stores({
      patients: 'id, lastInteraction, archived',
      drafts: '++id, patientId, updatedAt',
      assessments: 'id, patientId, date',
      followups: 'id, &patientId',
    });
  }
}

// ─── Per-user instance cache ──────────────────────────────────────────────────

const _dbCache = new Map<string, ErgoBilanDB>();

export function getLocalDB(userId: string): ErgoBilanDB {
  let db = _dbCache.get(userId);
  if (!db) {
    db = new ErgoBilanDB(userId);
    _dbCache.set(userId, db);
  }
  return db;
}

/** Close a user's database and drop it from the cache (logout / lock). */
export function closeLocalDB(userId: string): void {
  const db = _dbCache.get(userId);
  if (!db) return;
  db.close();
  _dbCache.delete(userId);
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

/**
 * Minimal Dexie wrapper for the old global `ErgoBilanDB` (v1 schema).
 * Used only during one-time migration — never instantiated otherwise.
 */
class LegacyErgoBilanDB extends Dexie {
  patients!: Table<Record<string, unknown>>;
  drafts!: Table<Record<string, unknown>>;
  assessments!: Table<Record<string, unknown>>;
  followups!: Table<Record<string, unknown>>;

  constructor() {
    super('ErgoBilanDB');
    this.version(1).stores({
      patients: 'id, userId, organizationId, lastInteraction, archived',
      drafts: '++id, [userId+patientId], updatedAt',
      assessments: 'id, patientId, userId, date',
      followups: 'id, &patientId',
    });
  }
}

/**
 * Migrate data for `userId` from the legacy global `ErgoBilanDB` into the
 * new per-user `ErgoBilanDB_${userId}`. Deletes migrated rows from the legacy DB.
 * Safe to call multiple times — a no-op when the legacy DB does not exist or
 * contains no rows for this user.
 */
export const migrateLegacyDB = async (userId: string, targetDB: ErgoBilanDB): Promise<void> => {
  const legacyExists = await Dexie.exists('ErgoBilanDB');
  if (!legacyExists) return;

  const legacyDB = new LegacyErgoBilanDB();
  try {
    const patients = await legacyDB.patients.where('userId').equals(userId).toArray();

    if (patients.length === 0) return; // nothing to migrate for this user

    const ownedPatientIds = new Set(patients.map((p) => p.id as string));
    const [draftRows, assessments, allFollowups] = await Promise.all([
      // Drafts use a compound index — filter in memory (only migration path)
      legacyDB.drafts.toArray().then((rows) => rows.filter((r) => r.userId === userId)),
      legacyDB.assessments.where('userId').equals(userId).toArray(),
      legacyDB.followups.toArray(),
    ]);
    const followups = allFollowups.filter((f) => ownedPatientIds.has(f.patientId as string));

    // Write to new scoped DB, stripping userId + organizationId
    await targetDB.transaction('rw', [targetDB.patients, targetDB.drafts, targetDB.assessments, targetDB.followups], async () => {
      if (patients.length) {
        await targetDB.patients.bulkPut(
          patients.map(({ userId: _u, organizationId: _o, ...rest }) => rest as unknown as LocalPatientRow),
        );
      }
      if (assessments.length) {
        await targetDB.assessments.bulkPut(
          assessments.map(({ userId: _u, organizationId: _o, ...rest }) => rest as unknown as LocalAssessmentRow),
        );
      }
      if (followups.length) {
        await targetDB.followups.bulkPut(
          followups.map(({ organizationId: _o, ...rest }) => rest as unknown as LocalFollowupRow),
        );
      }
      if (draftRows.length) {
        await targetDB.drafts.bulkAdd(
          draftRows.map(({ id: _id, userId: _u, ...rest }) => rest as unknown as LocalDraftRow),
        );
      }
    });

    // Remove migrated rows from legacy DB
    await legacyDB.transaction('rw', [legacyDB.patients, legacyDB.drafts, legacyDB.assessments, legacyDB.followups], async () => {
      await legacyDB.patients.bulkDelete(patients.map((p) => p.id as string));
      await legacyDB.assessments.bulkDelete(assessments.map((a) => a.id as string));
      await legacyDB.drafts.bulkDelete(draftRows.map((d) => d.id as number));
      await legacyDB.followups.bulkDelete(followups.map((f) => f.id as string));
    });

    Logger.info('DB', 'Migrated patients from legacy ErgoBilanDB', { count: patients.length });
  } catch (e) {
    Logger.error('DB', 'Legacy migration failed — legacy DB left intact for manual recovery', e);
  } finally {
    legacyDB.close();
  }
};
