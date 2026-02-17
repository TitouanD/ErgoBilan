import { supabase } from './db';
import type {
  DraftPayload,
  Patient,
  PatientAssessment,
  PatientAssessmentKind,
  PatientDashboardPreviewMeta,
  PatientDashboardProgressLabel,
  PatientEncryptedPreviewV2,
  PatientFile,
  PatientFollowup,
  PatientFollowupStatus,
  ReportSection,
  ScoreResult,
} from '../types';
import { decryptData, encryptData, generateSymetricKey, unwrapKey, wrapKey } from '../utils/crypto';
import { DEMO_PATIENTS } from '../data/demoData';
import { getPatientAgeForIdentity, isPatientCreationReady } from '../utils';
import { Logger } from '../utils/logger';

const PATIENT_PAGE_SIZE = 50;
const ASSESSMENTS_PAGE_SIZE = 60;

let _isDemoMode = false;

const encryptBlob = async (data: unknown, key: CryptoKey) => {
  const res = await encryptData(data, key);
  return { iv: res.iv, content: res.content };
};

const decryptBlob = async (iv: string, content: string, key: CryptoKey) => {
  return decryptData({ iv, content }, key);
};

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
  medicalTracking: [],
  reason: '',
  familyExpectations: '',
  goals: [],
  pregnancyBirth: '',
  developmentMotor: '',
  developmentLanguage: '',
  sleep: '',
  sensory: '',
  walkingAge: '',
  crawling: '',
  cleanliness: '',
  handDominance: '',
  meals: '',
  dressing: '',
  continence: '',
  timeSpace: '',
  clothingButtons: '',
  clothingLaces: '',
  clothingZippers: '',
  schoolAttention: '',
  writingIssues: '',
  toolUsage: '',
  schoolAccommodations: '',
  screenTime: '',
  emotionalRegulation: '',
  remarks: '',
  priorities: '',
});

const normalizePatientIdentity = (patient: Patient): Patient => ({
  ...patient,
  age: getPatientAgeForIdentity(patient),
});

const toPreviewIdentity = (patient: Patient): PatientEncryptedPreviewV2['identity'] => ({
  firstName: patient.firstName || '',
  lastName: patient.lastName || '',
  age: getPatientAgeForIdentity(patient),
  classLevel: patient.classLevel || '',
  gender: patient.gender || '',
});

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

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

type FollowupRow = {
  id: string;
  patient_id: string;
  organization_id: string;
  status: string;
  due_at: string;
  snoozed_until: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const mapFollowupRow = (row: FollowupRow): PatientFollowup => {
  let normalizedStatus: PatientFollowupStatus;
  if (row.status === 'completed' || row.status === 'scheduled') {
    normalizedStatus = row.status;
  } else if (row.status === 'snoozed') {
    if (row.snoozed_until) {
      const snoozedUntil = new Date(row.snoozed_until);
      normalizedStatus = !Number.isNaN(snoozedUntil.getTime()) && Date.now() < snoozedUntil.getTime()
        ? 'snoozed'
        : resolveTemporalFollowupStatus(row.due_at);
    } else {
      normalizedStatus = resolveTemporalFollowupStatus(row.due_at);
    }
  } else {
    normalizedStatus = resolveTemporalFollowupStatus(row.due_at);
  }

  return {
    id: row.id,
    patientId: row.patient_id,
    organizationId: row.organization_id,
    status: normalizedStatus,
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const buildFallbackFollowupFromAssessments = (
  patientId: string,
  organizationId: string,
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
    organizationId,
    status: resolveTemporalFollowupStatus(dueAt),
    dueAt,
    snoozedUntil: null,
    note: null,
    createdAt: lastFormal.date,
    updatedAt: new Date().toISOString(),
  };
};

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
    return {
      progressPercent: 60,
      progressLabel: 'tests_saisis',
      statusTone: 'neutral',
      nextAction: 'open_patient',
    };
  }

  const hasInitialInfos = Boolean(patient.reason || patient.school || patient.familyExpectations || patient.classLevel);
  if (hasInitialInfos) {
    return {
      progressPercent: 35,
      progressLabel: 'infos_recues',
      statusTone: 'warning',
      nextAction: 'complete_initial',
    };
  }

  return {
    progressPercent: 10,
    progressLabel: 'created',
    statusTone: 'warning',
    nextAction: 'complete_initial',
  };
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

  const workflow = buildWorkflowState(patient, metrics, hasInitialReport, hasReevaluationOpportunity);

  return {
    uiVersion: 2,
    identity: toPreviewIdentity(patient),
    workflow,
    metrics,
    flags: {
      _archived: options.archived === true,
      hasInitialReport,
      hasReevaluationOpportunity,
    },
  };
};

