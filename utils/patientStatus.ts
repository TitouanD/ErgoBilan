/**
 * Patient status: what the dashboard, the patient record and the draft resume show about a patient,
 * derived from its assessments, its stored re-evaluation reminder and its draft (see CONTEXT.md:
 * « Rappel de réévaluation », « Brouillon périmé »). Pure: `now` is always passed in.
 *
 * - `buildPreviewMeta`: the dashboard preview cached on the patient row (the patient list does not
 *   load assessments), computed by StorageService on every write.
 * - `derivePatientStatus`: the status read by the screens, from a patient file and its draft.
 */

import type {
  DashboardDraftMeta,
  Patient,
  PatientAssessment,
  PatientDashboardPreviewMeta,
  PatientFile,
  PatientFollowup,
  PatientFollowupStatus,
} from '../types';

/** A re-evaluation is due this long after the last formal assessment. */
const REEVALUATION_DELAY_MONTHS = 6;
/** The reminder is overdue this long after its due date. */
const OVERDUE_AFTER_MONTHS = 6;
/** « Reporter » postpones the reminder by this much. */
const SNOOZE_MONTHS = 1;
/** « Planifier » without a due date schedules the reminder this far ahead. */
const DEFAULT_SCHEDULE_MONTHS = 1;

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

const latestDate = (dates: string[]): string | null => {
  const times = dates.map((value) => parseDate(value)?.getTime()).filter((t): t is number => t !== undefined);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
};

// ─── Preview cached on the patient row ────────────────────────────────────────

const buildWorkflow = (patient: Patient, metrics: PatientDashboardPreviewMeta['metrics']): PatientDashboardPreviewMeta['workflow'] => {
  if (metrics.formalReportsCount > 0) return { progressLabel: 'termine', statusTone: 'success' };
  // Non-formal assessments only come from old data or imports.
  if (metrics.assessmentsCount > 0) return { progressLabel: 'tests_saisis', statusTone: 'neutral' };
  const hasInitialInfos = Boolean(patient.reason || patient.school || patient.familyExpectations || patient.classLevel);
  return { progressLabel: hasInitialInfos ? 'infos_recues' : 'created', statusTone: 'warning' };
};

export const buildPreviewMeta = (
  patient: Patient,
  assessments: PatientAssessment[],
  archived: boolean | undefined,
): PatientDashboardPreviewMeta => {
  const formal = assessments.filter((a) => a.hasFormalReport);
  const hasInitialReport = formal.some((a) => a.kind === 'initial');
  const hasReevaluationReport = formal.some((a) => a.kind === 'reevaluation');
  const metrics: PatientDashboardPreviewMeta['metrics'] = {
    assessmentsCount: assessments.length,
    formalReportsCount: formal.length,
    lastAssessmentDate: latestDate(assessments.map((a) => a.date)),
    lastFormalReportDate: latestDate(formal.map((a) => a.date)),
  };
  return {
    uiVersion: 2,
    workflow: buildWorkflow(patient, metrics),
    metrics,
    flags: {
      _archived: archived === true,
      hasInitialReport,
      hasReevaluationOpportunity: hasInitialReport && !hasReevaluationReport,
    },
  };
};

/** The cached preview, or one computed from the loaded assessments for a row saved without it. */
export const previewMetaOf = (file: PatientFile): PatientDashboardPreviewMeta =>
  file.previewMeta ?? buildPreviewMeta(file.patient, file.assessments ?? [], file.archived);

// ─── Re-evaluation reminder ───────────────────────────────────────────────────

/** Due date of the reminder created when an assessment dated `assessmentDate` is finalized. */
export const reminderDueAt = (assessmentDate: string | Date): string =>
  addMonths(new Date(assessmentDate), REEVALUATION_DELAY_MONTHS).toISOString();

/** Due date given by « Planifier » when the reminder has none. */
export const defaultScheduledDueAt = (now: Date): string => addMonths(now, DEFAULT_SCHEDULE_MONTHS).toISOString();

/** End of the postponement given by « Reporter ». */
export const snoozeEndAt = (now: Date): string => addMonths(now, SNOOZE_MONTHS).toISOString();

/** Status from the due date alone: à venir, à planifier, puis en retard. */
export const temporalReminderStatus = (dueAt: string, now: Date): 'upcoming' | 'due' | 'overdue' => {
  const due = parseDate(dueAt);
  if (!due) return 'upcoming';
  if (now < due) return 'upcoming';
  if (now <= addMonths(due, OVERDUE_AFTER_MONTHS)) return 'due';
  return 'overdue';
};

/** Status of a stored reminder: a snooze that has expired falls back to the due date. */
export const resolveReminderStatus = (
  stored: { status: PatientFollowupStatus; dueAt: string; snoozedUntil?: string | null },
  now: Date,
): PatientFollowupStatus => {
  if (stored.status === 'completed' || stored.status === 'scheduled') return stored.status;
  if (stored.status === 'snoozed') {
    const until = parseDate(stored.snoozedUntil);
    if (until && now < until) return 'snoozed';
  }
  return temporalReminderStatus(stored.dueAt, now);
};

/**
 * The patient's reminder: the stored one, or else one due six months after the last formal
 * assessment. An archived patient has none.
 */
const deriveReminder = (file: PatientFile, preview: PatientDashboardPreviewMeta, now: Date): PatientFollowup | null => {
  if (file.archived) return null;
  if (file.followup) return file.followup;
  const lastFormal = preview.metrics.lastFormalReportDate;
  const lastFormalDate = parseDate(lastFormal);
  if (!lastFormal || !lastFormalDate) return null;
  const dueAt = reminderDueAt(lastFormalDate);
  return {
    id: `derived-${file.id}`,
    patientId: file.id,
    organizationId: null,
    status: temporalReminderStatus(dueAt, now),
    dueAt,
    snoozedUntil: null,
    note: null,
    createdAt: lastFormal,
    updatedAt: lastFormal,
  };
};

// ─── Draft ────────────────────────────────────────────────────────────────────

/** Initial/historical draft left behind although the patient already has a formal report. */
const isStaleDraft = (meta: DashboardDraftMeta | undefined | null, hasFormalReport: boolean): boolean =>
  Boolean(meta) && hasFormalReport && meta!.reportType !== 'reevaluation';

// ─── Status read by the screens ───────────────────────────────────────────────

export interface PatientStatus {
  preview: PatientDashboardPreviewMeta;
  /** At least one formal assessment. */
  hasFormalReport: boolean;
  reminder: PatientFollowup | null;
  draft: { meta: DashboardDraftMeta; stale: boolean } | null;
}

export const derivePatientStatus = (file: PatientFile, draftMeta: DashboardDraftMeta | undefined | null, now: Date): PatientStatus => {
  const preview = previewMetaOf(file);
  const hasFormalReport = preview.metrics.formalReportsCount > 0;
  return {
    preview,
    hasFormalReport,
    reminder: deriveReminder(file, preview, now),
    draft: draftMeta ? { meta: draftMeta, stale: isStaleDraft(draftMeta, hasFormalReport) } : null,
  };
};
