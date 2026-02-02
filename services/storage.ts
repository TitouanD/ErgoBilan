
import { supabase } from './db';
import { PatientFile, Patient, ReportMetadata, TestSession } from '../types';
import { encryptData, decryptData } from '../utils/crypto';

// --- HELPERS CHIFFREMENT ---

const encryptBlob = async (data: any, key: CryptoKey) => {
    const res = await encryptData(data, key);
    return { iv: res.iv, content: res.content };
};

const decryptBlob = async (iv: string, content: string, key: CryptoKey) => {
    return await decryptData({ iv, content }, key);
};

export const StorageService = {
    
    init: async (key: CryptoKey): Promise<void> => {
        // No-op pour Supabase pur
    },

    /**
     * GESTION DU BROUILLON (WIZARD)
     */
    saveDraft: async (draftData: any, key: CryptoKey): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const enc = await encryptBlob(draftData, key);
        
        const { data: existing } = await supabase
            .from('drafts')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        const patientId = draftData?.patient?.id || null;

        const payload: any = {
            user_id: user.id,
            updated_at: new Date().toISOString(),
            iv: enc.iv,
            encrypted_data: enc.content
        };
        
        if (patientId) {
             payload.patient_id = patientId;
        }

        if (existing) {
            await supabase.from('drafts').update(payload).eq('id', existing.id);
        } else {
            await supabase.from('drafts').insert(payload);
        }
    },

    getDraft: async (key: CryptoKey): Promise<any | null> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        const { data, error } = await supabase
            .from('drafts')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        if (error || !data) return null;

        try {
            return await decryptBlob(data.iv, data.encrypted_data, key);
        } catch (e) {
            console.error("Erreur déchiffrement brouillon:", e);
            return null;
        }
    },

    clearDraft: async (): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        await supabase.from('drafts').delete().eq('user_id', user.id);
    },

    /**
     * Sauvegarde transactionnelle (Patient + Reports + Sessions)
     */
    saveFile: async (file: PatientFile, key: CryptoKey): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Utilisateur non connecté");

        // 1. Patient
        const encPatient = await encryptBlob(file.patient, key);
        const patientPayload = {
            id: file.id,
            user_id: user.id, 
            updated_at: new Date().toISOString(),
            last_interaction: file.lastInteraction,
            iv: encPatient.iv,
            encrypted_identity: encPatient.content
        };

        const { error: patError } = await supabase.from('patients').upsert(patientPayload);
        if (patError) throw patError;

        // 2. Rapports
        if (file.reports.length > 0) {
            const reportsPayloads = await Promise.all(file.reports.map(async (r) => {
                const enc = await encryptBlob(r, key);
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

        // 3. Sessions
        if (file.sessions.length > 0) {
            const sessionsPayloads = await Promise.all(file.sessions.map(async (s) => {
                const enc = await encryptBlob(s.results, key);
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

    /**
     * OPTIMISATION PERF: Charge uniquement la liste des patients (sans les gros blobs reports/sessions)
     */
    loadPatientList: async (key: CryptoKey): Promise<PatientFile[]> => {
        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return [];

        // On ne sélectionne QUE la table patients
        const { data: patients, error } = await supabase
            .from('patients')
            .select('*')
            .eq('user_id', user.id);

        if (error) {
            console.error("Erreur chargement liste patients:", error);
            return [];
        }

        const files: PatientFile[] = [];

        for (const row of patients) {
            try {
                const patientData = await decryptBlob(row.iv, row.encrypted_identity, key) as Patient;
                
                // On renvoie une structure "légère" (tableaux vides pour reports/sessions)
                // Ils seront chargés à la demande via loadPatientDetails
                files.push({
                    id: row.id,
                    patient: patientData,
                    reports: [], 
                    sessions: [],
                    lastInteraction: row.last_interaction
                });
            } catch (e) {
                console.error(`Erreur déchiffrement patient ${row.id}`, e);
            }
        }

        return files.sort((a, b) => 
            new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime()
        );
    },

    /**
     * OPTIMISATION PERF: Charge les détails complets pour UN patient spécifique
     */
    loadPatientDetails: async (patientId: string, key: CryptoKey): Promise<{ reports: ReportMetadata[], sessions: TestSession[] }> => {
        const { data: { user } } = await supabase.auth.getUser();
        if(!user) throw new Error("Non connecté");

        // 1. Charger Reports
        const { data: reportsData } = await supabase
            .from('reports')
            .select('*')
            .eq('patient_id', patientId)
            .eq('user_id', user.id);

        const reports = await Promise.all((reportsData || []).map(async (r: any) => {
            const decrypted = await decryptBlob(r.iv, r.encrypted_content, key);
            return { ...decrypted, id: r.id, date: r.created_at, type: r.type, status: r.status } as ReportMetadata;
        }));

        // 2. Charger Sessions
        const { data: sessionsData } = await supabase
            .from('sessions')
            .select('*')
            .eq('patient_id', patientId)
            .eq('user_id', user.id);

        const sessions = await Promise.all((sessionsData || []).map(async (s: any) => {
            const decryptedResults = await decryptBlob(s.iv, s.encrypted_results, key);
            return {
                id: s.id,
                date: s.date,
                testId: s.test_id,
                testName: s.test_name,
                results: decryptedResults
            } as TestSession;
        }));

        return { reports, sessions };
    },

    deleteFile: async (id: string): Promise<void> => {
        await supabase.from('patients').delete().eq('id', id);
    }
};
