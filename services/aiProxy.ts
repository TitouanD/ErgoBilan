/**
 * AI Proxy — Hybrid Gemini access layer.
 *
 * Mode selection (automatic, overridable):
 *   1. VITE_AI_MODE=direct  → always call Gemini REST directly (needs VITE_GEMINI_API_KEY)
 *   2. VITE_AI_MODE=edge    → always call Supabase Edge Function proxy
 *   3. (unset)              → DEV=direct, PROD=edge
 *
 * Both paths enforce a per-request timeout (AbortController).
 */

import { supabase, ensureFreshSession } from './db';
import { Logger } from '../utils/logger';

const FUNCTION_NAME = 'generate';
const GEMINI_MODEL = 'gemini-3-flash-preview';

/** Per-request timeout (ms). Clinical prompts can be large → generous limit. */
const REQUEST_TIMEOUT_MS = 180_000; // 3 min per call

/** Client-side retry configuration for transient Edge Function failures. */
const CLIENT_MAX_RETRIES = 2;       // Up to 3 total attempts
const CLIENT_RETRY_BASE_MS = 3_000; // 3s, 6s exponential backoff

export interface GenerateContentParams {
  contents: string | Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  systemInstruction?: string;
  responseMimeType?: string;
  /** Pass an existing generationId to reuse a credit session (no new credit consumed). */
  generationId?: string;
}

export interface ProxyResponse {
  text: string | null;
  /** Generation session ID returned by the Edge Function (first call only). */
  generationId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Creates an AbortSignal that fires after `ms` milliseconds. */
const timeoutSignal = (ms: number): AbortSignal => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  // Clean up timer if the signal is already aborted externally
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  return ctrl.signal;
};

/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// DEV path — direct REST call to Gemini (no Edge Function round-trip)
// ---------------------------------------------------------------------------
const callGeminiDirect = async (params: GenerateContentParams): Promise<ProxyResponse> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY is not set in .env.local — cannot call Gemini directly');
  }

  Logger.debug('AI', 'DIRECT mode — calling Gemini REST API');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: Array.isArray(params.contents)
      ? params.contents
      : [{ role: 'user', parts: [{ text: params.contents }] }],
  };

  if (params.systemInstruction) {
    body.system_instruction = { parts: [{ text: params.systemInstruction }] };
  }

  if (params.responseMimeType) {
    body.generationConfig = { responseMimeType: params.responseMimeType };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('TIMEOUT_AI');
    }
    throw err;
  }

  if (!res.ok) {
    const errText = await res.text();
    Logger.error('AI', 'Gemini direct call failed', { status: res.status, errText });
    throw new Error(`Gemini API error (${res.status})`);
  }

  const data = await res.json();
  const text: string | null = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  return { text };
};

