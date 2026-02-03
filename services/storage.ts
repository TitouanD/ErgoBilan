
import { supabase } from './db';
import { PatientFile, Patient, ReportMetadata, TestSession } from '../types';
import { encryptData, decryptData, generateSymetricKey, wrapKey, unwrapKey } from '../utils/crypto';
import { Logger } from '../utils/logger';

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
     * GESTION DES BROUILLONS (Reste chiffré avec SESSION_KEY/PIN car privé)
     */
    saveDraft: async (draftData: any, sessionKey: CryptoKey): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const patientId = draftData?.patient?.id || null;
        Logger.debug('DB', 'Saving draft (Private)', { patientId });
        
        const enc = await encryptBlob(draftData, sessionKey);
        
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
            patient_id: patientId
        };

        if (existing) {
            await supabase.from('drafts').update(payload).eq('id', existing.id);
        } else {
            await supabase.from('drafts').insert(payload);
        }
    },

    getDraftsMetadata: async (): Promise<Record<string, string>> => {
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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null;

        let query = supabase.from('drafts').select('*').eq('user_id', user.id);
        if (patientId) {
            query = query.eq('patient_id', patientId);
        } else {
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
     * SAUVEGARDE PATIENT (Architecture 3-Level Key)
     * Utilise OrgKey pour déverrouiller ou créer la FileKey.
     */
    saveFile: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Utilisateur non connecté");

        // 1. Récupération ou Création de la Clé du Dossier (FileKey)
        let fileKey: CryptoKey;
        let encryptedFileKeyStr: string;

        // On vérifie si le dossier existe déjà pour récupérer sa clé
        const { data: existingPatient } = await supabase
            .from('patients')
            .select('encrypted_file_key, organization_id')
            .eq('id', file.id)
            .maybeSingle();

        if (existingPatient && existingPatient.encrypted_file_key) {
            // Cas A : Dossier existant -> On déchiffre la clé du dossier avec l'OrgKey
            const [iv, content] = existingPatient.encrypted_file_key.split(':');
            fileKey = await unwrapKey({ iv, content }, orgKey);
            encryptedFileKeyStr = existingPatient.encrypted_file_key; // On garde la même version chiffrée
            
            // Assurer que l'objet file a l'organizationId correct
            if (!file.patient.organizationId) {
                file.patient.organizationId = existingPatient.organization_id;
            }
        } else {
            // Cas B : Nouveau Dossier -> On génère une nouvelle clé unique
            Logger.info('CRYPTO', "Generating new File Key for patient " + file.id);
            fileKey = await generateSymetricKey();
            const wrapped = await wrapKey(fileKey, orgKey);
            encryptedFileKeyStr = `${wrapped.iv}:${wrapped.content}`;
        }

        // Si l'organizationId est toujours manquant, on le récupère du user courant
        if (!file.patient.organizationId) {
             const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).limit(1).single();
             if(member) {
                 file.patient.organizationId = member.organization_id;
             } else {
                 throw new Error("Impossible de lier le patient : L'utilisateur n'appartient à aucune organisation.");
             }
        }

        Logger.info('DB', 'Saving patient file (Encrypted with FileKey)', { id: file.id });

        // 2. Chiffrement de l'identité avec la FileKey
        const patientToSave = { ...file.patient, _archived: file.archived }; 
        const encIdentity = await encryptBlob(patientToSave, fileKey);

        // CONSTRUCTION PAYLOAD PATIENT (CORRECTIF SCHEMA V1.3)
        // Note: La table 'patients' ne contient PAS de colonne 'user_id'. 
        // L'accès est géré par 'organization_id' et la table de jointure 'organization_members'.
        const patientPayload = {
            id: file.id,
            organization_id: file.patient.organizationId, // OBLIGATOIRE
            updated_at: new Date().toISOString(),
            last_interaction: file.lastInteraction,
            iv: encIdentity.iv,
            encrypted_identity: encIdentity.content,
            encrypted_file_key: encryptedFileKeyStr
            // user_id: user.id <-- SUPPRIMÉ CAR INEXISTANT EN DB
        };

        const { error: patError } = await supabase.from('patients').upsert(patientPayload);
        if (patError) {
            Logger.error('DB', "Erreur Save Patient", patError);
            throw patError;
        }

        // 3. Rapports (Chiffrés avec FileKey)
        // La table 'reports' contient bien 'user_id' selon le schéma
        if (file.reports.length > 0) {
            const reportsPayloads = await Promise.all(file.reports.map(async (r) => {
                const enc = await encryptBlob(r, fileKey);
                return {
                    id: r.id,
                    user_id: user.id, // OK ici
                    patient_id: file.id,
                    created_at: r.date,
                    type: r.type,
                    status: r.status,
                    iv: enc.iv,
                    encrypted_content: enc.content
                };
            }));
            const { error: repError } = await supabase.from('reports').upsert(reportsPayloads);
            if (repError) Logger.error('DB', "Erreur Save Reports", repError);
        }

        // 4. Sessions (Chiffrées avec FileKey)
        // La table 'sessions' contient bien 'user_id' selon le schéma
        if (file.sessions.length > 0) {
            const sessionsPayloads = await Promise.all(file.sessions.map(async (s) => {
                const enc = await encryptBlob(s.results, fileKey);
                return {
                    id: s.id,
                    user_id: user.id, // OK ici
                    patient_id: file.id,
                    date: s.date,
                    test_id: s.testId,
                    test_name: s.testName,
                    iv: enc.iv,
                    encrypted_results: enc.content
                };
            }));
            const { error: sessError } = await supabase.from('sessions').upsert(sessionsPayloads);
            if (sessError) Logger.error('DB', "Erreur Save Sessions", sessError);
        }
    },

    loadPatientList: async (orgKey: CryptoKey): Promise<PatientFile[]> => {
        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return [];

        // On récupère via l'organisation (grâce aux RLS)
        // Note: La query filtre implicitement via RLS, mais on peut être explicite si besoin
        const { data: patients, error } = await supabase
            .from('patients')
            .select('*'); // RLS se charge de filtrer par orga

        if (error) {
            Logger.error('DB', "Error loading patient list", error);
            return [];
        }

        const files: PatientFile[] = [];

        for (const row of patients) {
            try {
                if (!row.encrypted_file_key) {
                    Logger.warn('CRYPTO', `Patient ${row.id} has no file key. Skipping (Legacy format).`);
                    continue;
                }

                // 1. Déchiffrer la FileKey avec l'OrgKey
                const [kIv, kContent] = row.encrypted_file_key.split(':');
                const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

                // 2. Déchiffrer l'identité avec la FileKey
                const decryptedData = await decryptBlob(row.iv, row.encrypted_identity, fileKey) as any;
                
                const isArchived = decryptedData._archived === true;
                delete decryptedData._archived;
                const patientData = decryptedData as Patient;

                files.push({
                    id: row.id,
                    patient: { ...patientData, organizationId: row.organization_id },
                    reports: [], 
                    sessions: [],
                    lastInteraction: row.last_interaction,
                    archived: isArchived,
                    encryptedFileKey: row.encrypted_file_key // On garde la ref
                });
            } catch (e) {
                Logger.error('CRYPTO', `Failed to decrypt patient ${row.id}`, e);
            }
        }

        return files.sort((a, b) => 
            new Date(b.lastInteraction).getTime() - new Date(a.lastInteraction).getTime()
        );
    },

    loadPatientDetails: async (patientId: string, orgKey: CryptoKey): Promise<{ reports: ReportMetadata[], sessions: TestSession[] }> => {
        const { data: { user } } = await supabase.auth.getUser();
        if(!user) throw new Error("Non connecté");

        // 1. Récupérer la clé du dossier (FileKey) depuis la table patients
        const { data: patientRow, error: pError } = await supabase
            .from('patients')
            .select('encrypted_file_key')
            .eq('id', patientId)
            .single();

        if (pError || !patientRow || !patientRow.encrypted_file_key) {
            throw new Error("Impossible de récupérer la clé du dossier.");
        }

        const [kIv, kContent] = patientRow.encrypted_file_key.split(':');
        const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

        Logger.debug('DB', 'Loading detailed patient data', { patientId });

        // 2. Charger Reports
        const { data: reportsData } = await supabase
            .from('reports')
            .select('*')
            .eq('patient_id', patientId);

        const reports = await Promise.all((reportsData || []).map(async (r: any) => {
            const decrypted = await decryptBlob(r.iv, r.encrypted_content, fileKey);
            return { ...decrypted, id: r.id, date: r.created_at, type: r.type, status: r.status } as ReportMetadata;
        }));

        // 3. Charger Sessions
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

        return { reports, sessions };
    },

    deleteFile: async (id: string): Promise<void> => {
        Logger.warn('DB', 'DELETING PATIENT FILE', { id });
        // RLS assure que seul un membre de l'orga peut supprimer
        await supabase.from('reports').delete().eq('patient_id', id);
        await supabase.from('sessions').delete().eq('patient_id', id);
        await supabase.from('drafts').delete().eq('patient_id', id);
        await supabase.from('patients').delete().eq('id', id);
    },

    toggleArchive: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        const newFile = { ...file, archived: !file.archived };
        // saveFile gère la récupération de la FileKey existante via orgKey
        await StorageService.saveFile(newFile, orgKey);
    }
};
