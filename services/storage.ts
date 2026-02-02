
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
     * GESTION DES BROUILLONS (MULTI-DRAFTS)
     */
    saveDraft: async (draftData: any, key: CryptoKey): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const patientId = draftData?.patient?.id || null;
        
        // Chiffrement
        const enc = await encryptBlob(draftData, key);
        
        // Logique : On cherche s'il existe déjà un brouillon pour CE patient (ou un brouillon orphelin si pas d'ID)
        let query = supabase.from('drafts').select('id').eq('user_id', user.id);
        
        if (patientId) {
            query = query.eq('patient_id', patientId);
        } else {
            query = query.is('patient_id', null);
        }

        const { data: existing } = await query.maybeSingle();

        const payload: any = {
            user_id: user.id,
            updated_at: new Date().toISOString(),
            iv: enc.iv,
            encrypted_data: enc.content,
            patient_id: patientId // Peut être null pour un nouveau bilan non sauvegardé
        };

        if (existing) {
            await supabase.from('drafts').update(payload).eq('id', existing.id);
        } else {
            await supabase.from('drafts').insert(payload);
        }
    },

    // Charge uniquement les métadonnées (ID patient + Date) pour afficher les badges dans le Dashboard
    getDraftsMetadata: async (): Promise<Record<string, string>> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return {};

        const { data, error } = await supabase
            .from('drafts')
            .select('patient_id, updated_at')
            .eq('user_id', user.id);

        if (error || !data) return {};

        // Retourne une map : { 'uuid-patient': '2023-10-27T...' }
        const map: Record<string, string> = {};
        data.forEach((row: any) => {
            if (row.patient_id) {
                map[row.patient_id] = row.updated_at;
            }
        });
        return map;
    },

    // Charge un brouillon spécifique
    getDraft: async (key: CryptoKey, patientId?: string): Promise<any | null> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        let query = supabase.from('drafts').select('*').eq('user_id', user.id);
        
        if (patientId) {
            query = query.eq('patient_id', patientId);
        } else {
            // Si pas de patientId, on cherche le dernier brouillon orphelin (création)
            // ou le dernier tout court si on veut reprendre le travail générique
            query = query.is('patient_id', null); 
        }

        // On prend le plus récent correspondant aux critères
        const { data, error } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();

        if (error || !data) return null;

        try {
            return await decryptBlob(data.iv, data.encrypted_data, key);
        } catch (e) {
            console.error("Erreur déchiffrement brouillon:", e);
            return null;
        }
    },

    // Supprime le brouillon associé à un patient (ou le brouillon orphelin)
    deleteDraft: async (patientId?: string): Promise<void> => {
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
     * @deprecated Utiliser deleteDraft(patientId) à la place
     */
    clearDraft: async (): Promise<void> => {
        // Fallback pour compatibilité
    },

    /**
     * Sauvegarde transactionnelle (Patient + Reports + Sessions)
     */
    saveFile: async (file: PatientFile, key: CryptoKey): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Utilisateur non connecté");

        // 1. Patient
        // IMPORTANT: On stocke 'archived' dans un champ JSON ou colonne dédiée si le schéma le permettait.
        // Ici, on va l'inclure dans le BLOB chiffré ET potentiellement on pourrait ajouter une colonne 'status' dans Supabase plus tard.
        // Pour l'instant, on se base sur le BLOB chiffré qui contient l'objet Patient complet.
        
        const encPatient = await encryptBlob(file.patient, key);
        
        // Note: 'archived' n'est pas dans l'objet 'Patient', mais dans 'PatientFile'.
        // Pour persister l'état 'archived' sans changer le schéma SQL 'patients', 
        // on va l'ajouter dans l'objet patient chiffré comme métadonnée cachée ou on utilise une astuce.
        // MIEUX : On ajoute une propriété cachée au patient avant chiffrement.
        const patientToSave = { ...file.patient, _archived: file.archived }; 
        const encIdentity = await encryptBlob(patientToSave, key);

        const patientPayload = {
            id: file.id,
            user_id: user.id, 
            updated_at: new Date().toISOString(),
            last_interaction: file.lastInteraction,
            iv: encIdentity.iv,
            encrypted_identity: encIdentity.content
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

    loadPatientList: async (key: CryptoKey): Promise<PatientFile[]> => {
        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return [];

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
                // On récupère le patient et son état archivé potentiel
                const decryptedData = await decryptBlob(row.iv, row.encrypted_identity, key) as any;
                
                // Nettoyage de la propriété cachée _archived pour l'objet Patient
                const isArchived = decryptedData._archived === true;
                delete decryptedData._archived;
                
                const patientData = decryptedData as Patient;

                files.push({
                    id: row.id,
                    patient: patientData,
                    reports: [], 
                    sessions: [],
                    lastInteraction: row.last_interaction,
                    archived: isArchived
                });
            } catch (e) {
                console.error(`Erreur déchiffrement patient ${row.id}`, e);
            }
        }

        return files.sort((a, b) => 
            new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime()
        );
    },

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
        // Suppression en cascade via FK théoriquement, mais on force le nettoyage
        await supabase.from('reports').delete().eq('patient_id', id);
        await supabase.from('sessions').delete().eq('patient_id', id);
        await supabase.from('drafts').delete().eq('patient_id', id);
        await supabase.from('patients').delete().eq('id', id);
    },

    toggleArchive: async (file: PatientFile, key: CryptoKey): Promise<void> => {
        const newFile = { ...file, archived: !file.archived };
        await StorageService.saveFile(newFile, key);
    }
};