// ---------------------------------------------------------------------------
// PROD path — Supabase Edge Function proxy (key stays server-side)
// ---------------------------------------------------------------------------
const callEdgeFunctionProxy = async (params: GenerateContentParams): Promise<ProxyResponse> => {
  // Ensure fresh JWT before calling the edge function (5-min window)
  const { session, error: sessionErr } = await ensureFreshSession();
  if (!session?.access_token) {
    Logger.warn('AI', 'No valid session for AI proxy', sessionErr);
    throw new Error('SESSION_EXPIRED');
  }

  Logger.debug('AI', 'EDGE mode — calling AI proxy edge function');

  const isInvalidJwtError = (err: any): boolean => {
    const status = typeof err?.status === 'number'
      ? err.status
      : (typeof err?.context?.status === 'number' ? err.context.status : undefined);
    if (status === 401) return true;
    const msg = String(err?.message ?? '');
    return /invalid jwt/i.test(msg);
  };

  /**
   * Extract the edge function response body.
   * Supabase functions.invoke() returns:
   *   - 2xx  → { data: parsedBody, error: null }
   *   - non-2xx → { data: null, error: FunctionsHttpError { context: parsedBody } }
   * We unify both into a single body object for consistent field access.
   */
  const getEdgeBody = (data: any, error: any): any => {
    if (data) return data;
    const ctx = error?.context;
    if (ctx && typeof ctx === 'object') return ctx;
    return null;
  };

  /** Whether an error is transient and worth retrying. */
  const shouldRetry = (edgeBody: any, error: any): boolean => {
    // Edge function explicitly marked this as retryable (Gemini 503/429 after server retries)
    if (edgeBody?.retryable === true) return true;
    // Network-level errors (fetch failed, connection reset)
    const msg = String(error?.message ?? '');
    if (/fetch failed|network|econnreset|socket/i.test(msg)) return true;
    return false;
  };

  const invokeWithTimeout = async () => {
    const invokePromise = supabase.functions.invoke(FUNCTION_NAME, {
      body: {
        contents: params.contents,
        systemInstruction: params.systemInstruction,
        responseMimeType: params.responseMimeType,
        ...(params.generationId && { generation_id: params.generationId }),
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('TIMEOUT_AI')), REQUEST_TIMEOUT_MS);
    });

    return Promise.race([invokePromise, timeoutPromise]) as Promise<{ data: any; error: any }>;
  };

  // --- Attempt with JWT retry + transient-error retry ---
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = CLIENT_RETRY_BASE_MS * Math.pow(2, attempt - 1); // 3s, 6s
      Logger.info('AI', `Retrying edge function (attempt ${attempt + 1}/${CLIENT_MAX_RETRIES + 1}) after ${delayMs}ms`);
      await sleep(delayMs);
      // Refresh session before retry in case JWT expired during backoff
      await ensureFreshSession();
    }

    let { data, error } = await invokeWithTimeout();

    // JWT retry (single attempt per main iteration)
    if (error && isInvalidJwtError(error)) {
      Logger.warn('AI', 'Invalid JWT detected — refreshing session and retrying');
      const refreshResult = await ensureFreshSession({ forceRefresh: true });
      if (!refreshResult.session?.access_token) {
        throw new Error('SESSION_EXPIRED');
      }
      ({ data, error } = await invokeWithTimeout());
    }

    // Extract the edge function response body (from `data` on 2xx, from `error.context` on non-2xx)
    const edgeBody = getEdgeBody(data, error);
    const edgeError: string | undefined = edgeBody?.error;

    // Non-retryable application errors — propagate immediately with specific codes
    if (edgeError === 'CREDIT_INSUFFICIENT') throw new Error('CREDIT_INSUFFICIENT');
    if (edgeError === 'RATE_LIMITED') throw new Error('RATE_LIMITED');
    if (edgeError === 'Missing authorization' || edgeError === 'Unauthorized') throw new Error('SESSION_EXPIRED');

    // Determine retryability
    const retryable = shouldRetry(edgeBody, error);

    // Non-retryable hard errors — propagate immediately
    if ((error || edgeError) && !retryable) {
      Logger.error('AI', 'AI proxy call failed (non-retryable)', { edgeError, errorMsg: error?.message });
      throw new Error(`AI proxy error: ${edgeError || error?.message}`);
    }

    // Retryable errors — continue retry loop
    if (error || edgeError) {
      lastError = new Error(`AI generation error: ${edgeError || error?.message}`);
      Logger.warn('AI', `Transient AI error (attempt ${attempt + 1})`, edgeError || error?.message);
      continue;
    }

    // Success!
    return { text: data?.text ?? null, generationId: data?.generationId ?? undefined };
  }

  // All retries exhausted
  Logger.error('AI', 'All AI proxy retries exhausted');
  throw lastError ?? new Error('AI generation failed after retries');
};

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------
type AIMode = 'direct' | 'edge';

const resolveMode = (): AIMode => {
  const override = (import.meta.env.VITE_AI_MODE as string | undefined)?.toLowerCase();
  if (override === 'direct') return 'direct';
  if (override === 'edge') return 'edge';
  // Default: dev → direct, prod → edge
  return import.meta.env.DEV ? 'direct' : 'edge';
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
export const callAIProxy = async (params: GenerateContentParams): Promise<ProxyResponse> => {
  const mode = resolveMode();
  Logger.debug('AI', `AI mode resolved: ${mode}`);
  return mode === 'direct' ? callGeminiDirect(params) : callEdgeFunctionProxy(params);
};
