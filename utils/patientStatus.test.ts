import { describe, expect, it } from 'vitest';
import type { DashboardDraftMeta, Patient, PatientAssessment, PatientFile, PatientFollowup } from '../types';
import {
  buildPreviewMeta,
  defaultScheduledDueAt,
  derivePatientStatus,
  reminderDueAt,
  resolveReminderStatus,
  snoozeEndAt,
  temporalReminderStatus,
} from './patientStatus';

const NOW = new Date('2026-09-29T12:00:00.000Z');

const patient = { firstName: 'Léa', lastName: 'Martin' } as Patient;

const assessment = (date: string, kind: 'initial' | 'reevaluation', hasFormalReport = true): PatientAssessment => ({
  id: `${kind}-${date}`,
  date,
  kind,
  hasFormalReport,
});

const fileWith = (assessments: PatientAssessment[], extra: Partial<PatientFile> = {}): PatientFile => ({
  id: 'p1',
  patient,
  assessments,
  lastInteraction: NOW.toISOString(),
  ...extra,
});

const draft = (reportType: DashboardDraftMeta['reportType']): DashboardDraftMeta => ({ reportType, step: 2 }) as DashboardDraftMeta;

describe('buildPreviewMeta', () => {
  it('follows the file from creation to the first formal assessment', () => {
    expect(buildPreviewMeta(patient, [], false).workflow.progressLabel).toBe('created');
    expect(buildPreviewMeta({ ...patient, school: 'École A' }, [], false).workflow).toEqual({
      progressLabel: 'infos_recues',
      statusTone: 'warning',
    });
    expect(buildPreviewMeta(patient, [assessment('2026-01-10', 'initial', false)], false).workflow.progressLabel).toBe('tests_saisis');
    expect(buildPreviewMeta(patient, [assessment('2026-01-10', 'initial')], false).workflow).toEqual({
      progressLabel: 'termine',
      statusTone: 'success',
    });
  });

  it('counts formal assessments and keeps the latest dates', () => {
    const meta = buildPreviewMeta(
      patient,
      [assessment('2025-03-01', 'initial'), assessment('2026-02-01', 'reevaluation'), assessment('2026-05-01', 'initial', false)],
      true,
    );
    expect(meta.metrics).toEqual({
      assessmentsCount: 3,
      formalReportsCount: 2,
      lastAssessmentDate: new Date('2026-05-01').toISOString(),
      lastFormalReportDate: new Date('2026-02-01').toISOString(),
    });
    expect(meta.flags).toEqual({ _archived: true, hasInitialReport: true, hasReevaluationOpportunity: false });
  });
});

describe('re-evaluation reminder', () => {
  // Months are added in local time, like the practitioner's calendar.
  it('is due six months after the assessment', () => {
    expect(reminderDueAt(new Date(2026, 2, 15).toISOString())).toBe(new Date(2026, 8, 15).toISOString());
  });

  it('is scheduled or postponed one month ahead', () => {
    const today = new Date(2026, 8, 29);
    expect(defaultScheduledDueAt(today)).toBe(new Date(2026, 9, 29).toISOString());
    expect(snoozeEndAt(today)).toBe(new Date(2026, 9, 29).toISOString());
  });

  it('is upcoming, then to schedule for six months, then overdue', () => {
    expect(temporalReminderStatus('2026-10-01T00:00:00.000Z', NOW)).toBe('upcoming');
    expect(temporalReminderStatus('2026-09-01T00:00:00.000Z', NOW)).toBe('due');
    expect(temporalReminderStatus('2026-04-01T00:00:00.000Z', NOW)).toBe('due');
    expect(temporalReminderStatus('2026-03-01T00:00:00.000Z', NOW)).toBe('overdue');
  });

  it('keeps a snooze until it expires, then falls back to the due date', () => {
    const dueAt = '2026-06-01T00:00:00.000Z';
    expect(resolveReminderStatus({ status: 'snoozed', dueAt, snoozedUntil: '2026-10-15T00:00:00.000Z' }, NOW)).toBe('snoozed');
    expect(resolveReminderStatus({ status: 'snoozed', dueAt, snoozedUntil: '2026-09-15T00:00:00.000Z' }, NOW)).toBe('due');
    expect(resolveReminderStatus({ status: 'scheduled', dueAt }, NOW)).toBe('scheduled');
    expect(resolveReminderStatus({ status: 'upcoming', dueAt: '2025-01-01T00:00:00.000Z' }, NOW)).toBe('overdue');
  });
});

describe('derivePatientStatus', () => {
  it('derives the reminder from the last formal assessment, whatever its kind', () => {
    const lastFormal = new Date(2026, 1, 10).toISOString();
    const status = derivePatientStatus(fileWith([assessment('2025-01-10', 'initial'), assessment(lastFormal, 'reevaluation')]), null, NOW);
    expect(status.hasFormalReport).toBe(true);
    expect(status.reminder).toMatchObject({ status: 'due', dueAt: new Date(2026, 7, 10).toISOString() });
  });

  it('prefers the stored reminder', () => {
    const stored = { id: 'f1', status: 'scheduled', dueAt: '2026-11-01T00:00:00.000Z' } as PatientFollowup;
    expect(derivePatientStatus(fileWith([assessment('2025-01-10', 'initial')], { followup: stored }), null, NOW).reminder).toBe(stored);
  });

  it('has no reminder without a formal assessment or when archived', () => {
    expect(derivePatientStatus(fileWith([]), null, NOW).reminder).toBeNull();
    const stored = { id: 'f1', status: 'due', dueAt: '2026-09-01T00:00:00.000Z' } as PatientFollowup;
    expect(
      derivePatientStatus(fileWith([assessment('2025-01-10', 'initial')], { archived: true, followup: stored }), null, NOW).reminder,
    ).toBeNull();
  });

  it('reads the cached preview when the assessments are not loaded', () => {
    const previewMeta = buildPreviewMeta(patient, [assessment('2026-06-01', 'initial')], false);
    const status = derivePatientStatus(fileWith([], { previewMeta }), null, NOW);
    expect(status.hasFormalReport).toBe(true);
    expect(status.reminder?.status).toBe('upcoming');
  });

  it('marks an initial or historical draft stale once a formal assessment exists', () => {
    const formal = fileWith([assessment('2026-01-10', 'initial')]);
    expect(derivePatientStatus(formal, draft('initial'), NOW).draft?.stale).toBe(true);
    expect(derivePatientStatus(formal, draft('historique'), NOW).draft?.stale).toBe(true);
    expect(derivePatientStatus(formal, draft('reevaluation'), NOW).draft?.stale).toBe(false);
    expect(derivePatientStatus(fileWith([]), draft('initial'), NOW).draft?.stale).toBe(false);
    expect(derivePatientStatus(formal, null, NOW).draft).toBeNull();
  });
});
