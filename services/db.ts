import { createClient, type Session } from '@supabase/supabase-js';

// --- CONFIGURATION SUPABASE ---
// Prefer env vars so keys can rotate without rebuild.
// Fallbacks are kept for backward compatibility.

const DEFAULT_SUPABASE_URL = 'https://hxlsjpkwrqunuqpaukmg.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_40vGTw4K7qqKFSrSs1OPIQ_yurzA3qm';
const envSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const envSupabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const SUPABASE_URL = envSupabaseUrl || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.DEV
	? DEFAULT_SUPABASE_PUBLISHABLE_KEY
	: (envSupabaseKey || DEFAULT_SUPABASE_PUBLISHABLE_KEY);

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
		storageKey: 'ergobilan.auth',
		storage: safeStorage
	}
});

const DEFAULT_REFRESH_WINDOW_MS = 30_000; // refresh if token expires within 30s
let refreshInFlight: Promise<{ session: Session | null; error?: unknown }> | null = null;

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
	try {
		const payload = token.split('.')[1];
		if (!payload) return null;
		const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		const decoded = atob(padded);
		return JSON.parse(decoded) as Record<string, unknown>;
	} catch {
		return null;
	}
};

const getTokenExpiryMs = (session: Session): number => {
	if (session.expires_at) return session.expires_at * 1000;
	const payload = decodeJwtPayload(session.access_token || '');
	const exp = Number(payload?.exp ?? 0);
	return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
};

const isSessionUsable = (session: Session | null, minValidityMs: number): boolean => {
	if (!session?.access_token) return false;
	const expiresAtMs = getTokenExpiryMs(session);
	if (!expiresAtMs) return false;
	return expiresAtMs - Date.now() >= minValidityMs;
};

const looksLikeJwt = (token: string | null | undefined): token is string => {
	if (!token) return false;
	if (token.startsWith('sb_publishable_') || token.startsWith('sb_secret_')) return false;
	const parts = token.split('.');
	return parts.length === 3 && parts.every((part) => part.length > 0);
};

const refreshSessionLocked = async (): Promise<{ session: Session | null; error?: unknown }> => {
	if (refreshInFlight) return refreshInFlight;

	const currentPromise = (async () => {
		const { data, error } = await supabase.auth.refreshSession();
		return { session: data?.session ?? null, error: error ?? undefined };
	})();

	refreshInFlight = currentPromise;
	try {
		return await currentPromise;
	} finally {
		if (refreshInFlight === currentPromise) refreshInFlight = null;
	}
};

export const ensureFreshSession = async (
	options: { forceRefresh?: boolean; minValidityMs?: number } = {}
): Promise<{ session: Session | null; refreshed: boolean; error?: unknown }> => {
	const minValidityMs = options.minValidityMs ?? DEFAULT_REFRESH_WINDOW_MS;
	const {
		data: { session },
		error,
	} = await supabase.auth.getSession();
	if (!session) return { session: null, refreshed: false, error };

	const needsRefresh = options.forceRefresh || !isSessionUsable(session, minValidityMs);

	if (!needsRefresh) return { session, refreshed: false };

	const refreshResult = await refreshSessionLocked();
	if (isSessionUsable(refreshResult.session, minValidityMs)) {
		return { session: refreshResult.session, refreshed: true, error: refreshResult.error };
	}

	// Cross-tab resilience: if another tab refreshed first, re-read local session cache.
	const {
		data: { session: latestSession },
	} = await supabase.auth.getSession();
	if (isSessionUsable(latestSession, minValidityMs)) {
		return { session: latestSession, refreshed: true, error: refreshResult.error };
	}

	if (refreshResult.error) {
		return { session: null, refreshed: true, error: refreshResult.error };
	}

	if (!latestSession) {
		return { session: null, refreshed: true };
	}

	if (!isSessionUsable(latestSession, 0)) {
		// Expired token must never be reused for protected edge calls.
		return { session: null, refreshed: true, error: new Error('SESSION_EXPIRED') };
	}

	// Best effort fallback for edge cases where expiry metadata is briefly stale.
	if (!refreshResult.session) {
		// Cross-tab resilience: if another tab refreshed first, re-read local session cache.
		return { session: latestSession ?? null, refreshed: true, error: refreshResult.error };
	}

	return { session: null, refreshed: true, error: refreshResult.error };
};

export const getVerifiedAccessToken = async (
	options: { minValidityMs?: number; maxAttempts?: number; forceRefresh?: boolean } = {}
): Promise<{ token: string | null; error?: unknown }> => {
	const minValidityMs = options.minValidityMs ?? DEFAULT_REFRESH_WINDOW_MS;
	const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
	let lastError: unknown = undefined;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const { session, error } = await ensureFreshSession({
			minValidityMs,
			forceRefresh: Boolean(options.forceRefresh) || attempt > 0,
		});
		if (error) lastError = error;

		const token = session?.access_token?.trim();
		if (!looksLikeJwt(token)) continue;

		// Hard validation against Auth API to prevent sending stale/rotated JWTs to edge gateway.
		const { data, error: verifyError } = await supabase.auth.getUser(token);
		if (!verifyError && data?.user?.id) {
			return { token };
		}

		lastError = verifyError ?? lastError;
	}

	return { token: null, error: lastError ?? new Error('SESSION_EXPIRED') };
};
