
import { supabase } from './db';
import type {
    PatientFile,
    Patient,
    ReportMetadata,
    TestSession,
    DraftPayload,
    PatientDashboardPreviewMeta,
    PatientDashboardProgressLabel,
    PatientEncryptedPreviewV2,
    ScoreResult,
} from '../types';
import { encryptData, decryptData, generateSymetricKey, wrapKey, unwrapKey } from '../utils/crypto';
import { Logger } from '../utils/logger';
import { DEMO_PATIENTS } from '../data/demoData';

// --- HELPERS CHIFFREMENT ---

const encryptBlob = async (data: unknown, key: CryptoKey) => {
    const res = await encryptData(data, key);
    return { iv: res.iv, content: res.content };
};

const decryptBlob = async (iv: string, content: string, key: CryptoKey) => {
    return await decryptData({ iv, content }, key);
};

// --- DEMO MODE STATE ---
let _isDemoMode = false;

const PATIENT_PAGE_SIZE = 50;
const SESSIONS_PAGE_SIZE = 30;

// Helper pour éviter les objets undefined dans le UI
const createEmptyPatient = (): Patient => ({
    firstName: '', lastName: '', dob: '', age: '', gender: '', address: '',
    parentNames: '', parentPhone: '', parentEmail: '', guardArrangement: '', siblings: [],
    school: '', classLevel: '', teacher: '', carePlan: '', avs: '', avsDetails: '',
    prescribingDoctor: '', medicalDiagnosis: '', medicalTreatments: '', medicalFollowup: '', medicalTracking: [],
    reason: '', familyExpectations: '', goals: [],
    pregnancyBirth: '', developmentMotor: '', developmentLanguage: '', sleep: '', sensory: '',
    walkingAge: '', crawling: '', cleanliness: '', handDominance: '',
    meals: '', dressing: '', continence: '', timeSpace: '',
    clothingButtons: '', clothingLaces: '', clothingZippers: '',
    schoolAttention: '', writingIssues: '', toolUsage: '', schoolAccommodations: '',
    screenTime: '', emotionalRegulation: '',
    remarks: '', priorities: ''
});

type LegacyPreviewPayload = Partial<Patient> & { _archived?: boolean };

const getLatestIsoDate = (dates: Array<string | null | undefined>): string | null => {
    const timestamps = dates
        .map((value) => (value ? new Date(value).getTime() : Number.NaN))
        .filter((value) => Number.isFinite(value));

    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
};

const clampPercent = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

