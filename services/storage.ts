
import { supabase } from './db';
import { PatientFile, Patient, ReportMetadata, TestSession } from '../types';
import { encryptData, decryptData, generateSymetricKey, wrapKey, unwrapKey } from '../utils/crypto';
import { Logger } from '../utils/logger';
import { DEMO_PATIENTS } from '../data/demoData';
import { RealtimeChannel } from '@supabase/supabase-js';

// --- HELPERS CHIFFREMENT ---

const encryptBlob = async (data: any, key: CryptoKey) => {
    const res = await encryptData(data, key);
    return { iv: res.iv, content: res.content };
};

const decryptBlob = async (iv: string, content: string, key: CryptoKey) => {
    return await decryptData({ iv, content }, key);
};

// --- DEMO MODE STATE ---
let _isDemoMode = false;

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

    // --- REALTIME SUBSCRIPTIONS ---
    subscribeToChanges: (callback: () => void): { unsubscribe: () => void } => {
        if (_isDemoMode) return { unsubscribe: () => {} };

        // Abonnement aux changements PostgreSQL (CDC)
        const channel = supabase.channel('global-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_questionnaires' }, callback)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'patients' }, callback)
            .subscribe();

        return {
            unsubscribe: () => {
                supabase.removeChannel(channel);
            }
        };
    },

    /**
     * NOUVEAU : CRÉATION STRICTE DU PATIENT (INSERT)
     * Génère l'ID serveur et la FileKey.
     * Appelé automatiquement dès que Nom/Prénom sont saisis.
     */
    createPatient: async (patientData: Patient, orgKey: CryptoKey): Promise<string> => {
        if (_isDemoMode) return 'demo-new-' + Date.now();

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
            gender: patientData.gender
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
    saveDraft: async (draftData: any, sessionKey: CryptoKey): Promise<void> => {
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

        const payload: any = {
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
        data.forEach((row: any) => {
            if (row.patient_id) {
                map[row.patient_id] = row.updated_at;
            }
        });
        return map;
    },

    getDraft: async (sessionKey: CryptoKey, patientId?: string): Promise<any | null> => {
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

    clearDraft: async (): Promise<void> => {},

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
            gender: file.patient.gender
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

    loadPatientList: async (orgKey: CryptoKey): Promise<PatientFile[]> => {
        if (_isDemoMode) {
            const sarahFile: PatientFile = {
                id: DEMO_PATIENTS.SARAH.id,
                patient: DEMO_PATIENTS.SARAH.patient,
                reports: [],
                sessions: [{
                    id: 'demo-session-sarah',
                    date: new Date(Date.now() - 86400000 * 2).toISOString(),
                    testId: 'multi',
                    testName: 'Bilan Écriture',
                    results: DEMO_PATIENTS.SARAH.tests as any
                }],
                lastInteraction: new Date(Date.now() - 86400000 * 2).toISOString(),
                archived: false
            };
            return [sarahFile];
        }

        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return [];

        const { data: patients, error } = await supabase
            .from('patients')
            .select('id, updated_at, last_interaction, encrypted_preview, preview_iv, encrypted_file_key, organization_id, iv, encrypted_identity')
            .order('last_interaction', { ascending: false });

        if (error) {
            Logger.error('DB', "Error loading patient list", error);
            return [];
        }

        const files: PatientFile[] = [];

        for (const row of patients) {
            try {
                if (!row.encrypted_file_key) continue;

                const [kIv, kContent] = row.encrypted_file_key.split(':');
                const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

                let patientData: Patient;
                let isArchived = false;

                if (row.encrypted_preview && row.preview_iv) {
                    const preview = await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey);
                    patientData = { ...createEmptyPatient(), ...preview };
                } else {
                    const fullData = await decryptBlob(row.iv, row.encrypted_identity, fileKey) as any;
                    isArchived = fullData._archived === true;
                    delete fullData._archived;
                    patientData = fullData as Patient;
                }

                files.push({
                    id: row.id,
                    patient: { ...patientData, organizationId: row.organization_id },
                    reports: [], 
                    sessions: [],
                    lastInteraction: row.last_interaction,
                    archived: isArchived,
                    encryptedFileKey: row.encrypted_file_key
                });
            } catch (e) {
                Logger.error('CRYPTO', `Failed to decrypt patient ${row.id}`, e);
            }
        }

        return files;
    },

    loadPatientDetails: async (patientId: string, orgKey: CryptoKey): Promise<{ reports: ReportMetadata[], sessions: TestSession[], patient: Patient }> => {
        if (_isDemoMode) {
            if (patientId === DEMO_PATIENTS.LEO.id || patientId === 'demo-patient-imported') {
                return {
                    reports: [],
                    sessions: [],
                    patient: DEMO_PATIENTS.LEO.patient
                };
            }
            if (patientId === DEMO_PATIENTS.SARAH.id) {
                const history = (DEMO_PATIENTS.SARAH as any).history || [];
                return {
                    reports: [],
                    sessions: history,
                    patient: DEMO_PATIENTS.SARAH.patient
                };
            }
            return {
                reports: [],
                sessions: [],
                patient: DEMO_PATIENTS.SARAH.patient
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

        const decryptedIdentity = await decryptBlob(patientRow.iv, patientRow.encrypted_identity, fileKey) as any;
        delete decryptedIdentity._archived;
        const patientFull = { ...decryptedIdentity, id: patientId, organizationId: patientRow.organization_id } as Patient;

        const { data: reportsData } = await supabase
            .from('reports')
            .select('*')
            .eq('patient_id', patientId);

        const reports = await Promise.all((reportsData || []).map(async (r: any) => {
            const decrypted = await decryptBlob(r.iv, r.encrypted_content, fileKey);
            return { ...decrypted, id: r.id, date: r.created_at, type: r.type, status: r.status } as ReportMetadata;
        }));

        const { data: sessionsData } = await supabase
            .from('sessions')
            .select('*')
            .eq('patient_id', patientId);

        const sessions = await Promise.all((sessionsData || []).map(async (s: any) => {
            const decryptedResults = await decryptBlob(s.iv, s.encrypted_results, fileKey);
            return {
                id: s.id,
                date: s.date,
                testId: s.test_id,
                testName: s.test_name,
                results: decryptedResults
            } as TestSession;
        }));

        return { reports, sessions, patient: patientFull };
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

    getPendingQuestionnaire: async (id: string): Promise<{ status: string; family_encrypted_data: string | null } | null> => {
        if (_isDemoMode) {
            if (id === 'demo-q1') return { status: 'pending', family_encrypted_data: null };
            return null;
        }

        const { data, error } = await supabase
            .from('pending_questionnaires')
            .select('status, family_encrypted_data')
            .eq('id', id)
            .single();

        if (error) throw error;
        return data;
    },

    submitQuestionnaire: async (id: string, encryptedData: string): Promise<void> => {
        if (_isDemoMode) return;

        const { error } = await supabase
            .from('pending_questionnaires')
            .update({
                family_encrypted_data: encryptedData,
                status: 'completed'
            })
            .eq('id', id);

        if (error) throw error;
    }
};
