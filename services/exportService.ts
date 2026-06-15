/**
 * exportService — Local-first backup/restore for ErgoBilan.
 *
 * Exports all PHI from IndexedDB as a plain JSON `.ergobilan` file that the
 * practitioner downloads to their device. Importing merges the bundle back
 * into IndexedDB (upsert by UUID for patients/assessments/followups, replace
 * by [userId+patientId] for auto-increment drafts).
 *
 * ⚠️ The file is NOT encrypted — practitioners are responsible for keeping it
 *    safe (same as any local backup). Future: optional PIN-based AES-GCM wrap.
 */

import { localDB, type LocalPatientRow, type LocalDraftRow, type LocalAssessmentRow, type LocalFollowupRow } from './localDB';

// ─── Bundle format ─────────────────────────────────────────────────────────────

const BUNDLE_VERSION = 1;

export interface ErgoExportBundle {
  version: typeof BUNDLE_VERSION;
  exportedAt: string; // ISO timestamp
  userId: string;
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
   * Export all PHI owned by `userId` as a `.ergobilan` JSON file download.
   */
  async exportAll(userId: string): Promise<void> {
    const allDrafts = await localDB.drafts.toArray();
    const userDrafts = allDrafts.filter((d) => d.userId === userId);

    const [patients, assessments, followups] = await Promise.all([
      localDB.patients.where('userId').equals(userId).toArray(),
      localDB.assessments.where('userId').equals(userId).toArray(),
      localDB.followups.toArray(),
    ]);

    // Followups don't have a userId column — filter via patient ownership
    const ownedPatientIds = new Set(patients.map((p) => p.id));
    const userFollowups = followups.filter((f) => ownedPatientIds.has(f.patientId));

    const bundle: ErgoExportBundle = {
      version: BUNDLE_VERSION,
      exportedAt: new Date().toISOString(),
      userId,
      patients,
      // Strip auto-increment id so Dexie can assign fresh keys on import
      drafts: userDrafts.map(({ id: _id, ...rest }) => rest),
      assessments,
      followups: userFollowups,
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
  },

  /**
   * Import a `.ergobilan` bundle file.
   * - patients/assessments/followups: upsert by UUID (safe merge)
   * - drafts: delete existing for affected [userId+patientId] pairs, then re-add
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

    await localDB.transaction(
      'rw',
      [localDB.patients, localDB.drafts, localDB.assessments, localDB.followups],
      async () => {
        // Upsert by UUID
        if (patients.length) await localDB.patients.bulkPut(patients);
        if (assessments.length) await localDB.assessments.bulkPut(assessments);
        if (followups.length) await localDB.followups.bulkPut(followups);

        // Drafts: delete existing rows that the bundle would overwrite, then re-add
        if (drafts.length) {
          const allExisting = await localDB.drafts.toArray();
          const importedPatientIds = new Set(drafts.map((d) => d.patientId));
          const toDelete = allExisting
            .filter((d) => d.userId === currentUserId && importedPatientIds.has(d.patientId))
            .map((d) => d.id!);

          if (toDelete.length) await localDB.drafts.bulkDelete(toDelete);
          await localDB.drafts.bulkAdd(drafts as LocalDraftRow[]);
        }
      },
    );

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
  async peekBundle(file: File): Promise<Pick<ErgoExportBundle, 'exportedAt' | 'userId'> & ImportResult> {
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
      userId: bundle.userId,
      patients: (bundle.patients ?? []).length,
      assessments: (bundle.assessments ?? []).length,
      drafts: (bundle.drafts ?? []).length,
      followups: (bundle.followups ?? []).length,
    };
  },
};