const buildEncryptedPreview = async (
  patient: Patient,
  fileKey: CryptoKey,
  options: { archived?: boolean; assessments?: PatientAssessment[] },
) => {
  const payload = buildPreviewPayload(patient, options);
  return encryptBlob(payload, fileKey);
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
  const workflow = buildWorkflowState(patient, metrics, false, false);

  return {
    uiVersion: 2,
    workflow,
    metrics,
    flags: {
      _archived: archived,
      hasInitialReport: false,
      hasReevaluationOpportunity: false,
    },
  };
};

const isPreviewV2 = (value: unknown): value is PatientEncryptedPreviewV2 => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PatientEncryptedPreviewV2>;
  return candidate.uiVersion === 2 && !!candidate.identity && typeof candidate.identity === 'object';
};

const parsePreviewPayload = (preview: unknown): { patient: Patient; previewMeta: PatientDashboardPreviewMeta; archived: boolean } => {
  if (!isPreviewV2(preview)) {
    const legacy = (preview || {}) as Partial<Patient> & { _archived?: boolean };
    const { _archived, ...identity } = legacy;
    const archived = _archived === true;
    const patient = { ...createEmptyPatient(), ...(identity as Partial<Patient>) };
    return { patient, previewMeta: buildFallbackPreviewMeta(patient, archived), archived };
  }

  const archived = preview.flags?._archived === true;
  const patient = { ...createEmptyPatient(), ...preview.identity };
  const workflow = preview.workflow || buildFallbackPreviewMeta(patient, archived).workflow;
  const metrics = preview.metrics || buildFallbackPreviewMeta(patient, archived).metrics;

  const progressLabel: PatientDashboardProgressLabel =
    workflow.progressLabel === 'created' ||
    workflow.progressLabel === 'infos_recues' ||
    workflow.progressLabel === 'tests_saisis' ||
    workflow.progressLabel === 'termine'
      ? workflow.progressLabel
      : 'created';

  const normalizedPreview: PatientEncryptedPreviewV2 = {
    uiVersion: 2,
    identity: preview.identity,
    workflow: {
      progressPercent: clampPercent(workflow.progressPercent),
      progressLabel,
      statusTone: workflow.statusTone === 'success' || workflow.statusTone === 'warning' ? workflow.statusTone : 'neutral',
      nextAction: workflow.nextAction || 'open_patient',
    },
    metrics: {
      assessmentsCount: Math.max(0, Number((metrics as Record<string, unknown>).assessmentsCount || (metrics as Record<string, unknown>).sessionsCount || 0)),
      formalReportsCount: Math.max(0, Number((metrics as Record<string, unknown>).formalReportsCount || (metrics as Record<string, unknown>).reportsCount || 0)),
      lastAssessmentDate:
        ((metrics as Record<string, unknown>).lastAssessmentDate as string | null) ||
        ((metrics as Record<string, unknown>).lastSessionDate as string | null) ||
        null,
      lastFormalReportDate:
        ((metrics as Record<string, unknown>).lastFormalReportDate as string | null) ||
        ((metrics as Record<string, unknown>).lastReportDate as string | null) ||
        null,
    },
    flags: {
      _archived: archived,
      hasInitialReport: preview.flags?.hasInitialReport === true,
      hasReevaluationOpportunity: preview.flags?.hasReevaluationOpportunity === true,
    },
  };

  return { patient, previewMeta: toPreviewMeta(normalizedPreview), archived };
};

