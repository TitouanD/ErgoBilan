/**
 * generate — AI report generation (Gemini) behind JWT auth, rate limit and credits.
 *
 * Tasks (see prompts.ts):
 * - report_bio          : consumes 1 credit, opens a generation session (generation_log
 *                         row 'pending') and returns its id. Failure → session refunded.
 * - report_diagnostic   : must reuse the session id of report_bio (same credit). Success
 *                         finalizes the session; failure only releases its lock so the
 *                         client can retry within GENERATION_REUSE_WINDOW_MINUTES. Sessions
 *                         left pending are refunded by the SQL sweeper (pg_cron).
 * - report_reevaluation : 1 credit, finalized (or refunded) in the same call.
 * - extract_style_feedback : no credit; updates practitioners.ai_style_preferences.
 *
 * `verify_jwt` is disabled at the gateway: the JWT is verified here.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { captureEdgeException } from '../_shared/sentry.ts';
import { AI_TASKS, type AITask, type BuildResult, buildTask } from './prompts.ts';

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = parsePositiveInt(Deno.env.get('GEMINI_TIMEOUT_MS'), 50_000);
const MAX_REQUESTS_PER_HOUR = parsePositiveInt(Deno.env.get('AI_MAX_REQUESTS_PER_HOUR'), 15);
const GEMINI_MAX_RETRIES = parsePositiveInt(Deno.env.get('GEMINI_MAX_RETRIES'), 1);
const GEMINI_RETRY_BASE_MS = parsePositiveInt(Deno.env.get('GEMINI_RETRY_BASE_MS'), 2_000);
const GENERATION_REUSE_WINDOW_MINUTES = parsePositiveInt(Deno.env.get('GENERATION_REUSE_WINDOW_MINUTES'), 20);
const GENERATION_LOCK_TTL_SECONDS = parsePositiveInt(Deno.env.get('GENERATION_LOCK_TTL_SECONDS'), 120);
const MAX_PAYLOAD_BYTES = parsePositiveInt(Deno.env.get('GENERATE_MAX_PAYLOAD_BYTES'), 220_000);

const APP_ENV = (Deno.env.get('APP_ENV') || Deno.env.get('ENV') || '').toLowerCase();
const IS_PRODUCTION = APP_ENV === 'production' || APP_ENV === 'prod' || !!Deno.env.get('DENO_DEPLOYMENT_ID');
// localhost origins are only accepted outside production unless explicitly enabled.
const ALLOW_LOOPBACK_ORIGINS = (Deno.env.get('AI_ALLOW_LOOPBACK_ORIGINS') ?? String(!IS_PRODUCTION)).trim().toLowerCase() === 'true';
const AI_DEV_MODE = (Deno.env.get('AI_DEV_MODE') || 'false').trim().toLowerCase() === 'true';
const ALLOWED_ORIGINS = (Deno.env.get('AI_ALLOWED_ORIGINS') || '')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
};

const isAllowedOrigin = (origin: string): boolean => {
  if (origin && ALLOW_LOOPBACK_ORIGINS && isLoopbackOrigin(origin)) return true;
  if (ALLOWED_ORIGINS.length > 0) return !!origin && ALLOWED_ORIGINS.includes(origin);
  return !IS_PRODUCTION || AI_DEV_MODE;
};

const corsHeaders = (origin: string): Record<string, string> => ({
  ...(origin && isAllowedOrigin(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

const json = (origin: string, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });

const looksLikeUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Credits / generation sessions (service-role RPCs) ───────────────────────

const checkRateLimit = async (admin: SupabaseClient, userId: string): Promise<boolean> => {
  const { data, error } = await admin.rpc('check_rate_limit_for_user', { p_user_id: userId, p_max_per_hour: MAX_REQUESTS_PER_HOUR });
  return !error && data === true;
};

/** Consume a credit and open a generation session; returns its id, or null when not allowed. */
const openGenerationSession = async (admin: SupabaseClient, userId: string): Promise<string | null> => {
  const { data, error } = await admin.rpc('consume_credit_for_user', { p_user_id: userId });
  return !error && data ? String(data) : null;
};

