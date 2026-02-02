
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION SUPABASE ---

const SUPABASE_URL = 'https://hxlsjpkwrqunuqpaukmg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_40vGTw4K7qqKFSrSs1OPIQ_yurzA3qm'; // Clé fournie

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Fonction helper pour garder une compatibilité partielle ou pour des usages futurs.
 * Dans cette version, on exporte directement le client 'supabase' pour une utilisation dans toute l'app.
 */
export const getDb = async () => {
    return supabase;
};
