/**
 * localDB — Dexie (IndexedDB) database for local-first PHI storage.
 * No data is sent to any server. Replaces Supabase for:
 *   patients, drafts, patient_assessments, patient_followups
 *
 * Supabase is still used for: auth, subscriptions, catalogue, portal questionnaires.
 */

import Dexie, { type Table } from 'dexie';
import type {
  DraftPayload,
  Patient,
  PatientAssessment,
  PatientDashboardPreviewMeta,
  PatientFollowupStatus,
} from '../types';

// ─── Row types ────────────────────────────────────────────────────────────────

export interface LocalPatientRow {
  /** UUID generated client-side via crypto.randomUUID() */
  id: string;
  /** Supabase auth.users.id of the practitioner who owns this patient */
  userId: string;
  /** Organization ID (reserved for future multi-practitioner cabinet feature) */
  organizationId?: string;
  patient: Patient;
  archived: boolean;
  lastInteraction: string; // ISO timestamp
  /** Computed preview metadata for dashboard cards (no decryption needed) */
  previewMeta?: PatientDashboardPreviewMeta;
  createdAt: string;
  updatedAt: string;
}

export interface LocalDraftRow {
  /** Auto-incremented primary key */
  id?: number;
  userId: string;
  patientId: string;
  draftData: DraftPayload;
  updatedAt: string;
}

export interface LocalAssessmentRow {
  /** UUID generated client-side */
  id: string;
  patientId: string;
  organizationId?: string;
  userId: string;
  kind: PatientAssessment['kind'];
  hasFormalReport: boolean;
  date: string; // ISO timestamp
  testName?: string;
  results?: PatientAssessment['results'];
  report?: PatientAssessment['report'];
  createdAt: string;
}

export interface LocalFollowupRow {
  /** UUID generated client-side */
  id: string;
  /** Unique per patient */
  patientId: string;
  organizationId?: string;
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

  constructor() {
    super('ErgoBilanDB');
    this.version(1).stores({
      // patients: indexed by userId (multi-entry queries) + lastInteraction (sort)
      patients: 'id, userId, organizationId, lastInteraction, archived',
      // drafts: auto-increment PK + compound index for user+patient lookup
      drafts: '++id, [userId+patientId], updatedAt',
      // assessments: indexed by patientId for history queries
      assessments: 'id, patientId, userId, date',
      // followups: patientId is unique (one followup per patient)
      followups: 'id, &patientId',
    });
  }
}

export const localDB = new ErgoBilanDB();