const finalizeSession = async (admin: SupabaseClient, genId: string, userId: string, success: boolean, errorCode: string | null = null) => {
  const { error } = await admin.rpc('finalize_generation_internal', {
    p_generation_id: genId,
    p_user_id: userId,
    p_success: success,
    p_error_code: errorCode,
  });
  if (error) console.error('finalize_generation_internal failed', error.message);
};

/** Lock a pending session for the diagnostic call (prevents concurrent use of one credit). */
const claimSession = async (admin: SupabaseClient, genId: string, userId: string): Promise<boolean> => {
  const { data, error } = await admin.rpc('claim_generation_session', {
    p_generation_id: genId,
    p_user_id: userId,
    p_lock_ttl_seconds: GENERATION_LOCK_TTL_SECONDS,
  });
  return !error && data === true;
};

/** Release the diagnostic lock after a failure so the client can retry with the same session. */
const releaseSession = async (admin: SupabaseClient, genId: string, userId: string) => {
  const { error } = await admin
    .from('generation_log')
    .update({ error_code: null })
    .eq('id', genId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .like('error_code', 'LOCK:%');
  if (error) console.error('Failed to release generation lock', error.message);
};

const isSessionReusable = async (admin: SupabaseClient, genId: string, userId: string): Promise<boolean> => {
  const windowStart = new Date(Date.now() - GENERATION_REUSE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data } = await admin
    .from('generation_log')
    .select('id')
    .eq('id', genId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('created_at', windowStart)
    .maybeSingle();
  return Boolean(data);
};

// ─── Gemini ───────────────────────────────────────────────────────────────────

type GeminiResult = { ok: true; text: string } | { ok: false; errorCode: string; retryable: boolean; status: number };

/** Call Gemini with retries on 429/503. A missing or unparseable JSON answer is a failure. */
const callGemini = async (built: BuildResult): Promise<GeminiResult> => {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: built.contents }] }],
    generationConfig: { responseMimeType: built.responseMimeType, ...(built.responseSchema ? { responseSchema: built.responseSchema } : {}) },
    ...(built.systemInstruction ? { system_instruction: { parts: [{ text: built.systemInstruction }] } } : {}),
  });

  let lastStatus = 0;
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(GEMINI_RETRY_BASE_MS * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
    try {
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY! },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        lastStatus = response.status;
        await response.text();
        if (response.status === 429 || response.status === 503) continue;
        return { ok: false, errorCode: 'GEMINI_ERROR', retryable: false, status: 502 };
      }
      const data = await response.json();
      const text: string | null = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      if (!text?.trim()) return { ok: false, errorCode: 'GEMINI_EMPTY_RESPONSE', retryable: true, status: 502 };
      if (built.responseMimeType === 'application/json') {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) throw new Error('empty');
        } catch {
          return { ok: false, errorCode: 'GEMINI_INVALID_JSON', retryable: true, status: 502 };
        }
      }
      return { ok: true, text };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { ok: false, errorCode: 'GEMINI_TIMEOUT', retryable: true, status: 504 };
      lastStatus = 0;
      if (attempt === GEMINI_MAX_RETRIES) return { ok: false, errorCode: 'GEMINI_EXCEPTION', retryable: true, status: 502 };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, errorCode: 'GEMINI_RETRYABLE_ERROR', retryable: true, status: lastStatus || 502 };
};

// ─── Style feedback ───────────────────────────────────────────────────────────

const MAX_GLOBAL_RULES_CHARS = 400;
const MAX_SECTION_RULES_CHARS = 200;

