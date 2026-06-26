/**
 * backupTracking — Tracks the last local backup date per user in localStorage.
 *
 * Key format: `ergobilan_last_backup_{userId}`
 * This is device-local and intentionally survives across sessions.
 */

const KEY_PREFIX = 'ergobilan_last_backup_';

export function setLastBackupDate(userId: string): void {
  localStorage.setItem(`${KEY_PREFIX}${userId}`, new Date().toISOString());
}

export function getLastBackupDate(userId: string): Date | null {
  const raw = localStorage.getItem(`${KEY_PREFIX}${userId}`);
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Returns number of full days since the last backup, or null if never backed up.
 */
export function getDaysSinceBackup(userId: string): number | null {
  const last = getLastBackupDate(userId);
  if (!last) return null;
  return Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Human-readable label for the last backup date.
 * e.g. "Aujourd'hui", "Il y a 3 jours", "Jamais"
 */
export function formatLastBackupLabel(date: Date | null): string {
  if (!date) return 'Aucun backup enregistré';
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Il y a 1 jour';
  return `Il y a ${days} jours`;
}
