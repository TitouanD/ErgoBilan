/**
 * exportService — Local-first backup/restore for ErgoBilan.
 *
 * Exports all PHI from IndexedDB as a plain JSON `.ergobilan` file that the
 * practitioner downloads to their device. Importing merges the bundle back
 * into the practitioner's own scoped IndexedDB.
 *
 * ⚠️ The file is NOT encrypted — practitioners are responsible for keeping it
 *    safe (same as any local backup). Future: optional PIN-based AES-GCM wrap.
 */

import { getLocalDB, type LocalPatientRow, type LocalDraftRow, type LocalAssessmentRow, type LocalFollowupRow } from './localDB';
import { setLastBackupDate } from '../utils/backupTracking';

// ─── Bundle format ─────────────────────────────────────────────────────────────

const BUNDLE_VERSION = 1;

export interface ErgoExportBundle {
  version: typeof BUNDLE_VERSION;
  exportedAt: string; // ISO timestamp
  patients: LocalPatientRow[];
  drafts: Omit<LocalDraftRow, 'id'>[]; // id stripped — auto-increment on import
  assessments: LocalAssessmentRow[];
  followups: LocalFollowupRow[];
}

export interface ImportResult {
  patients: number;
  assessments: number;
  drafts: number;
  followups: number;
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const ExportService = {
  /**
   * Export all PHI for `userId` as a `.ergobilan` JSON file download.
   * Uses the per-user scoped DB — no cross-user data can be included.
   */
  async exportAll(userId: string): Promise<void> {
    const db = getLocalDB(userId);

    const [patients, draftsRaw, assessments, followups] = await Promise.all([
      db.patients.toArray(),
      db.drafts.toArray(),
      db.assessments.toArray(),
      db.followups.toArray(),
    ]);

    const bundle: ErgoExportBundle = {
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      patients,
      // Strip auto-increment id so Dexie can assign fresh keys on import
      drafts: draftsRaw.map(({ id: _id, ...rest }) => rest),
      assessments,
      followups,
    };

    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ergobilan-backup-${date}.ergobilan`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setLastBackupDate(userId);
  },

  /**
   * Import a `.ergobilan` bundle file into the current user's scoped DB.
   * - patients/assessments/followups: upsert by UUID (safe merge)
   * - drafts: delete existing for affected patientIds, then re-add
   *
   * @returns counts of imported rows per table
   */
  async importFromFile(file: File, currentUserId: string): Promise<ImportResult> {
    let bundle: ErgoExportBundle;

    try {
      const text = await file.text();
      bundle = JSON.parse(text) as ErgoExportBundle;
    } catch {
      throw new Error('Fichier invalide ou corrompu.');
    }

    if (bundle.version !== BUNDLE_VERSION) {
      throw new Error(`Format non supporté (version ${bundle.version}). Veuillez utiliser une version récente d'ErgoBilan.`);
    }

    if (!Array.isArray(bundle.patients)) {
      throw new Error('Structure du bundle incorrecte.');
    }

    const patients = bundle.patients ?? [];
    const drafts = bundle.drafts ?? [];
    const assessments = bundle.assessments ?? [];
    const followups = bundle.followups ?? [];

    const db = getLocalDB(currentUserId);

    await db.transaction('rw', [db.patients, db.drafts, db.assessments, db.followups], async () => {
      // Upsert by UUID
      if (patients.length) await db.patients.bulkPut(patients);
      if (assessments.length) await db.assessments.bulkPut(assessments);
      if (followups.length) await db.followups.bulkPut(followups);

      // Drafts: delete existing rows for the imported patientIds, then re-add
      if (drafts.length) {
        const importedPatientIds = new Set(drafts.map((d) => d.patientId));
        const toDelete = (await db.drafts.toArray()).filter((d) => importedPatientIds.has(d.patientId)).map((d) => d.id!);

        if (toDelete.length) await db.drafts.bulkDelete(toDelete);
        await db.drafts.bulkAdd(drafts as LocalDraftRow[]);
      }
    });

    return {
      patients: patients.length,
      assessments: assessments.length,
      drafts: drafts.length,
      followups: followups.length,
    };
  },

  /**
   * Validate that a File looks like a valid `.ergobilan` bundle without importing.
   * Useful for showing a preview before confirming the import.
   */
  async peekBundle(file: File): Promise<Pick<ErgoExportBundle, 'exportedAt'> & ImportResult> {
    let bundle: ErgoExportBundle;
    try {
      bundle = JSON.parse(await file.text()) as ErgoExportBundle;
    } catch {
      throw new Error('Fichier invalide ou corrompu.');
    }
    if (bundle.version !== BUNDLE_VERSION) {
      throw new Error(`Format non supporté (version ${bundle.version}).`);
    }
    return {
      exportedAt: bundle.exportedAt,
      patients: (bundle.patients ?? []).length,
      assessments: (bundle.assessments ?? []).length,
      drafts: (bundle.drafts ?? []).length,
      followups: (bundle.followups ?? []).length,
    };
  },
};
