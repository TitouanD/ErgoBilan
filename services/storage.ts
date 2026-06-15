/**
 * StorageService — Local-first storage layer.
 *
 * All PHI (patients, drafts, assessments, followups) is stored in IndexedDB via
 * Dexie (see services/localDB.ts). No patient data is sent to Supabase.
 *
 * Supabase is still used for:
 *   - Auth (practitioners, organizations, subscriptions)
 *   - Catalogue (official_tests, official_norms, etc.)
 *   - Portal questionnaires (pending_questionnaires — ephemeral E2EE transit)
 *
 * Before calling any PHI method, call StorageService.setCurrentUser(userId)
 * from AuthContext after PIN unlock.
 */

import Dexie from 'dexie';
import { localDB } from './localDB';
import type { LocalFollowupRow } from './localDB';
import type {
  DashboardDraftMeta,
  DraftPayload,
  Patient,
  PatientAssessment,
  PatientAssessmentKind,
  PatientDashboardPreviewMeta,
  PatientEncryptedPreviewV2,
  PatientFile,
  PatientFollowup,
  PatientFollowupStatus,
  ReportSection,
  ScoreResult,
} from '../types';
import { DEMO_PATIENTS } from '../data/demoData';
import { getPatientAgeForIdentity, isPatientCreationReady } from '../utils';
import { Logger } from '../utils/logger';

// ─── Module-level state ───────────────────────────────────────────────────────

let _isDemoMode = false;
let _currentUserId = '';

const PATIENT_PAGE_SIZE = 50;
const ASSESSMENTS_PAGE_SIZE = 60;

// ─── Patient identity helpers ─────────────────────────────────────────────────

const createEmptyPatient = (): Patient => ({
  firstName: '',
  lastName: '',
  dob: '',
  age: '',
  gender: '',
  address: '',
  parentNames: '',
  parentPhone: '',
  parentEmail: '',
  guardArrangement: '',
  siblings: [],
  school: '',
  classLevel: '',
  teacher: '',
  carePlan: '',
  avs: '',
  avsDetails: '',
  prescribingDoctor: '',
  medicalDiagnosis: '',
  medicalTreatments: '',
  medicalFollowup: '',
  reason: '',
  familyExpectations: '',
  pregnancyBirth: '',
  developmentMotor: '',
  developmentLanguage: '',
  sleep: '',
  sensory: '',
  crawlingFourPattes: '',
  crawlingRamper: '',
  meals: '',
  dressing: '',
  dressingAutonomy: '',
  dressingObservations: '',
  continence: '',
  hygieneTeeth: '',
  hygieneHands: '',
  hygieneBath: '',
  hygieneFace: '',
  hygieneHair: '',
  hygieneContinenceStatus: '',
  hygieneObservations: '',
  timeSpace: '',
  timeSpaceClockReading: '',
  timeSpaceObservations: '',
  schoolAttention: '',
  writingIssues: '',
  toolUsage: '',
  schoolAccommodations: '',
  emotionalGlobalTags: '',
  emotionalReactionTags: '',
  emotionalNotes: '',
  prescribingDoctorProfession: '',
  remarks: '',
  priorities: '',
});

// Suppress unused warning — createEmptyPatient is kept for future use / demo fallbacks
void createEmptyPatient;

const normalizePatientIdentity = (patient: Patient): Patient => ({
  ...patient,
  age: getPatientAgeForIdentity(patient),
});

const getLatestIsoDate = (dates: Array<string | null | undefined>): string | null => {
  const timestamps = dates
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
};

const addMonthsToIso = (value: string, months: number): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setMonth(date.getMonth() + months);
  return date.toISOString();
};

// ─── Followup helpers ─────────────────────────────────────────────────────────

const resolveTemporalFollowupStatus = (dueAt: string): PatientFollowupStatus => {
  const dueDate = new Date(dueAt);
  if (Number.isNaN(dueDate.getTime())) return 'upcoming';
  const overdueDate = new Date(dueDate);
  overdueDate.setMonth(overdueDate.getMonth() + 6);
  const now = Date.now();
  if (now < dueDate.getTime()) return 'upcoming';
  if (now <= overdueDate.getTime()) return 'due';
  return 'overdue';
};