const storeStylePreferences = async (admin: SupabaseClient, userId: string, text: string) => {
  const parsed = JSON.parse(text);
  const global = String(parsed?.global || '').trim().slice(0, MAX_GLOBAL_RULES_CHARS);
  const sections: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed?.sections && typeof parsed.sections === 'object' ? parsed.sections : {})) {
    const rules = String(value || '').trim().slice(0, MAX_SECTION_RULES_CHARS);
    if (rules) sections[key] = rules;
  }
  if (!global && Object.keys(sections).length === 0) return;
  const { error } = await admin.from('practitioners').update({ ai_style_preferences: JSON.stringify({ global, sections }) }).eq('id', userId);
  if (error) console.error('Style preferences update failed', error.message);
};

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = (req.headers.get('origin') || '').trim();
  if (req.method === 'OPTIONS') {
    return isAllowedOrigin(origin) ? new Response('ok', { headers: corsHeaders(origin) }) : new Response('forbidden', { status: 403 });
  }

  let userId: string | null = null;
  let task: AITask | null = null;
  let generationId: string | null = null;
  let admin: SupabaseClient | null = null;
  let settled = false; // the generation session has been finalized or released

  try {
    if (!isAllowedOrigin(origin)) return json(origin, 403, { error: 'FORBIDDEN_ORIGIN' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(origin, 401, { error: 'Missing authorization' });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json(origin, 401, { error: 'Unauthorized' });
    userId = user.id;

    if (!SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) return json(origin, 500, { error: 'SERVER_MISCONFIGURED' });
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!(await checkRateLimit(admin, userId))) return json(origin, 429, { error: 'RATE_LIMITED', message: 'Trop de requêtes. Réessayez plus tard.' });

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });

    const body = await req.json();
    task = String(body.task || '') as AITask;
    const payload = (body.payload || {}) as Record<string, unknown>;
    const providedGenId = typeof body.generation_id === 'string' ? body.generation_id : null;
    if (new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });
    if (!AI_TASKS.includes(task)) return json(origin, 400, { error: 'INVALID_TASK' });

    // ── Style feedback: no credit, no generation session ──
    if (task === 'extract_style_feedback') {
      const result = await callGemini(buildTask(task, payload));
      if (!result.ok) return json(origin, 502, { error: 'Feedback extraction failed', retryable: false });
      await storeStylePreferences(admin, userId, result.text);
      return json(origin, 200, { text: result.text, generationId: null });
    }

    // ── Generation session ──
    if (providedGenId && !looksLikeUuid(providedGenId)) return json(origin, 400, { error: 'INVALID_GENERATION_SESSION' });
    if (task === 'report_diagnostic') {
      if (!providedGenId) return json(origin, 400, { error: 'MISSING_GENERATION_SESSION' });
      if (!(await isSessionReusable(admin, providedGenId, userId))) return json(origin, 400, { error: 'INVALID_GENERATION_SESSION' });
      if (!(await claimSession(admin, providedGenId, userId))) return json(origin, 409, { error: 'GENERATION_SESSION_BUSY' });
      generationId = providedGenId;
    } else {
      if (providedGenId) return json(origin, 400, { error: 'INVALID_GENERATION_SESSION' });
      generationId = await openGenerationSession(admin, userId);
      if (!generationId) return json(origin, 402, { error: 'CREDIT_INSUFFICIENT', message: 'Crédits insuffisants.' });
    }

    const result = await callGemini(buildTask(task, payload));

    if (!result.ok) {
      if (task === 'report_diagnostic') await releaseSession(admin, generationId, userId);
      else await finalizeSession(admin, generationId, userId, false, result.errorCode);
      settled = true;
      return json(origin, result.status, { error: 'AI generation failed', code: result.errorCode, retryable: result.retryable });
    }

    // report_bio stays pending: the diagnostic call finalizes the shared session.
    if (task !== 'report_bio') {
      await finalizeSession(admin, generationId, userId, true);
      settled = true;
    }
    return json(origin, 200, { text: result.text, generationId });
  } catch (err) {
    await captureEdgeException(err, { functionName: 'generate', tags: { task: task || 'unknown' }, extra: { userId, generationId } });
    if (admin && generationId && userId && !settled) {
      if (task === 'report_diagnostic') await releaseSession(admin, generationId, userId);
      else if (task !== null) await finalizeSession(admin, generationId, userId, false, 'INTERNAL_ERROR');
    }
    return json(origin, 500, { error: 'Internal server error' });
  }
});
