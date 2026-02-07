
import { supabase } from './db';
import { PatientFile } from '../types';
import { encryptData, decryptData } from '../utils/crypto';
import { Logger } from '../utils/logger';

let _isDemoMode = false;

export const StorageService = {
    setDemoMode: (isDemo: boolean) => {
        _isDemoMode = isDemo;
    },

    getDraftsMetadata: async (): Promise<Record<string, string>> => {
        if (_isDemoMode) return {};
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return {};
        const { data } = await supabase.from('drafts').select('patient_id, updated_at').eq('user_id', user.id);
        if (!data) return {};
        return data.reduce((acc: any, curr: any) => {
            if (curr.patient_id) acc[curr.patient_id] = curr.updated_at;
            return acc;
        }, {});
    },

    saveDraft: async (draftData: any, sessionKey: CryptoKey): Promise<void> => {
        if (_isDemoMode) return;
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const encrypted = await encryptData(draftData, sessionKey);
        const patientId = draftData.patient?.id;

        const payload = {
            user_id: user.id,
            patient_id: patientId || null,
            encrypted_content: `${encrypted.iv}:${encrypted.content}`,
            updated_at: new Date().toISOString()
        };

        if (patientId) {
            await supabase.from('drafts').upsert(payload, { onConflict: 'user_id, patient_id' });
        } else {
            // Simplified handling for new drafts without ID
            await supabase.from('drafts').insert(payload);
        }
    },

    getDraft: async (sessionKey: CryptoKey, patientId?: string): Promise<any | null> => {
         if (_isDemoMode) return null;
         const { data: { user } } = await supabase.auth.getUser();
         if (!user) return null;
         
         let query = supabase.from('drafts').select('encrypted_content').eq('user_id', user.id);
         if (patientId) query = query.eq('patient_id', patientId);
         else query = query.is('patient_id', null);
         
         const { data } = await query.maybeSingle();
         if (!data) return null;
         
         const [iv, content] = data.encrypted_content.split(':');
         return await decryptData({ iv, content }, sessionKey);
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
     * SAUVEGARDE PATIENT (Architecture 3-Level Key)
     * Utilise OrgKey pour déverrouiller ou créer la FileKey.
     */
    saveFile: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
         if (_isDemoMode) return;
         
         const { data: { user } } = await supabase.auth.getUser();
         if (!user) return;

         // Get Org ID from session or fetch it (Assumed fetched in AuthContext)
         const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).single();
         if(!member) throw new Error("No organization found");

         const encrypted = await encryptData(file, orgKey);
         
         await supabase.from('patients').upsert({
             id: file.id,
             organization_id: member.organization_id,
             encrypted_data: `${encrypted.iv}:${encrypted.content}`,
             last_interaction: file.lastInteraction,
             archived: file.archived
         });
    },

    loadPatientList: async (orgKey: CryptoKey): Promise<PatientFile[]> => {
        if (_isDemoMode) return [];
        
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return [];

        const { data: member } = await supabase.from('organization_members').select('organization_id').eq('user_id', user.id).maybeSingle();
        if (!member) return [];

        const { data } = await supabase.from('patients').select('*').eq('organization_id', member.organization_id).order('last_interaction', { ascending: false });
        if (!data) return [];

        const decryptedFiles: PatientFile[] = [];
        for (const row of data) {
            try {
                const [iv, content] = row.encrypted_data.split(':');
                const file = await decryptData({ iv, content }, orgKey);
                decryptedFiles.push({ ...file, id: row.id, archived: row.archived });
            } catch (e) {
                Logger.error('CRYPTO', `Failed to decrypt patient ${row.id}`, e);
            }
        }
        return decryptedFiles;
    },

    loadPatientDetails: async (id: string, orgKey: CryptoKey): Promise<PatientFile> => {
         if (_isDemoMode) throw new Error("Demo mode");
         
         const { data } = await supabase.from('patients').select('*').eq('id', id).single();
         if (!data) throw new Error("Patient not found");

         const [iv, content] = data.encrypted_data.split(':');
         return await decryptData({ iv, content }, orgKey);
    },

    toggleArchive: async (file: PatientFile, orgKey: CryptoKey): Promise<void> => {
        const updatedFile = { ...file, archived: !file.archived };
        await StorageService.saveFile(updatedFile, orgKey);
    },

    deleteFile: async (id: string): Promise<void> => {
        if (_isDemoMode) return;
        await supabase.from('patients').delete().eq('id', id);
    }
};
