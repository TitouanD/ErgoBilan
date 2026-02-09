import { createClient } from '@supabase/supabase-js';

// --- CONFIGURATION SUPABASE ---
// Préférer les variables d'environnement pour permettre la rotation des clés sans redéploiement.
// Fallback hardcodé pour la rétro-compatibilité (clé anon = publique par design Supabase, RLS = frontière).

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hxlsjpkwrqunuqpaukmg.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_40vGTw4K7qqKFSrSs1OPIQ_yurzA3qm';

// Safe storage wrapper to prevent corrupt cache from breaking auth.
// Falls back to in-memory storage if localStorage is unavailable.
const memoryStorage = new Map<string, string>();

const safeStorage = {
	getItem: (key: string) => {
		try {
			const value = localStorage.getItem(key);
			if (value === null) return null;
			try {
				JSON.parse(value);
			} catch {
				localStorage.removeItem(key);
				return null;
			}
			return value;
		} catch {
			return memoryStorage.get(key) ?? null;
		}
	},
	setItem: (key: string, value: string) => {
		try {
			localStorage.setItem(key, value);
		} catch {
			memoryStorage.set(key, value);
		}
	},
	removeItem: (key: string) => {
		try {
			localStorage.removeItem(key);
		} catch {
			memoryStorage.delete(key);
		}
	}
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
	auth: {
		persistSession: true,
		autoRefreshToken: true,
		detectSessionInUrl: true,
		storageKey: 'autobilan.auth',
		storage: safeStorage
	}
});
