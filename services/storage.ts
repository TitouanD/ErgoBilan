
import { supabase } from './db';
import { PatientFile, Patient, ReportMetadata, TestSession } from '../types';
import { encryptData, decryptData, generateSymetricKey, wrapKey, unwrapKey } from '../utils/crypto';
import { Logger } from '../utils/logger';
import { DEMO_PATIENTS } from '../data/demoData';

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
    clothingButtons: '', clothingLaces: '', clothingZippers: '', clothingSensory: '',
    schoolAttention: '', writingIssues: '', toolUsage: '', schoolAccommodations: '',
    screenTime: '', hobbies: '', socialBehavior: '', emotionalRegulation: '',
    remarks: '', priorities: ''
});

export const StorageService = {
    
    setDemoMode: (active: boolean) => {
        _isDemoMode = active;
        Logger.warn('DB', `Storage Service switched to DEMO MODE: ${active}`);
    },

    /**
     * GESTION DES BROUILLONS (Reste chiffré avec SESSION_KEY/PIN car privé)
     */
    saveDraft: async (draftData: any, sessionKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) {
            Logger.info('DB', '[DEMO] Draft saved to volatile memory');
            return;
        }

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
     * SAUVEGARDE PATIENT (Architecture 3-Level Key)
     * Utilise OrgKey pour déverrouiller ou créer la FileKey.
     */
    saveFile: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) {
            Logger.info('DB', '[DEMO] File save simulated');
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Utilisateur non connecté");

        // 1. Récupération ou Création de la Clé du Dossier (FileKey)
        let fileKey: CryptoKey;
        let encryptedFileKeyStr: string;

        const { data: existingPatient } = await supabase
            .from('patients')
            .select('encrypted_file_key, organization_id')
            .eq('id', file.id)
            .maybeSingle();

        if (existingPatient && existingPatient.encrypted_file_key) {
            // Cas A : Dossier existant -> On déchiffre la clé
            const [iv, content] = existingPatient.encrypted_file_key.split(':');
            fileKey = await unwrapKey({ iv, content }, orgKey);
            encryptedFileKeyStr = existingPatient.encrypted_file_key;
            
            if (!file.patient.organizationId) {
                file.patient.organizationId = existingPatient.organization_id;
            }
        } else {
            // Cas B : Nouveau Dossier
            Logger.info('CRYPTO', "Generating new File Key for patient " + file.id);
            fileKey = await generateSymetricKey();
            const wrapped = await wrapKey(fileKey, orgKey);
            encryptedFileKeyStr = `${wrapped.iv}:${wrapped.content}`;
        }

        if (!file.patient.organizationId) {
             const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).limit(1).single();
             if(member) file.patient.organizationId = member.organization_id;
             else throw new Error("Impossible de lier le patient : L'utilisateur n'appartient à aucune organisation.");
        }

        Logger.info('DB', 'Saving patient file (Encrypted with FileKey)', { id: file.id });

        // 2. Chiffrement de l'identité complète (Pour le détail)
        const patientToSave = { ...file.patient, _archived: file.archived }; 
        const encIdentity = await encryptBlob(patientToSave, fileKey);

        // 3. Chiffrement du PREVIEW (Pour le dashboard rapide)
        // On extrait juste ce qu'il faut pour afficher la carte
        const previewData = {
            id: file.patient.id,
            firstName: file.patient.firstName,
            lastName: file.patient.lastName,
            age: file.patient.age,
            classLevel: file.patient.classLevel,
            gender: file.patient.gender
        };
        const encPreview = await encryptBlob(previewData, fileKey);

        // CONSTRUCTION PAYLOAD PATIENT
        const patientPayload = {
            id: file.id,
            organization_id: file.patient.organizationId,
            updated_at: new Date().toISOString(),
            last_interaction: file.lastInteraction,
            
            // Full Identity (Lourd)
            iv: encIdentity.iv,
            encrypted_identity: encIdentity.content,
            
            // Preview (Léger) - NOUVEAU
            preview_iv: encPreview.iv,
            encrypted_preview: encPreview.content,

            encrypted_file_key: encryptedFileKeyStr
        };

        const { error: patError } = await supabase.from('patients').upsert(patientPayload);
        if (patError) {
            Logger.error('DB', "Erreur Save Patient", patError);
            throw patError;
        }

        // 4. Rapports (Chiffrés avec FileKey)
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
            const { error: repError } = await supabase.from('reports').upsert(reportsPayloads);
            if (repError) Logger.error('DB', "Erreur Save Reports", repError);
        }

        // 5. Sessions (Chiffrées avec FileKey)
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
            const { error: sessError } = await supabase.from('sessions').upsert(sessionsPayloads);
            if (sessError) Logger.error('DB', "Erreur Save Sessions", sessError);
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
            
            // Si on a "sauvegardé" Léo en mémoire volatile, on pourrait l'ajouter ici
            // Pour l'instant, le dashboard gère l'ajout manuel dans son state local
            return [sarahFile];
        }

        const { data: { user } } = await supabase.auth.getUser();
        if(!user) return [];

        // PERFORMANCE : Sélection chirurgicale des colonnes et tri Serveur
        // On évite le select('*') qui ramène tout le blob inutilement si on a le preview
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

                // 1. Déchiffrer la FileKey
                const [kIv, kContent] = row.encrypted_file_key.split(':');
                const fileKey = await unwrapKey({ iv: kIv, content: kContent }, orgKey);

                let patientData: Patient;
                let isArchived = false;

                // 2. Stratégie "Preview First" (Optimisation)
                if (row.encrypted_preview && row.preview_iv) {
                    // Fast Path : On ne déchiffre que le preview
                    const preview = await decryptBlob(row.preview_iv, row.encrypted_preview, fileKey);
                    // On merge avec un objet vide pour avoir la structure Patient valide (mais vide ailleurs)
                    patientData = { ...createEmptyPatient(), ...preview };
                } else {
                    // Slow Path (Legacy / Migration) : On déchiffre tout
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
            // CORRECTION CRITIQUE : Vérification exacte de l'ID
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
                    sessions: history, // On injecte l'historique riche
                    patient: DEMO_PATIENTS.SARAH.patient
                };
            }
            // Fallback Sarah par sécurité, mais ne devrait pas arriver si les IDs sont bons
            return {
                reports: [],
                sessions: [],
                patient: DEMO_PATIENTS.SARAH.patient
            };
        }

        const { data: { user } } = await supabase.auth.getUser();
        if(!user) throw new Error("Non connecté");

        // 1. Récupérer le dossier complet (Clés + Identité FULL)
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

        Logger.debug('DB', 'Loading FULL patient identity & details', { patientId });

        // 2. Déchiffrer l'identité COMPLÈTE (Obligatoire pour l'écran de détail)
        const decryptedIdentity = await decryptBlob(patientRow.iv, patientRow.encrypted_identity, fileKey) as any;
        delete decryptedIdentity._archived;
        const patientFull = { ...decryptedIdentity, id: patientId, organizationId: patientRow.organization_id } as Patient;

        // 3. Charger Reports
        const { data: reportsData } = await supabase
            .from('reports')
            .select('*')
            .eq('patient_id', patientId);

        const reports = await Promise.all((reportsData || []).map(async (r: any) => {
            const decrypted = await decryptBlob(r.iv, r.encrypted_content, fileKey);
            return { ...decrypted, id: r.id, date: r.created_at, type: r.type, status: r.status } as ReportMetadata;
        }));

        // 4. Charger Sessions
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
        Logger.warn('DB', 'DELETING PATIENT FILE', { id });
        await supabase.from('reports').delete().eq('patient_id', id);
        await supabase.from('sessions').delete().eq('patient_id', id);
        await supabase.from('drafts').delete().eq('patient_id', id);
        await supabase.from('patients').delete().eq('id', id);
    },

    toggleArchive: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) return;
        const newFile = { ...file, archived: !file.archived };
        await StorageService.saveFile(newFile, orgKey);
    }
};