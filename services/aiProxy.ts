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

import { supabase } from './db';
import { Logger } from '../utils/logger';

const FUNCTION_NAME = 'generate';
const GEMINI_MODEL = 'gemini-3-flash-preview';

/** Per-request timeout (ms). Clinical prompts can be large → generous limit. */
const REQUEST_TIMEOUT_MS = 180_000; // 3 min per call

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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error('Not authenticated — cannot call AI proxy');
  }

  Logger.debug('AI', 'EDGE mode — calling AI proxy edge function');

  // supabase.functions.invoke doesn't support AbortSignal natively,
  // so we race it against a timeout promise.
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

  const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

  if (error) {
    Logger.error('AI', 'AI proxy call failed', error);
    throw new Error(`AI proxy error: ${error.message}`);
  }

  if (data?.error) {
    Logger.error('AI', 'AI proxy returned error', data.error);
    throw new Error(`AI generation error: ${data.error}`);
  }

  return { text: data?.text ?? null, generationId: data?.generationId ?? undefined };
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