const buildWorkflowState = (
    patient: Patient,
    metrics: PatientDashboardPreviewMeta['metrics'],
    hasInitialReport: boolean,
    hasReevaluationOpportunity: boolean
): PatientDashboardPreviewMeta['workflow'] => {
    if (metrics.reportsCount > 0) {
        return {
            progressPercent: 100,
            progressLabel: 'termine',
            statusTone: 'success',
            nextAction: hasReevaluationOpportunity ? 'reevaluation_candidate' : 'open_patient',
        };
    }

    if (metrics.sessionsCount > 0) {
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
    options: { archived?: boolean; reports?: ReportMetadata[]; sessions?: TestSession[] }
): PatientEncryptedPreviewV2 => {
    const reports = options.reports || [];
    const sessions = options.sessions || [];
    const hasInitialReport = reports.some((r) => r.type === 'initial');
    const hasReevaluationReport = reports.some((r) => r.type === 'reevaluation');
    const hasReevaluationOpportunity = hasInitialReport && !hasReevaluationReport;

    const metrics: PatientDashboardPreviewMeta['metrics'] = {
        reportsCount: reports.length,
        sessionsCount: sessions.length,
        lastReportDate: getLatestIsoDate(reports.map((r) => r.date)),
        lastSessionDate: getLatestIsoDate(sessions.map((s) => s.date)),
    };

    const workflow = buildWorkflowState(patient, metrics, hasInitialReport, hasReevaluationOpportunity);

    return {
        uiVersion: 2,
        identity: {
            firstName: patient.firstName || '',
            lastName: patient.lastName || '',
            age: patient.age || '',
            classLevel: patient.classLevel || '',
            gender: patient.gender || '',
        },
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
    options: { archived?: boolean; reports?: ReportMetadata[]; sessions?: TestSession[] }
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

const buildFallbackPreviewMeta = (
    patient: Patient,
    archived: boolean
): PatientDashboardPreviewMeta => {
    const metrics: PatientDashboardPreviewMeta['metrics'] = {
        reportsCount: 0,
        sessionsCount: 0,
        lastReportDate: null,
        lastSessionDate: null,
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
    if (isPreviewV2(preview)) {
        const archived = preview.flags?._archived === true;
        const patient = {
            ...createEmptyPatient(),
            ...preview.identity,
        };

        const workflow = preview.workflow || buildFallbackPreviewMeta(patient, archived).workflow;
        const metrics = preview.metrics || buildFallbackPreviewMeta(patient, archived).metrics;
        const progressLabel: PatientDashboardProgressLabel = (
            workflow.progressLabel === 'created' ||
            workflow.progressLabel === 'infos_recues' ||
            workflow.progressLabel === 'tests_saisis' ||
            workflow.progressLabel === 'termine'
        ) ? workflow.progressLabel : 'created';

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
                reportsCount: Math.max(0, Number(metrics.reportsCount || 0)),
                sessionsCount: Math.max(0, Number(metrics.sessionsCount || 0)),
                lastReportDate: metrics.lastReportDate || null,
                lastSessionDate: metrics.lastSessionDate || null,
            },
            flags: {
                _archived: archived,
                hasInitialReport: preview.flags?.hasInitialReport === true,
                hasReevaluationOpportunity: preview.flags?.hasReevaluationOpportunity === true,
            },
        };

        return { patient, previewMeta: toPreviewMeta(normalizedPreview), archived };
    }

    const legacyPreview = (preview || {}) as LegacyPreviewPayload;
    const { _archived, ...legacyWithoutArchived } = legacyPreview;
    const archived = _archived === true;
    const patient = {
        ...createEmptyPatient(),
        ...(legacyWithoutArchived as Partial<Patient>),
    };

    return {
        patient,
        previewMeta: buildFallbackPreviewMeta(patient, archived),
        archived,
    };
};

export const StorageService = {
    
    setDemoMode: (active: boolean) => {
        _isDemoMode = active;
        Logger.warn('DB', `Storage Service switched to DEMO MODE: ${active}`);
    },

    /**
     * NOUVEAU : CRÉATION STRICTE DU PATIENT (INSERT)
     * Génère l'ID serveur et la FileKey.
     * Appelé automatiquement dès que Nom/Prénom sont saisis.
     */
    createPatient: async (patientData: Patient, orgKey: CryptoKey): Promise<string> => {
        if (_isDemoMode) return 'demo-new-' + crypto.randomUUID();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Utilisateur non connecté");

        // 1. Génération de la Clé de Dossier (FileKey)
        const fileKey = await generateSymetricKey();
        const wrapped = await wrapKey(fileKey, orgKey);
        const encryptedFileKeyStr = `${wrapped.iv}:${wrapped.content}`;

        // 2. Chiffrement Identité (Full + Preview)
        const encIdentity = await encryptBlob({ ...patientData, _archived: false }, fileKey);
        
        const encPreview = await buildEncryptedPreview(patientData, fileKey, { archived: false, reports: [], sessions: [] });

        // 3. Récupération Org ID
        let orgId = patientData.id ? undefined : undefined; // Pas d'ID connu au départ
        if (!orgId) {
             const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).limit(1).single();
             if(member) orgId = member.organization_id;
             else throw new Error("Organisation introuvable.");
        }

        // 4. INSERT en base
        const { data, error } = await supabase.from('patients').insert({
            organization_id: orgId,
            updated_at: new Date().toISOString(),
            last_interaction: new Date().toISOString(),
            iv: encIdentity.iv,
            encrypted_identity: encIdentity.content,
            preview_iv: encPreview.iv,
            encrypted_preview: encPreview.content,
            encrypted_file_key: encryptedFileKeyStr
        }).select('id').single();

        if (error) {
            Logger.error('DB', "Erreur création patient", error);
            throw error;
        }

        Logger.info('DB', "Patient created with Server ID:", data.id);
        return data.id;
    },

    /**
     * GESTION DES BROUILLONS
     * Sécurisé : Ne sauvegarde QUE si patient_id est présent (pour éviter les orphelins).
     */
    saveDraft: async (draftData: DraftPayload, sessionKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) {
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const patientId = draftData?.patient?.id;
        
        // PROTECTION ORPHELINS : On refuse de sauvegarder un draft sans ID patient en base
        if (!patientId) {
            Logger.warn('DB', "Skipping draft save: Missing Patient ID (Wait for creation)");
            return; 
        }

        Logger.debug('DB', 'Saving draft for patient', { patientId });
        
        const enc = await encryptBlob(draftData, sessionKey);
        
        // On écrase le brouillon existant pour ce patient (1 seul brouillon par patient par user)
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
            patient_id: patientId
        };

        if (existing) {
            await supabase.from('drafts').update(payload).eq('id', existing.id);
        } else {
            await supabase.from('drafts').insert(payload);
        }
    },

    getDraftsMetadata: async (): Promise<Record<string, string>> => {
        if (_isDemoMode) return {};

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return {};

        const { data, error } = await supabase
            .from('drafts')
            .select('patient_id, updated_at')
            .eq('user_id', user.id);

        if (error || !data) return {};

        const map: Record<string, string> = {};
        data.forEach((row: { patient_id: string | null; updated_at: string }) => {
            if (row.patient_id) {
                map[row.patient_id] = row.updated_at;
            }
        });
        return map;
    },

    getDraft: async (sessionKey: CryptoKey, patientId?: string): Promise<DraftPayload | null> => {
        if (_isDemoMode) return null;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        let query = supabase.from('drafts').select('*').eq('user_id', user.id);
        if (patientId) {
            query = query.eq('patient_id', patientId);
        } else {
            // Fallback legacy (brouillons orphelins v1)
            query = query.is('patient_id', null); 
        }

        const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();

        if (error || !data) return null;

        try {
            return await decryptBlob(data.iv, data.encrypted_data, sessionKey);
        } catch (e) {
            Logger.error('CRYPTO', "Failed to decrypt draft", e);
            return null;
        }
    },

    deleteDraft: async (patientId?: string): Promise<void> => {
        if (_isDemoMode) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        let query = supabase.from('drafts').delete().eq('user_id', user.id);
        if (patientId) {
            query = query.eq('patient_id', patientId);
        } else {
            query = query.is('patient_id', null);
        }
        await query;
    },

    /**
     * MISE À JOUR PATIENT (UPDATE)
     * Utilise FileKey existante. Ne fait plus d'INSERT (rôle de createPatient).
     */
    saveFile: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) {
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Utilisateur non connecté");

        if (!file.id) {
            throw new Error("ERREUR CRITIQUE: Tentative de mise à jour d'un patient sans ID.");
        }

        // 1. Récupération Clé Dossier
        const { data: existingPatient } = await supabase
            .from('patients')
            .select('encrypted_file_key, organization_id')
            .eq('id', file.id)
            .single();

        if (!existingPatient || !existingPatient.encrypted_file_key) {
            throw new Error("Dossier introuvable ou corrompu (Clé manquante).");
        }

        const [iv, content] = existingPatient.encrypted_file_key.split(':');
        const fileKey = await unwrapKey({ iv, content }, orgKey);

        Logger.info('DB', 'Updating patient file', { id: file.id });

        // 2. Chiffrement Identité & Preview
        const patientToSave = { ...file.patient, _archived: file.archived }; 
        const encIdentity = await encryptBlob(patientToSave, fileKey);

        const encPreview = await buildEncryptedPreview(file.patient, fileKey, {
            archived: file.archived,
            reports: file.reports,
            sessions: file.sessions,
        });

        // 3. UPDATE ONLY
        const patientPayload = {
            updated_at: new Date().toISOString(),
            last_interaction: file.lastInteraction,
            iv: encIdentity.iv,
            encrypted_identity: encIdentity.content,
            preview_iv: encPreview.iv,
            encrypted_preview: encPreview.content,
        };

        const { error: patError } = await supabase.from('patients').update(patientPayload).eq('id', file.id);
        if (patError) throw patError;

        // 4. Rapports (Upsert via ID)
        if (file.reports.length > 0) {
            const reportsPayloads = await Promise.all(file.reports.map(async (r) => {
                const enc = await encryptBlob(r, fileKey);
                return {
                    id: r.id,
                    user_id: user.id,
                    patient_id: file.id,
                    created_at: r.date,
                    type: r.type,
                    status: r.status,
                    iv: enc.iv,
                    encrypted_content: enc.content
                };
            }));
            await supabase.from('reports').upsert(reportsPayloads);
        }

        // 5. Sessions (Upsert via ID)
        if (file.sessions.length > 0) {
            const sessionsPayloads = await Promise.all(file.sessions.map(async (s) => {
                const enc = await encryptBlob(s.results, fileKey);
                return {
                    id: s.id,
                    user_id: user.id,
                    patient_id: file.id,
                    date: s.date,
                    test_id: s.testId,
                    test_name: s.testName,
                    iv: enc.iv,
                    encrypted_results: enc.content
                };
            }));
            await supabase.from('sessions').upsert(sessionsPayloads);
        }
    },

    loadPatientListPage: async (
        orgKey: CryptoKey,
        options?: { orgId?: string; offset?: number; limit?: number }
    ): Promise<{ files: PatientFile[]; hasMore: boolean; nextOffset: number }> => {
        if (_isDemoMode) {
            const sarahDemo = DEMO_PATIENTS.SARAH as typeof DEMO_PATIENTS.SARAH & { history?: TestSession[]; reports?: ReportMetadata[] };
            const history = sarahDemo.history || [];
            const reports = sarahDemo.reports || [];
            const sarahFile: PatientFile = {
                id: DEMO_PATIENTS.SARAH.id,
                patient: DEMO_PATIENTS.SARAH.patient,
                reports,
                sessions: history.length > 0 ? history : [{
                    id: 'demo-session-sarah',
                    date: new Date(Date.now() - 86400000 * 2).toISOString(),
                    testId: 'multi',
                    testName: 'Bilan Écriture',
                    results: DEMO_PATIENTS.SARAH.tests as Record<string, ScoreResult>
                }],
                lastInteraction: history.length > 0 ? history[history.length - 1].date : new Date(Date.now() - 86400000 * 2).toISOString(),
                archived: false
            };
            const demoPreview = buildPreviewPayload(sarahFile.patient, { archived: false, reports, sessions: sarahFile.sessions });
            sarahFile.previewMeta = toPreviewMeta(demoPreview);
            return { files: [sarahFile], hasMore: false, nextOffset: 1 };
        }

        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return { files: [], hasMore: false, nextOffset: options?.offset ?? 0 };

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

        if (resolvedOrgId) {
            query = query.eq('organization_id', resolvedOrgId);
        }

        const { data: patients, error } = await query;

        if (error) {
            Logger.error('DB', "Error loading patient list", error);
            return { files: [], hasMore: false, nextOffset: offset };
        }

        const files: PatientFile[] = [];
        const safePatients = patients || [];
        const hasMore = safePatients.length > pageSize;
        const pagePatients = safePatients.slice(0, pageSize);
        const missingPreviewIds = pagePatients
            .filter((row) => !row.encrypted_preview || !row.preview_iv)
            .map((row) => row.id);
        const identityById = new Map<string, { iv: string; encrypted_identity: string }>();

        if (missingPreviewIds.length > 0) {
            const { data: identities, error: identityError } = await supabase
                .from('patients')
                .select('id, iv, encrypted_identity')
                .in('id', missingPreviewIds);

            if (identityError) {
                Logger.error('DB', 'Error loading patient identities', identityError);
            } else {
                (identities || []).forEach((row: { id: string; iv: string; encrypted_identity: string }) => {
                    identityById.set(row.id, { iv: row.iv, encrypted_identity: row.encrypted_identity });
                });
            }
        }

        // Parallelize crypto operations with batching to avoid overwhelming Web Crypto
        const BATCH_SIZE = 10;
        const decryptPatient = async (row: typeof pagePatients[number]): Promise<PatientFile | null> => {
            try {
                if (!row.encrypted_file_key) return null;

                const [kIv, kContent] = row.encrypted_file_key.split(':');
                const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

                let patientData: Patient;
                let previewMeta: PatientDashboardPreviewMeta;
                let isArchived = false;

                if (row.encrypted_preview && row.preview_iv) {
                    const decryptedPreview = await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey);
                    const parsedPreview = parsePreviewPayload(decryptedPreview);
                    isArchived = parsedPreview.archived;
                    patientData = parsedPreview.patient;
                    previewMeta = parsedPreview.previewMeta;
                } else {
                    const identityRow = identityById.get(row.id);
                    if (!identityRow?.encrypted_identity) return null;
                    const fullData = await decryptBlob(identityRow.iv, identityRow.encrypted_identity, fileKey) as Patient & { _archived?: boolean };
                    const { _archived, ...identityData } = fullData;
                    isArchived = _archived === true;
                    patientData = { ...createEmptyPatient(), ...(identityData as Patient) };
                    previewMeta = buildFallbackPreviewMeta(patientData, isArchived);
                }

                return {
                    id: row.id,
                    patient: { ...patientData, organizationId: row.organization_id },
                    reports: [], 
                    sessions: [],
                    lastInteraction: row.last_interaction,
                    archived: isArchived,
                    encryptedFileKey: row.encrypted_file_key,
                    previewMeta,
                };
            } catch (e) {
                Logger.error('CRYPTO', `Failed to decrypt patient ${row.id}`, e);
                return null;
            }
        };

        // Process in batches of BATCH_SIZE for controlled parallelism
        for (let i = 0; i < pagePatients.length; i += BATCH_SIZE) {
            const batch = pagePatients.slice(i, i + BATCH_SIZE);
            const results = await Promise.allSettled(batch.map(decryptPatient));
            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    files.push(result.value);
                }
            }
        }

        return { files, hasMore, nextOffset: offset + pageSize };
    },

    loadPatientPreviewById: async (
        patientId: string,
        orgKey: CryptoKey,
        options?: { orgId?: string }
    ): Promise<PatientFile | null> => {
        if (_isDemoMode) return null;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        let query = supabase
            .from('patients')
            .select('id, last_interaction, encrypted_preview, preview_iv, encrypted_identity, iv, encrypted_file_key, organization_id')
            .eq('id', patientId);

        if (options?.orgId) {
            query = query.eq('organization_id', options.orgId);
        }

        const { data: row, error } = await query.maybeSingle();
        if (error || !row || !row.encrypted_file_key) return null;

        try {
            const [kIv, kContent] = row.encrypted_file_key.split(':');
            const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

            let patientData: Patient;
            let previewMeta: PatientDashboardPreviewMeta;
            let isArchived = false;

            if (row.encrypted_preview && row.preview_iv) {
                const decryptedPreview = await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey);
                const parsedPreview = parsePreviewPayload(decryptedPreview);
                patientData = parsedPreview.patient;
                previewMeta = parsedPreview.previewMeta;
                isArchived = parsedPreview.archived;
            } else if (row.encrypted_identity && row.iv) {
                const fullData = await decryptBlob(row.iv, row.encrypted_identity, fileKey) as Patient & { _archived?: boolean };
                const { _archived, ...identityData } = fullData;
                isArchived = _archived === true;
                patientData = { ...createEmptyPatient(), ...(identityData as Patient) };
                previewMeta = buildFallbackPreviewMeta(patientData, isArchived);
            } else {
                return null;
            }

            return {
                id: row.id,
                patient: { ...patientData, organizationId: row.organization_id },
                reports: [],
                sessions: [],
                lastInteraction: row.last_interaction,
                archived: isArchived,
                encryptedFileKey: row.encrypted_file_key,
                previewMeta,
            };
        } catch (e) {
            Logger.error('CRYPTO', `Failed to decrypt patient ${patientId}`, e);
            return null;
        }
    },

    loadPatientHistoryPage: async (
        patientId: string,
        orgKey: CryptoKey,
        options?: { encryptedFileKey?: string; reportOffset?: number; sessionOffset?: number; reportLimit?: number; sessionLimit?: number; skipReports?: boolean }
    ): Promise<{ reports: ReportMetadata[]; sessions: TestSession[]; hasMoreReports: boolean; hasMoreSessions: boolean; nextReportOffset: number; nextSessionOffset: number }> => {
        if (_isDemoMode) {
            return { reports: [], sessions: [], hasMoreReports: false, hasMoreSessions: false, nextReportOffset: 0, nextSessionOffset: 0 };
        }

        const reportOffset = options?.reportOffset ?? 0;
        const sessionOffset = options?.sessionOffset ?? 0;
        const reportLimit = options?.reportLimit;
        const sessionLimit = options?.sessionLimit ?? SESSIONS_PAGE_SIZE;
        const shouldPageReports = typeof reportLimit === 'number';
        const skipReports = options?.skipReports === true;

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

        if (!encryptedFileKey) {
            throw new Error('Clé dossier introuvable.');
        }

        const [kIv, kContent] = encryptedFileKey.split(':');
        const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

        let reportRows: Record<string, string>[] = [];
        if (!skipReports) {
            let reportQuery = supabase
                .from('reports')
                .select('id, created_at, type, status, iv, encrypted_content')
                .eq('patient_id', patientId)
                .order('created_at', { ascending: false });

            if (shouldPageReports) {
                reportQuery = reportQuery.range(reportOffset, reportOffset + reportLimit);
            }

            const { data: reportsData, error: reportsError } = await reportQuery;

            if (reportsError) throw reportsError;
            reportRows = (reportsData || []) as Record<string, string>[];
        }

        const { data: sessionsData, error: sessionsError } = await supabase
            .from('sessions')
            .select('id, date, test_id, test_name, iv, encrypted_results')
            .eq('patient_id', patientId)
            .order('date', { ascending: false })
            .range(sessionOffset, sessionOffset + sessionLimit);

        if (sessionsError) throw sessionsError;

        const sessionRows = sessionsData || [];
        const hasMoreReports = !skipReports && shouldPageReports ? reportRows.length > reportLimit : false;
        const hasMoreSessions = sessionRows.length > sessionLimit;

        const reportSlice = skipReports ? [] : (shouldPageReports ? reportRows.slice(0, reportLimit) : reportRows);
        const sessionSlice = sessionRows.slice(0, sessionLimit);

        const reports = await Promise.all(reportSlice.map(async (r: Record<string, string>) => {
            const decrypted = await decryptBlob(r.iv, r.encrypted_content, fileKey);
            return { ...(decrypted as Record<string, unknown>), id: r.id, date: r.created_at, type: r.type, status: r.status } as ReportMetadata;
        }));

        const sessions = await Promise.all(sessionSlice.map(async (s: Record<string, string>) => {
            const decryptedResults = await decryptBlob(s.iv, s.encrypted_results, fileKey);
            return {
                id: s.id,
                date: s.date,
                testId: s.test_id,
                testName: s.test_name,
                results: decryptedResults
            } as TestSession;
        }));

        return {
            reports,
            sessions,
            hasMoreReports,
            hasMoreSessions,
            nextReportOffset: !skipReports && shouldPageReports ? reportOffset + reportLimit : 0,
            nextSessionOffset: sessionOffset + sessionLimit
        };
    },

    loadPatientDetails: async (patientId: string, orgKey: CryptoKey, options?: { reportOffset?: number; sessionOffset?: number; reportLimit?: number; sessionLimit?: number; skipReports?: boolean }): Promise<{ reports: ReportMetadata[]; sessions: TestSession[]; patient: Patient; hasMoreReports: boolean; hasMoreSessions: boolean; nextReportOffset: number; nextSessionOffset: number }> => {
        if (_isDemoMode) {
            if (patientId === DEMO_PATIENTS.LEO.id || patientId === 'demo-patient-imported') {
                return {
                    reports: [],
                    sessions: [],
                    patient: DEMO_PATIENTS.LEO.patient,
                    hasMoreReports: false,
                    hasMoreSessions: false,
                    nextReportOffset: 0,
                    nextSessionOffset: 0
                };
            }
            if (patientId === DEMO_PATIENTS.SARAH.id) {
                const sarahDemo = DEMO_PATIENTS.SARAH as typeof DEMO_PATIENTS.SARAH & { history?: TestSession[]; reports?: ReportMetadata[] };
                const history = sarahDemo.history || [];
                const reports = sarahDemo.reports || [];
                return {
                    reports,
                    sessions: history,
                    patient: DEMO_PATIENTS.SARAH.patient,
                    hasMoreReports: false,
                    hasMoreSessions: false,
                    nextReportOffset: 0,
                    nextSessionOffset: 0
                };
            }
            return {
                reports: [],
                sessions: [],
                patient: DEMO_PATIENTS.SARAH.patient,
                hasMoreReports: false,
                hasMoreSessions: false,
                nextReportOffset: 0,
                nextSessionOffset: 0
            };
        }

        const { data: { user } } = await supabase.auth.getUser();
        if(!user) throw new Error("Non connecté");

        const { data: patientRow, error: pError } = await supabase
            .from('patients')
            .select('encrypted_file_key, encrypted_identity, iv, organization_id')
            .eq('id', patientId)
            .single();

        if (pError || !patientRow || !patientRow.encrypted_file_key) {
            throw new Error("Impossible de récupérer le dossier patient.");
        }

        const [kIv, kContent] = patientRow.encrypted_file_key.split(':');
        const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

        const decryptedIdentity = await decryptBlob(patientRow.iv, patientRow.encrypted_identity, fileKey) as Patient & { _archived?: boolean };
        const { _archived, ...identityWithoutArchived } = decryptedIdentity;
        const patientFull = { ...identityWithoutArchived, id: patientId, organizationId: patientRow.organization_id } as Patient;

        const history = await StorageService.loadPatientHistoryPage(patientId, orgKey, {
            encryptedFileKey: patientRow.encrypted_file_key,
            reportOffset: options?.reportOffset,
            sessionOffset: options?.sessionOffset,
            reportLimit: options?.reportLimit,
            sessionLimit: options?.sessionLimit
        });

        return {
            reports: history.reports,
            sessions: history.sessions,
            patient: patientFull,
            hasMoreReports: history.hasMoreReports,
            hasMoreSessions: history.hasMoreSessions,
            nextReportOffset: history.nextReportOffset,
            nextSessionOffset: history.nextSessionOffset
        };
    },

    deleteFile: async (id: string): Promise<void> => {
        if (_isDemoMode) return;
        await supabase.from('reports').delete().eq('patient_id', id);
        await supabase.from('sessions').delete().eq('patient_id', id);
        await supabase.from('drafts').delete().eq('patient_id', id);
        await supabase.from('patients').delete().eq('id', id);
    },

    toggleArchive: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) return;
        const newFile = { ...file, archived: !file.archived };
        await StorageService.saveFile(newFile, orgKey);
    },

    
};



