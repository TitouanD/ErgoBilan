
import { supabase } from './db';
import { PatientFile, Patient, ReportMetadata, TestSession, DraftPayload } from '../types';
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
        
        const previewData = {
            firstName: patientData.firstName,
            lastName: patientData.lastName,
            age: patientData.age,
            classLevel: patientData.classLevel,
            gender: patientData.gender,
            _archived: false
        };
        const encPreview = await encryptBlob(previewData, fileKey);

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

        const previewData = {
            id: file.patient.id,
            firstName: file.patient.firstName,
            lastName: file.patient.lastName,
            age: file.patient.age,
            classLevel: file.patient.classLevel,
            gender: file.patient.gender,
            _archived: file.archived
        };
        const encPreview = await encryptBlob(previewData, fileKey);

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
                    results: DEMO_PATIENTS.SARAH.tests as Record<string, import('../types').ScoreResult>
                }],
                lastInteraction: history.length > 0 ? history[history.length - 1].date : new Date(Date.now() - 86400000 * 2).toISOString(),
                archived: false
            };
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
                let isArchived = false;

                if (row.encrypted_preview && row.preview_iv) {
                    const preview = await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey) as Patient & { _archived?: boolean };
                    isArchived = preview?._archived === true;
                    if (preview && typeof preview === 'object' && '_archived' in preview) {
                        delete (preview as { _archived?: boolean })._archived;
                    }
                    patientData = { ...createEmptyPatient(), ...preview };
                } else {
                    const identityRow = identityById.get(row.id);
                    if (!identityRow?.encrypted_identity) return null;
                    const fullData = await decryptBlob(identityRow.iv, identityRow.encrypted_identity, fileKey) as Patient & { _archived?: boolean };
                    isArchived = fullData._archived === true;
                    delete fullData._archived;
                    patientData = fullData as Patient;
                }

                return {
                    id: row.id,
                    patient: { ...patientData, organizationId: row.organization_id },
                    reports: [], 
                    sessions: [],
                    lastInteraction: row.last_interaction,
                    archived: isArchived,
                    encryptedFileKey: row.encrypted_file_key
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
            let isArchived = false;

            if (row.encrypted_preview && row.preview_iv) {
                const preview = await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey) as Patient & { _archived?: boolean };
                isArchived = preview?._archived === true;
                if (preview && typeof preview === 'object' && '_archived' in preview) {
                    delete (preview as { _archived?: boolean })._archived;
                }
                patientData = { ...createEmptyPatient(), ...preview };
            } else if (row.encrypted_identity && row.iv) {
                const fullData = await decryptBlob(row.iv, row.encrypted_identity, fileKey) as Patient & { _archived?: boolean };
                isArchived = fullData._archived === true;
                delete fullData._archived;
                patientData = fullData as Patient;
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
                encryptedFileKey: row.encrypted_file_key
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