const mapAssessmentRowsToData = async (
  rows: Array<{
    id: string;
    assessment_at: string;
    kind: PatientAssessment['kind'];
    has_formal_report: boolean;
    iv: string;
    encrypted_payload: string;
  }>,
  fileKey: CryptoKey,
): Promise<PatientAssessment[]> => {
  return Promise.all(
    rows.map(async (row) => {
      const decrypted = (await decryptBlob(row.iv, row.encrypted_payload, fileKey)) as {
        testName?: string | null;
        results?: Record<string, ScoreResult> | null;
        report?: PatientAssessment['report'] | null;
      };
      return {
        id: row.id,
        date: row.assessment_at,
        kind: row.kind,
        hasFormalReport: row.has_formal_report === true,
        testName: decrypted?.testName || undefined,
        results: decrypted?.results || undefined,
        report: decrypted?.report || undefined,
      } satisfies PatientAssessment;
    }),
  );
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

export const StorageService = {
  setDemoMode: (active: boolean) => {
    _isDemoMode = active;
    Logger.warn('DB', `Storage Service switched to DEMO MODE: ${active}`);
  },

  createPatient: async (patientData: Patient, orgKey: CryptoKey): Promise<string> => {
    if (_isDemoMode) return `demo-new-${crypto.randomUUID()}`;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Utilisateur non connecte');

    const normalizedPatient = normalizePatientIdentity(patientData);

    const fileKey = await generateSymetricKey();
    const wrapped = await wrapKey(fileKey, orgKey);
    const encryptedFileKeyStr = `${wrapped.iv}:${wrapped.content}`;

    const encIdentity = await encryptBlob({ ...normalizedPatient, _archived: false }, fileKey);
    const encPreview = await buildEncryptedPreview(normalizedPatient, fileKey, { archived: false, assessments: [] });

    const { data: member } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (!member?.organization_id) throw new Error('Organisation introuvable.');

    const { data, error } = await supabase
      .from('patients')
      .insert({
        organization_id: member.organization_id,
        updated_at: new Date().toISOString(),
        last_interaction: new Date().toISOString(),
        iv: encIdentity.iv,
        encrypted_identity: encIdentity.content,
        preview_iv: encPreview.iv,
        encrypted_preview: encPreview.content,
        encrypted_file_key: encryptedFileKeyStr,
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  },

  ensurePatientId: async (patientData: Patient, orgKey: CryptoKey): Promise<string> => {
    if (patientData.id) return patientData.id;
    if (!isPatientCreationReady(patientData)) throw new Error('PATIENT_REQUIRED_FIELDS_MISSING');
    return StorageService.createPatient(patientData, orgKey);
  },

  syncPatientIdentityPreview: async (patientId: string, patientData: Patient, orgKey: CryptoKey): Promise<void> => {
    if (_isDemoMode) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Utilisateur non connecte');

    const { data: existingPatient, error: existingPatientError } = await supabase
      .from('patients')
      .select('encrypted_file_key, iv, encrypted_identity, preview_iv, encrypted_preview')
      .eq('id', patientId)
      .single();

    if (existingPatientError) throw existingPatientError;
    if (!existingPatient?.encrypted_file_key) throw new Error('Dossier introuvable ou corrompu (cle manquante).');

    const [kIv, kContent] = existingPatient.encrypted_file_key.split(':');
    const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);
    const normalizedPatient = normalizePatientIdentity(patientData);

    let archived = false;
    if (existingPatient.iv && existingPatient.encrypted_identity) {
      const decryptedIdentity = (await decryptBlob(existingPatient.iv, existingPatient.encrypted_identity, fileKey)) as Patient & {
        _archived?: boolean;
      };
      archived = decryptedIdentity?._archived === true;
    }

    let previewPayload: PatientEncryptedPreviewV2;
    if (existingPatient.preview_iv && existingPatient.encrypted_preview) {
      const decryptedPreview = await decryptBlob(existingPatient.preview_iv, existingPatient.encrypted_preview, fileKey);
      const parsedPreview = parsePreviewPayload(decryptedPreview);
      previewPayload = {
        uiVersion: 2,
        identity: toPreviewIdentity(normalizedPatient),
        workflow: parsedPreview.previewMeta.workflow,
        metrics: parsedPreview.previewMeta.metrics,
        flags: {
          ...parsedPreview.previewMeta.flags,
          _archived: archived,
        },
      };
    } else {
      const fallback = buildFallbackPreviewMeta(normalizedPatient, archived);
      previewPayload = {
        uiVersion: 2,
        identity: toPreviewIdentity(normalizedPatient),
        workflow: fallback.workflow,
        metrics: fallback.metrics,
        flags: fallback.flags,
      };
    }

    const patientToSave = { ...normalizedPatient, _archived: archived };
    const encIdentity = await encryptBlob(patientToSave, fileKey);
    const encPreview = await encryptBlob(previewPayload, fileKey);

    const { error: patError } = await supabase
      .from('patients')
      .update({
        updated_at: new Date().toISOString(),
        iv: encIdentity.iv,
        encrypted_identity: encIdentity.content,
        preview_iv: encPreview.iv,
        encrypted_preview: encPreview.content,
      })
      .eq('id', patientId);

    if (patError) throw patError;
  },

  saveDraft: async (draftData: DraftPayload, sessionKey: CryptoKey): Promise<void> => {
    if (_isDemoMode) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const patientId = draftData?.patient?.id;
    if (!patientId) return;

    const enc = await encryptBlob(draftData, sessionKey);

    const { data: existing } = await supabase
      .from('drafts')
      .select('id')
      .eq('user_id', user.id)
      .eq('patient_id', patientId)
      .maybeSingle();

    const payload: Record<string, string> = {
      user_id: user.id,
      updated_at: new Date().toISOString(),
      iv: enc.iv,
      encrypted_data: enc.content,
      patient_id: patientId,
    };

    if (existing) await supabase.from('drafts').update(payload).eq('id', existing.id);
    else await supabase.from('drafts').insert(payload);
  },

  getDraftsMetadata: async (): Promise<Record<string, string>> => {
    if (_isDemoMode) return {};

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return {};

    const { data, error } = await supabase.from('drafts').select('patient_id, updated_at').eq('user_id', user.id);
    if (error || !data) return {};

    const map: Record<string, string> = {};
    data.forEach((row: { patient_id: string | null; updated_at: string }) => {
      if (row.patient_id) map[row.patient_id] = row.updated_at;
    });

    return map;
  },

  getDraft: async (sessionKey: CryptoKey, patientId?: string): Promise<DraftPayload | null> => {
    if (_isDemoMode) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    let query = supabase.from('drafts').select('*').eq('user_id', user.id);
    query = patientId ? query.eq('patient_id', patientId) : query.is('patient_id', null);

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;

    try {
      return (await decryptBlob(data.iv, data.encrypted_data, sessionKey)) as DraftPayload;
    } catch {
      return null;
    }
  },

  deleteDraft: async (patientId?: string): Promise<void> => {
    if (_isDemoMode) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    let query = supabase.from('drafts').delete().eq('user_id', user.id);
    query = patientId ? query.eq('patient_id', patientId) : query.is('patient_id', null);
    await query;
  },

  saveFile: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
    if (_isDemoMode) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Utilisateur non connecte');

    const normalizedPatient = normalizePatientIdentity(file.patient);
    if (!file.id) throw new Error('Patient ID manquant');

    const { data: existingPatient } = await supabase
      .from('patients')
      .select('encrypted_file_key, organization_id')
      .eq('id', file.id)
      .single();

    if (!existingPatient?.encrypted_file_key) {
      throw new Error('Dossier introuvable ou corrompu (cle manquante).');
    }

    const [iv, content] = existingPatient.encrypted_file_key.split(':');
    const fileKey = await unwrapKey({ iv, content }, orgKey);

    const patientToSave = { ...normalizedPatient, _archived: file.archived === true };
    const encIdentity = await encryptBlob(patientToSave, fileKey);
    const encPreview = await buildEncryptedPreview(normalizedPatient, fileKey, {
      archived: file.archived,
      assessments: file.assessments,
    });

    const { error: patError } = await supabase
      .from('patients')
      .update({
        updated_at: new Date().toISOString(),
        last_interaction: file.lastInteraction,
        iv: encIdentity.iv,
        encrypted_identity: encIdentity.content,
        preview_iv: encPreview.iv,
        encrypted_preview: encPreview.content,
      })
      .eq('id', file.id);

    if (patError) throw patError;

    if (file.assessments.length > 0) {
      const assessmentPayloads = await Promise.all(
        file.assessments.map(async (assessment) => {
          const enc = await encryptBlob(
            {
              testName: assessment.testName || null,
              results: assessment.results || null,
              report: assessment.report || null,
            },
            fileKey,
          );

          return {
            id: assessment.id,
            user_id: user.id,
            patient_id: file.id,
            organization_id: existingPatient.organization_id,
            kind: assessment.kind,
            has_formal_report: assessment.hasFormalReport,
            assessment_at: assessment.date,
            iv: enc.iv,
            encrypted_payload: enc.content,
          };
        }),
      );

      const { error: assessmentsError } = await supabase.from('patient_assessments').upsert(assessmentPayloads);
      if (assessmentsError) throw assessmentsError;
    }
  },

  loadPatientListPage: async (
    orgKey: CryptoKey,
    options?: { orgId?: string; offset?: number; limit?: number },
  ): Promise<{ files: PatientFile[]; hasMore: boolean; nextOffset: number }> => {
    if (_isDemoMode) {
      const assessments = buildDemoAssessments(DEMO_PATIENTS.SARAH.id);
      const followup = buildFallbackFollowupFromAssessments(
        DEMO_PATIENTS.SARAH.id,
        DEMO_PATIENTS.SARAH.patient.organizationId || 'demo-org',
        assessments,
      );
      const demoFile: PatientFile = {
        id: DEMO_PATIENTS.SARAH.id,
        patient: DEMO_PATIENTS.SARAH.patient,
        assessments,
        followup,
        lastInteraction: assessments[0]?.date || new Date().toISOString(),
        archived: false,
      };
      demoFile.previewMeta = toPreviewMeta(buildPreviewPayload(demoFile.patient, { archived: false, assessments }));
      return { files: [demoFile], hasMore: false, nextOffset: 1 };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { files: [], hasMore: false, nextOffset: options?.offset ?? 0 };

    const pageSize = options?.limit ?? PATIENT_PAGE_SIZE;
    const offset = options?.offset ?? 0;

    let resolvedOrgId = options?.orgId;
    if (!resolvedOrgId) {
      const { data: member } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id)
        .maybeSingle();
      resolvedOrgId = member?.organization_id || undefined;
    }

    let query = supabase
      .from('patients')
      .select('id, last_interaction, encrypted_preview, preview_iv, encrypted_file_key, organization_id')
      .order('last_interaction', { ascending: false })
      .range(offset, offset + pageSize);

    if (resolvedOrgId) query = query.eq('organization_id', resolvedOrgId);

    const { data: patients, error } = await query;
    if (error) return { files: [], hasMore: false, nextOffset: offset };

    const files: PatientFile[] = [];
    const safePatients = patients || [];
    const hasMore = safePatients.length > pageSize;
    const pagePatients = safePatients.slice(0, pageSize);
    const followupByPatientId = new Map<string, PatientFollowup>();

    if (pagePatients.length > 0) {
      const patientIds = pagePatients.map((row) => row.id);
      const { data: followups } = await supabase
        .from('patient_followups')
        .select('id, patient_id, organization_id, status, due_at, snoozed_until, note, created_at, updated_at')
        .in('patient_id', patientIds);

      (followups || []).forEach((row) => {
        const mapped = mapFollowupRow(row as FollowupRow);
        followupByPatientId.set(mapped.patientId, mapped);
      });
    }

    for (const row of pagePatients) {
      if (!row.encrypted_file_key) continue;
      try {
        const [kIv, kContent] = row.encrypted_file_key.split(':');
        const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

        let patientData: Patient;
        let previewMeta: PatientDashboardPreviewMeta;
        let isArchived = false;

        if (row.encrypted_preview && row.preview_iv) {
          const parsedPreview = parsePreviewPayload(await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey));
          patientData = parsedPreview.patient;
          previewMeta = parsedPreview.previewMeta;
          isArchived = parsedPreview.archived;
        } else {
          patientData = createEmptyPatient();
          previewMeta = buildFallbackPreviewMeta(patientData, false);
        }

        files.push({
          id: row.id,
          patient: { ...patientData, organizationId: row.organization_id },
          assessments: [],
          followup: followupByPatientId.get(row.id) || null,
          lastInteraction: row.last_interaction,
          archived: isArchived,
          encryptedFileKey: row.encrypted_file_key,
          previewMeta,
        });
      } catch (e) {
        Logger.warn('CRYPTO', `Failed to decrypt patient ${row.id}`, e);
      }
    }

    return { files, hasMore, nextOffset: offset + pageSize };
  },

  loadPatientPreviewById: async (
    patientId: string,
    orgKey: CryptoKey,
    options?: { orgId?: string },
  ): Promise<PatientFile | null> => {
    if (_isDemoMode) return null;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    let query = supabase
      .from('patients')
      .select('id, last_interaction, encrypted_preview, preview_iv, encrypted_identity, iv, encrypted_file_key, organization_id')
      .eq('id', patientId);

    if (options?.orgId) query = query.eq('organization_id', options.orgId);

    const { data: row, error } = await query.maybeSingle();
    if (error || !row?.encrypted_file_key) return null;

    const [kIv, kContent] = row.encrypted_file_key.split(':');
    const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

    let patientData: Patient;
    let previewMeta: PatientDashboardPreviewMeta;
    let isArchived = false;

    if (row.encrypted_preview && row.preview_iv) {
      const parsedPreview = parsePreviewPayload(await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey));
      patientData = parsedPreview.patient;
      previewMeta = parsedPreview.previewMeta;
      isArchived = parsedPreview.archived;
    } else if (row.encrypted_identity && row.iv) {
      const fullData = (await decryptBlob(row.iv, row.encrypted_identity, fileKey)) as Patient & { _archived?: boolean };
      const { _archived, ...identityData } = fullData;
      patientData = { ...createEmptyPatient(), ...(identityData as Patient) };
      previewMeta = buildFallbackPreviewMeta(patientData, _archived === true);
      isArchived = _archived === true;
    } else {
      return null;
    }

    const { data: followupRow } = await supabase
      .from('patient_followups')
      .select('id, patient_id, organization_id, status, due_at, snoozed_until, note, created_at, updated_at')
      .eq('patient_id', row.id)
      .maybeSingle();

    return {
      id: row.id,
      patient: { ...patientData, organizationId: row.organization_id },
      assessments: [],
      followup: followupRow ? mapFollowupRow(followupRow as FollowupRow) : null,
      lastInteraction: row.last_interaction,
      archived: isArchived,
      encryptedFileKey: row.encrypted_file_key,
      previewMeta,
    };
  },

  loadPatientHistoryPage: async (
    patientId: string,
    orgKey: CryptoKey,
    options?: { encryptedFileKey?: string; assessmentOffset?: number; assessmentLimit?: number },
  ): Promise<{ assessments: PatientAssessment[]; hasMoreAssessments: boolean; nextAssessmentOffset: number }> => {
    if (_isDemoMode) {
      return {
        assessments: buildDemoAssessments(patientId),
        hasMoreAssessments: false,
        nextAssessmentOffset: 0,
      };
    }

    const assessmentOffset = options?.assessmentOffset ?? 0;
    const assessmentLimit = options?.assessmentLimit ?? ASSESSMENTS_PAGE_SIZE;

    let encryptedFileKey = options?.encryptedFileKey;
    if (!encryptedFileKey) {
      const { data: patientRow, error: patientError } = await supabase
        .from('patients')
        .select('encrypted_file_key')
        .eq('id', patientId)
        .single();
      if (patientError) throw patientError;
      encryptedFileKey = patientRow?.encrypted_file_key || undefined;
    }

    if (!encryptedFileKey) throw new Error('Cle dossier introuvable.');

    const [kIv, kContent] = encryptedFileKey.split(':');
    const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

    const { data, error } = await supabase
      .from('patient_assessments')
      .select('id, assessment_at, kind, has_formal_report, iv, encrypted_payload')
      .eq('patient_id', patientId)
      .order('assessment_at', { ascending: false })
      .range(assessmentOffset, assessmentOffset + assessmentLimit);

    if (error) throw error;

    const rows = data || [];
    const hasMoreAssessments = rows.length > assessmentLimit;
    const pageRows = rows.slice(0, assessmentLimit);
    const assessments = await mapAssessmentRowsToData(pageRows, fileKey);

    return {
      assessments,
      hasMoreAssessments,
      nextAssessmentOffset: assessmentOffset + assessmentLimit,
    };
  },

  loadPatientDetails: async (
    patientId: string,
    orgKey: CryptoKey,
    options?: { assessmentOffset?: number; assessmentLimit?: number },
  ): Promise<{ assessments: PatientAssessment[]; patient: Patient; followup: PatientFollowup | null; hasMoreAssessments: boolean; nextAssessmentOffset: number }> => {
    if (_isDemoMode) {
      if (patientId === DEMO_PATIENTS.LEO.id || patientId === 'demo-patient-imported') {
        const assessments = buildDemoAssessments(patientId);
        return {
          assessments,
          patient: DEMO_PATIENTS.LEO.patient,
          followup: buildFallbackFollowupFromAssessments(
            patientId,
            DEMO_PATIENTS.LEO.patient.organizationId || 'demo-org',
            assessments,
          ),
          hasMoreAssessments: false,
          nextAssessmentOffset: 0,
        };
      }
      const assessments = buildDemoAssessments(patientId);
      return {
        assessments,
        patient: DEMO_PATIENTS.SARAH.patient,
        followup: buildFallbackFollowupFromAssessments(
          patientId,
          DEMO_PATIENTS.SARAH.patient.organizationId || 'demo-org',
          assessments,
        ),
        hasMoreAssessments: false,
        nextAssessmentOffset: 0,
      };
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Non connecte');

    const { data: patientRow, error: pError } = await supabase
      .from('patients')
      .select('encrypted_file_key, encrypted_identity, iv, organization_id')
      .eq('id', patientId)
      .single();

    if (pError || !patientRow?.encrypted_file_key) {
      throw new Error('Impossible de recuperer le dossier patient.');
    }

    const [kIv, kContent] = patientRow.encrypted_file_key.split(':');
    const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

    const decryptedIdentity = (await decryptBlob(patientRow.iv, patientRow.encrypted_identity, fileKey)) as Patient & {
      _archived?: boolean;
    };
    const { _archived, ...identityWithoutArchived } = decryptedIdentity;
    const patientFull = { ...identityWithoutArchived, id: patientId, organizationId: patientRow.organization_id } as Patient;

    const history = await StorageService.loadPatientHistoryPage(patientId, orgKey, {
      encryptedFileKey: patientRow.encrypted_file_key,
      assessmentOffset: options?.assessmentOffset,
      assessmentLimit: options?.assessmentLimit,
    });

    const { data: followupRow } = await supabase
      .from('patient_followups')
      .select('id, patient_id, organization_id, status, due_at, snoozed_until, note, created_at, updated_at')
      .eq('patient_id', patientId)
      .maybeSingle();

    return {
      assessments: history.assessments,
      patient: patientFull,
      followup: followupRow ? mapFollowupRow(followupRow as FollowupRow) : null,
      hasMoreAssessments: history.hasMoreAssessments,
      nextAssessmentOffset: history.nextAssessmentOffset,
    };
  },

  deleteFile: async (id: string): Promise<void> => {
    if (_isDemoMode) return;
    await supabase.from('drafts').delete().eq('patient_id', id);
    await supabase.from('patients').delete().eq('id', id);
  },

  toggleArchive: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
    if (_isDemoMode) return;
    const newFile = { ...file, archived: !file.archived };
    await StorageService.saveFile(newFile, orgKey);
  },

  getPatientFollowup: async (patientId: string): Promise<PatientFollowup | null> => {
    if (_isDemoMode) return null;

    const { data, error } = await supabase
      .from('patient_followups')
      .select('id, patient_id, organization_id, status, due_at, snoozed_until, note, created_at, updated_at')
      .eq('patient_id', patientId)
      .maybeSingle();

    if (error || !data) return null;
    return mapFollowupRow(data as FollowupRow);
  },

  upsertPatientFollowup: async (input: {
    patientId: string;
    organizationId?: string;
    status: PatientFollowupStatus;
    dueAt: string;
    snoozedUntil?: string | null;
    note?: string | null;
  }): Promise<void> => {
    if (_isDemoMode) return;

    let organizationId = input.organizationId;
    if (!organizationId) {
      const { data: patientRow, error: patientError } = await supabase
        .from('patients')
        .select('organization_id')
        .eq('id', input.patientId)
        .single();
      if (patientError || !patientRow?.organization_id) throw patientError || new Error('Organisation patient introuvable.');
      organizationId = patientRow.organization_id;
    }

    const { error } = await supabase.from('patient_followups').upsert(
      {
        patient_id: input.patientId,
        organization_id: organizationId,
        status: input.status,
        due_at: input.dueAt,
        snoozed_until: input.snoozedUntil || null,
        note: input.note || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'patient_id' },
    );

    if (error) throw error;
  },

  markFollowupCompleted: async (patientId: string): Promise<void> => {
    if (_isDemoMode) return;

    const { error } = await supabase
      .from('patient_followups')
      .update({
        status: 'completed',
        snoozed_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('patient_id', patientId);

    if (error) throw error;
  },

  snoozeFollowup: async (patientId: string, until: string): Promise<void> => {
    if (_isDemoMode) return;

    const { error } = await supabase
      .from('patient_followups')
      .update({
        status: 'snoozed',
        snoozed_until: until,
        updated_at: new Date().toISOString(),
      })
      .eq('patient_id', patientId);

    if (error) throw error;
  },
};