const mapLocalFollowupRow = (row: LocalFollowupRow): PatientFollowup => {
  let normalizedStatus: PatientFollowupStatus;
  if (row.status === 'completed' || row.status === 'scheduled') {
    normalizedStatus = row.status;
  } else if (row.status === 'snoozed') {
    if (row.snoozedUntil) {
      const snoozedUntil = new Date(row.snoozedUntil);
      normalizedStatus =
        !Number.isNaN(snoozedUntil.getTime()) && Date.now() < snoozedUntil.getTime()
          ? 'snoozed'
          : resolveTemporalFollowupStatus(row.dueAt);
    } else {
      normalizedStatus = resolveTemporalFollowupStatus(row.dueAt);
    }
  } else {
    normalizedStatus = resolveTemporalFollowupStatus(row.dueAt);
  }

  return {
    id: row.id,
    patientId: row.patientId,
    organizationId: row.organizationId ?? null,
    status: normalizedStatus,
    dueAt: row.dueAt,
    snoozedUntil: row.snoozedUntil,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

// ─── Preview / workflow helpers ───────────────────────────────────────────────

const buildWorkflowState = (
  patient: Patient,
  metrics: PatientDashboardPreviewMeta['metrics'],
  hasInitialReport: boolean,
  hasReevaluationOpportunity: boolean,
): PatientDashboardPreviewMeta['workflow'] => {
  if (metrics.formalReportsCount > 0) {
    return {
      progressPercent: 100,
      progressLabel: 'termine',
      statusTone: 'success',
      nextAction: hasReevaluationOpportunity ? 'reevaluation_candidate' : 'open_patient',
    };
  }
  if (metrics.assessmentsCount > 0) {
    return { progressPercent: 60, progressLabel: 'tests_saisis', statusTone: 'neutral', nextAction: 'open_patient' };
  }
  const hasInitialInfos = Boolean(
    patient.reason || patient.school || patient.familyExpectations || patient.classLevel,
  );
  if (hasInitialInfos) {
    return { progressPercent: 35, progressLabel: 'infos_recues', statusTone: 'warning', nextAction: 'complete_initial' };
  }
  return { progressPercent: 10, progressLabel: 'created', statusTone: 'warning', nextAction: 'complete_initial' };
};

const buildPreviewPayload = (
  patient: Patient,
  options: { archived?: boolean; assessments?: PatientAssessment[] },
): PatientEncryptedPreviewV2 => {
  const assessments = options.assessments || [];
  const formalAssessments = assessments.filter((item) => item.hasFormalReport);
  const hasInitialReport = formalAssessments.some((item) => item.kind === 'initial');
  const hasReevaluationReport = formalAssessments.some((item) => item.kind === 'reevaluation');
  const hasReevaluationOpportunity = hasInitialReport && !hasReevaluationReport;

  const metrics: PatientDashboardPreviewMeta['metrics'] = {
    assessmentsCount: assessments.length,
    formalReportsCount: formalAssessments.length,
    lastAssessmentDate: getLatestIsoDate(assessments.map((item) => item.date)),
    lastFormalReportDate: getLatestIsoDate(formalAssessments.map((item) => item.date)),
  };

  return {
    uiVersion: 2,
    identity: {
      firstName: patient.firstName || '',
      lastName: patient.lastName || '',
      age: getPatientAgeForIdentity(patient),
      classLevel: patient.classLevel || '',
      gender: patient.gender || '',
    },
    workflow: buildWorkflowState(patient, metrics, hasInitialReport, hasReevaluationOpportunity),
    metrics,
    flags: { _archived: options.archived === true, hasInitialReport, hasReevaluationOpportunity },
  };
};

const toPreviewMeta = (payload: PatientEncryptedPreviewV2): PatientDashboardPreviewMeta => ({
  uiVersion: 2,
  workflow: payload.workflow,
  metrics: payload.metrics,
  flags: payload.flags,
});

const buildFallbackPreviewMeta = (patient: Patient, archived: boolean): PatientDashboardPreviewMeta => {
  const metrics: PatientDashboardPreviewMeta['metrics'] = {
    assessmentsCount: 0,
    formalReportsCount: 0,
    lastAssessmentDate: null,
    lastFormalReportDate: null,
  };
  return {
    uiVersion: 2,
    workflow: buildWorkflowState(patient, metrics, false, false),
    metrics,
    flags: { _archived: archived, hasInitialReport: false, hasReevaluationOpportunity: false },
  };
};

// ─── Demo helpers ─────────────────────────────────────────────────────────────

const buildFallbackFollowupFromAssessments = (
  patientId: string,
  assessments: PatientAssessment[],
): PatientFollowup | null => {
  const formalAssessments = assessments
    .filter((item) => item.hasFormalReport)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const lastFormal = formalAssessments[0];
  if (!lastFormal) return null;

  const dueAt = addMonthsToIso(lastFormal.date, 6);
  return {
    id: `fallback-${patientId}`,
    patientId,
    organizationId: null,
    status: resolveTemporalFollowupStatus(dueAt),
    dueAt,
    snoozedUntil: null,
    note: null,
    createdAt: lastFormal.date,
    updatedAt: new Date().toISOString(),
  };
};

const buildDemoAssessments = (patientId: string): PatientAssessment[] => {
  if (patientId === DEMO_PATIENTS.SARAH.id) {
    const sarahDemo = DEMO_PATIENTS.SARAH as typeof DEMO_PATIENTS.SARAH & {
      history?: Array<{ id: string; date: string; testName: string; results: Record<string, ScoreResult> }>;
      reports?: Array<{ id: string; date: string; type: 'initial' | 'reevaluation'; patientName: string; sections: unknown[] }>;
    };
    const history = sarahDemo.history || [];
    const reports = sarahDemo.reports || [];
    return [
      ...reports.map((report) => ({
        id: report.id,
        date: report.date,
        kind: report.type as PatientAssessmentKind,
        hasFormalReport: true,
        testName: report.type === 'initial' ? 'Bilan initial' : 'Reevaluation',
        report: { status: 'completed' as const, patientName: report.patientName, sections: report.sections as ReportSection[] },
      })),
      ...history.map((entry) => ({
        id: entry.id,
        date: entry.date,
        kind: 'mini_reevaluation' as const,
        hasFormalReport: false,
        testName: entry.testName,
        results: entry.results as Record<string, ScoreResult>,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  if (patientId === DEMO_PATIENTS.LEO.id || patientId === 'demo-patient-imported') {
    return [
      {
        id: 'demo-assessment-leo',
        date: new Date(Date.now() - 86400000 * 21).toISOString(),
        kind: 'mini_reevaluation',
        hasFormalReport: false,
        testName: 'Bilan multi-tests',
        results: DEMO_PATIENTS.LEO.tests as unknown as Record<string, ScoreResult>,
      },
    ];
  }

  return [];
};

// ─── Public StorageService ────────────────────────────────────────────────────

export const StorageService = {
  /** Call this immediately after PIN unlock in AuthContext. */
  setCurrentUser: (userId: string) => {
    _currentUserId = userId;
    Logger.info('DB', `StorageService context set — user: ${userId}`);
  },

  setDemoMode: (active: boolean) => {
    _isDemoMode = active;
    Logger.warn('DB', `Storage Service switched to DEMO MODE: ${active}`);
  },

  // ── Patient creation ──────────────────────────────────────────────────────

  createPatient: async (patientData: Patient): Promise<string> => {
    if (_isDemoMode) return `demo-new-${crypto.randomUUID()}`;
    if (!_currentUserId) throw new Error('StorageService: user context not set');

    const id = crypto.randomUUID();
    const normalizedPatient = normalizePatientIdentity(patientData);
    const now = new Date().toISOString();

    await localDB.patients.add({
      id,
      userId: _currentUserId,
      patient: { ...normalizedPatient, id },
      archived: false,
      lastInteraction: now,
      previewMeta: buildFallbackPreviewMeta(normalizedPatient, false),
      createdAt: now,
      updatedAt: now,
    });

    Logger.info('DB', `Patient created locally: ${id}`);
    return id;
  },

  ensurePatientId: async (patientData: Patient): Promise<string> => {
    if (patientData.id) return patientData.id;
    if (!isPatientCreationReady(patientData)) throw new Error('PATIENT_REQUIRED_FIELDS_MISSING');
    return StorageService.createPatient(patientData);
  },

  // ── Identity sync ─────────────────────────────────────────────────────────

  syncPatientIdentityPreview: async (patientId: string, patientData: Patient): Promise<void> => {
    if (_isDemoMode) return;

    const existing = await localDB.patients.get(patientId);
    if (!existing) {
      Logger.warn('DB', `syncPatientIdentityPreview: patient ${patientId} not found`);
      return;
    }

    const normalizedPatient = normalizePatientIdentity(patientData);
    const previewMeta = toPreviewMeta(
      buildPreviewPayload(normalizedPatient, { archived: existing.archived, assessments: [] }),
    );

    await localDB.patients.update(patientId, {
      patient: { ...normalizedPatient, id: patientId },
      previewMeta,
      updatedAt: new Date().toISOString(),
    });
  },

  // ── Draft operations ──────────────────────────────────────────────────────

  saveDraft: async (draftData: DraftPayload): Promise<void> => {
    if (_isDemoMode) return;
    if (!_currentUserId) return;

    const patientId = draftData?.patient?.id;
    if (!patientId) return;

    const now = new Date().toISOString();
    const existing = await localDB.drafts
      .where('[userId+patientId]')
      .equals([_currentUserId, patientId])
      .first();

    if (existing?.id !== undefined) {
      await localDB.drafts.update(existing.id, { draftData, updatedAt: now });
    } else {
      await localDB.drafts.add({ userId: _currentUserId, patientId, draftData, updatedAt: now });
    }
  },

  getDraftsMetadata: async (): Promise<Record<string, DashboardDraftMeta>> => {
    if (_isDemoMode) return {};
    if (!_currentUserId) return {};

    const rows = await localDB.drafts
      .where('[userId+patientId]')
      .between([_currentUserId, Dexie.minKey], [_currentUserId, Dexie.maxKey])
      .toArray();

    const map: Record<string, DashboardDraftMeta> = {};
    for (const row of rows) {
      map[row.patientId] = {
        updatedAt: row.updatedAt,
        step: typeof row.draftData?.step === 'number' ? row.draftData.step : null,
      };
    }
    return map;
  },

  getDraft: async (patientId?: string): Promise<DraftPayload | null> => {
    if (_isDemoMode) return null;
    if (!_currentUserId) return null;

    const pid = patientId ?? '';
    const row = await localDB.drafts
      .where('[userId+patientId]')
      .equals([_currentUserId, pid])
      .first();

    return row?.draftData ?? null;
  },

  deleteDraft: async (patientId?: string): Promise<void> => {
    if (_isDemoMode) return;
    if (!_currentUserId) return;

    const pid = patientId ?? '';
    await localDB.drafts.where('[userId+patientId]').equals([_currentUserId, pid]).delete();
  },

  // ── Full patient file save ────────────────────────────────────────────────

  saveFile: async (file: PatientFile): Promise<void> => {
    if (_isDemoMode) return;
    if (!file.id) throw new Error('saveFile: missing patient ID');

    const normalizedPatient = normalizePatientIdentity(file.patient);
    const previewMeta = toPreviewMeta(
      buildPreviewPayload(normalizedPatient, { archived: file.archived, assessments: file.assessments }),
    );

    await localDB.patients.update(file.id, {
      patient: { ...normalizedPatient, id: file.id },
      archived: file.archived ?? false,
      lastInteraction: file.lastInteraction,
      previewMeta,
      updatedAt: new Date().toISOString(),
    });

    if (file.assessments.length > 0) {
      const now = new Date().toISOString();
      const assessmentRows = file.assessments.map((a) => ({
        id: a.id || crypto.randomUUID(),
        patientId: file.id!,
        userId: _currentUserId,
        kind: a.kind,
        hasFormalReport: a.hasFormalReport,
        date: a.date,
        testName: a.testName,
        results: a.results,
        report: a.report,
        createdAt: now,
      }));
      await localDB.assessments.bulkPut(assessmentRows);
    }
  },

  // ── Patient list ──────────────────────────────────────────────────────────

  loadPatientListPage: async (
    options?: { offset?: number; limit?: number },
  ): Promise<{ files: PatientFile[]; hasMore: boolean; nextOffset: number }> => {
    if (_isDemoMode) {
      const assessments = buildDemoAssessments(DEMO_PATIENTS.SARAH.id);
      const followup = buildFallbackFollowupFromAssessments(
        DEMO_PATIENTS.SARAH.id,
        assessments,
      );
      const demoFile: PatientFile = {
        id: DEMO_PATIENTS.SARAH.id,
        patient: DEMO_PATIENTS.SARAH.patient,
        assessments,
        followup,
        lastInteraction: assessments[0]?.date || new Date().toISOString(),
        archived: false,
        previewMeta: toPreviewMeta(buildPreviewPayload(DEMO_PATIENTS.SARAH.patient, { archived: false, assessments })),
      };
      return { files: [demoFile], hasMore: false, nextOffset: 1 };
    }

    if (!_currentUserId) return { files: [], hasMore: false, nextOffset: 0 };

    const pageSize = options?.limit ?? PATIENT_PAGE_SIZE;
    const offset = options?.offset ?? 0;

    const allRows = (
      await localDB.patients.where('userId').equals(_currentUserId).sortBy('lastInteraction')
    ).reverse();

    const page = allRows.slice(offset, offset + pageSize + 1);
    const hasMore = page.length > pageSize;
    const pageRows = page.slice(0, pageSize);

    const patientIds = pageRows.map((r) => r.id);
    const followupRows =
      patientIds.length > 0
        ? await localDB.followups.where('patientId').anyOf(patientIds).toArray()
        : [];
    const followupByPatientId = new Map(followupRows.map((f) => [f.patientId, mapLocalFollowupRow(f)]));

    const files: PatientFile[] = pageRows.map((row) => ({
      id: row.id,
      patient: row.patient,
      assessments: [],
      followup: followupByPatientId.get(row.id) || null,
      lastInteraction: row.lastInteraction,
      archived: row.archived,
      previewMeta: row.previewMeta,
    }));

    return { files, hasMore, nextOffset: offset + pageSize };
  },

  // ── Single patient preview ────────────────────────────────────────────────

  loadPatientPreviewById: async (
    patientId: string,
  ): Promise<PatientFile | null> => {
    if (_isDemoMode) return null;

    const row = await localDB.patients.get(patientId);
    if (!row) return null;

    const followupRow = await localDB.followups.where('patientId').equals(patientId).first();

    return {
      id: row.id,
      patient: row.patient,
      assessments: [],
      followup: followupRow ? mapLocalFollowupRow(followupRow) : null,
      lastInteraction: row.lastInteraction,
      archived: row.archived,
      previewMeta: row.previewMeta,
    };
  },

  // ── Assessment history ────────────────────────────────────────────────────

  loadPatientHistoryPage: async (
    patientId: string,
    options?: { assessmentOffset?: number; assessmentLimit?: number },
  ): Promise<{ assessments: PatientAssessment[]; hasMoreAssessments: boolean; nextAssessmentOffset: number }> => {
    if (_isDemoMode) {
      return { assessments: buildDemoAssessments(patientId), hasMoreAssessments: false, nextAssessmentOffset: 0 };
    }

    const assessmentOffset = options?.assessmentOffset ?? 0;
    const assessmentLimit = options?.assessmentLimit ?? ASSESSMENTS_PAGE_SIZE;

    const allRows = (
      await localDB.assessments.where('patientId').equals(patientId).sortBy('date')
    ).reverse();

    const page = allRows.slice(assessmentOffset, assessmentOffset + assessmentLimit + 1);
    const hasMoreAssessments = page.length > assessmentLimit;
    const pageRows = page.slice(0, assessmentLimit);

    const assessments: PatientAssessment[] = pageRows.map((row) => ({
      id: row.id,
      date: row.date,
      kind: row.kind,
      hasFormalReport: row.hasFormalReport,
      testName: row.testName,
      results: row.results,
      report: row.report,
    }));

    return { assessments, hasMoreAssessments, nextAssessmentOffset: assessmentOffset + assessmentLimit };
  },

  // ── Full patient details ──────────────────────────────────────────────────

  loadPatientDetails: async (
    patientId: string,
    options?: { assessmentOffset?: number; assessmentLimit?: number },
  ): Promise<{
    assessments: PatientAssessment[];
    patient: Patient;
    followup: PatientFollowup | null;
    hasMoreAssessments: boolean;
    nextAssessmentOffset: number;
  }> => {
    if (_isDemoMode) {
      if (patientId === DEMO_PATIENTS.LEO.id || patientId === 'demo-patient-imported') {
        const assessments = buildDemoAssessments(patientId);
        return {
          assessments,
          patient: DEMO_PATIENTS.LEO.patient,
          followup: buildFallbackFollowupFromAssessments(patientId, assessments),
          hasMoreAssessments: false,
          nextAssessmentOffset: 0,
        };
      }
      const assessments = buildDemoAssessments(patientId);
      return {
        assessments,
        patient: DEMO_PATIENTS.SARAH.patient,
        followup: buildFallbackFollowupFromAssessments(patientId, assessments),
        hasMoreAssessments: false,
        nextAssessmentOffset: 0,
      };
    }

    const row = await localDB.patients.get(patientId);
    if (!row) throw new Error('Patient introuvable.');

    const history = await StorageService.loadPatientHistoryPage(patientId, {
      assessmentOffset: options?.assessmentOffset,
      assessmentLimit: options?.assessmentLimit,
    });

    const followupRow = await localDB.followups.where('patientId').equals(patientId).first();

    return {
      assessments: history.assessments,
      patient: { ...row.patient, id: patientId },
      followup: followupRow ? mapLocalFollowupRow(followupRow) : null,
      hasMoreAssessments: history.hasMoreAssessments,
      nextAssessmentOffset: history.nextAssessmentOffset,
    };
  },

  // ── Delete & archive ──────────────────────────────────────────────────────

  deleteFile: async (id: string): Promise<void> => {
    if (_isDemoMode) return;
    await localDB.assessments.where('patientId').equals(id).delete();
    await localDB.drafts.where('[userId+patientId]').equals([_currentUserId, id]).delete();
    await localDB.followups.where('patientId').equals(id).delete();
    await localDB.patients.delete(id);
  },

  toggleArchive: async (file: PatientFile): Promise<void> => {
    if (_isDemoMode) return;
    await StorageService.saveFile({ ...file, archived: !file.archived });
  },

  // ── Followup operations ───────────────────────────────────────────────────

  getPatientFollowup: async (patientId: string): Promise<PatientFollowup | null> => {
    if (_isDemoMode) return null;
    const row = await localDB.followups.where('patientId').equals(patientId).first();
    return row ? mapLocalFollowupRow(row) : null;
  },

  upsertPatientFollowup: async (input: {
    patientId: string;
    status: PatientFollowupStatus;
    dueAt: string;
    snoozedUntil?: string | null;
    note?: string | null;
  }): Promise<void> => {
    if (_isDemoMode) return;

    const now = new Date().toISOString();
    const existing = await localDB.followups.where('patientId').equals(input.patientId).first();

    if (existing) {
      await localDB.followups.update(existing.id, {
        status: input.status,
        dueAt: input.dueAt,
        snoozedUntil: input.snoozedUntil ?? null,
        note: input.note ?? null,
        updatedAt: now,
      });
    } else {
      await localDB.followups.add({
        id: crypto.randomUUID(),
        patientId: input.patientId,
        status: input.status,
        dueAt: input.dueAt,
        snoozedUntil: input.snoozedUntil ?? null,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }
  },

  markFollowupCompleted: async (patientId: string): Promise<void> => {
    if (_isDemoMode) return;
    const existing = await localDB.followups.where('patientId').equals(patientId).first();
    if (!existing) return;
    await localDB.followups.update(existing.id, {
      status: 'completed',
      snoozedUntil: null,
      updatedAt: new Date().toISOString(),
    });
  },

  snoozeFollowup: async (patientId: string, until: string): Promise<void> => {
    if (_isDemoMode) return;
    const existing = await localDB.followups.where('patientId').equals(patientId).first();
    if (!existing) return;
    await localDB.followups.update(existing.id, {
      status: 'snoozed',
      snoozedUntil: until,
      updatedAt: new Date().toISOString(),
    });
  },
};

