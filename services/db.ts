import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION SUPABASE ---
// Préférer les variables d'environnement pour permettre la rotation des clés sans redéploiement.
// Fallback hardcodé pour la rétro-compatibilité (clé anon = publique par design Supabase, RLS = frontière).

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hxlsjpkwrqunuqpaukmg.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_40vGTw4K7qqKFSrSs1OPIQ_yurzA3qm';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
