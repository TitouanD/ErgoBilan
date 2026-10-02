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
import { captureEdgeException, captureEdgeMessage, createTrail } from '../_shared/sentry.ts';
import { AI_TASKS, type AITask, type BuildResult, buildTask, sessionKind } from './prompts.ts';

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

/** A database call that failed: reported to Sentry (it would otherwise look like a business refusal). */
const reportDbError = (
  operation: string,
  error: { message?: string; code?: string; details?: string; hint?: string },
  userId: string,
  genId: string | null = null,
) => {
  console.error(`${operation} failed`, error.message);
  return captureEdgeMessage(`DB ${operation} failed: ${error.code ?? ''} ${error.message ?? ''}`.trim(), {
    functionName: 'generate',
    level: 'error',
    userId,
    tags: { db_operation: operation, generation_id: genId },
    extra: { code: error.code, message: error.message, details: error.details, hint: error.hint, generationId: genId },
    fingerprint: ['db', operation, String(error.code ?? '')],
  });
};

const checkRateLimit = async (admin: SupabaseClient, userId: string): Promise<boolean> => {
  const { data, error } = await admin.rpc('check_rate_limit_for_user', { p_user_id: userId, p_max_per_hour: MAX_REQUESTS_PER_HOUR });
  if (error) await reportDbError('check_rate_limit_for_user', error, userId);
  return !error && data === true;
};

/**
 * Consume a credit and open a generation session tagged with its kind (generation_log.kind);
 * returns its id, or null when not allowed. p_kind needs migration 20261001100000.
 */
const openGenerationSession = async (admin: SupabaseClient, userId: string, kind: string | null): Promise<string | null> => {
  const { data, error } = await admin.rpc('consume_credit_for_user', { p_user_id: userId, p_kind: kind });
  if (error) await reportDbError('consume_credit_for_user', error, userId);
  return !error && data ? String(data) : null;
};

const finalizeSession = async (admin: SupabaseClient, genId: string, userId: string, success: boolean, errorCode: string | null = null) => {
  const { error } = await admin.rpc('finalize_generation_internal', {
    p_generation_id: genId,
    p_user_id: userId,
    p_success: success,
    p_error_code: errorCode,
  });
  if (error) await reportDbError('finalize_generation_internal', error, userId, genId);
};

/** Lock a pending session for the diagnostic call (prevents concurrent use of one credit). */
const claimSession = async (admin: SupabaseClient, genId: string, userId: string): Promise<boolean> => {
  const { data, error } = await admin.rpc('claim_generation_session', {
    p_generation_id: genId,
    p_user_id: userId,
    p_lock_ttl_seconds: GENERATION_LOCK_TTL_SECONDS,
  });
  if (error) await reportDbError('claim_generation_session', error, userId, genId);
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
  if (error) await reportDbError('release_generation_lock', error, userId, genId);
};

const isSessionReusable = async (admin: SupabaseClient, genId: string, userId: string): Promise<boolean> => {
  const windowStart = new Date(Date.now() - GENERATION_REUSE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('generation_log')
    .select('id')
    .eq('id', genId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('created_at', windowStart)
    .maybeSingle();
  if (error) await reportDbError('read_generation_session', error, userId, genId);
  return Boolean(data);
};

// ─── Gemini ───────────────────────────────────────────────────────────────────

/** Diagnostic data of a Gemini call (never the prompt nor the answer), sent to Sentry on failure. */
type GeminiDetail = Record<string, unknown>;
type GeminiResult =
  | { ok: true; text: string; detail: GeminiDetail }
  | { ok: false; errorCode: string; retryable: boolean; status: number; detail: GeminiDetail };

/** Gemini error body: { error: { code, status, message } }. */
const describeGeminiError = (raw: string) => {
  try {
    const err = JSON.parse(raw)?.error;
    return { geminiStatus: err?.status ?? null, geminiMessage: String(err?.message ?? '').slice(0, 300) };
  } catch {
    return { geminiStatus: null, geminiMessage: raw.slice(0, 300) };
  }
};

type GeminiResponse = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

const describeUsage = (data: GeminiResponse | null) => ({
  finishReason: data?.candidates?.[0]?.finishReason ?? null,
  blockReason: data?.promptFeedback?.blockReason ?? null,
  promptTokens: data?.usageMetadata?.promptTokenCount ?? null,
  outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
  thoughtsTokens: data?.usageMetadata?.thoughtsTokenCount ?? null,
});

/** Call Gemini with retries on 429/503. A missing or unparseable JSON answer is a failure. */
const callGemini = async (built: BuildResult): Promise<GeminiResult> => {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: built.contents }] }],
    generationConfig: {
      responseMimeType: built.responseMimeType,
      ...(built.responseSchema ? { responseSchema: built.responseSchema } : {}),
    },
    ...(built.systemInstruction ? { system_instruction: { parts: [{ text: built.systemInstruction }] } } : {}),
  });

  const startedAt = Date.now();
  const httpStatuses: number[] = [];
  let lastError: GeminiDetail = {};
  const detail = (attempt: number, extra: GeminiDetail = {}): GeminiDetail => ({
    model: GEMINI_MODEL,
    attempts: attempt + 1,
    durationMs: Date.now() - startedAt,
    httpStatuses,
    requestBytes: body.length,
    ...lastError,
    ...extra,
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
      httpStatuses.push(response.status);
      if (!response.ok) {
        lastStatus = response.status;
        lastError = describeGeminiError(await response.text());
        if (response.status === 429 || response.status === 503) continue;
        return { ok: false, errorCode: 'GEMINI_ERROR', retryable: false, status: 502, detail: detail(attempt) };
      }
      const data = (await response.json()) as GeminiResponse | null;
      const usage = describeUsage(data);
      const text: string | null = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      if (!text?.trim())
        return { ok: false, errorCode: 'GEMINI_EMPTY_RESPONSE', retryable: true, status: 502, detail: detail(attempt, usage) };
      if (built.responseMimeType === 'application/json') {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) throw new Error('empty');
        } catch (parseErr) {
          return {
            ok: false,
            errorCode: 'GEMINI_INVALID_JSON',
            retryable: true,
            status: 502,
            detail: detail(attempt, {
              ...usage,
              textLength: text.length,
              parseError: parseErr instanceof Error ? parseErr.message.slice(0, 200) : null,
            }),
          };
        }
      }
      return { ok: true, text, detail: detail(attempt, { ...usage, textLength: text.length }) };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return {
          ok: false,
          errorCode: 'GEMINI_TIMEOUT',
          retryable: true,
          status: 504,
          detail: detail(attempt, { timeoutMs: GEMINI_TIMEOUT_MS }),
        };
      }
      lastStatus = 0;
      lastError = { exception: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 300) : String(err) };
      if (attempt === GEMINI_MAX_RETRIES)
        return { ok: false, errorCode: 'GEMINI_EXCEPTION', retryable: true, status: 502, detail: detail(attempt) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, errorCode: 'GEMINI_RETRYABLE_ERROR', retryable: true, status: lastStatus || 502, detail: detail(GEMINI_MAX_RETRIES) };
};

// ─── Style feedback ───────────────────────────────────────────────────────────

const MAX_GLOBAL_RULES_CHARS = 400;
const MAX_SECTION_RULES_CHARS = 200;

const storeStylePreferences = async (admin: SupabaseClient, userId: string, text: string) => {
  const parsed = JSON.parse(text);
  const global = String(parsed?.global || '')
    .trim()
    .slice(0, MAX_GLOBAL_RULES_CHARS);
  const sections: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed?.sections && typeof parsed.sections === 'object' ? parsed.sections : {})) {
    const rules = String(value || '')
      .trim()
      .slice(0, MAX_SECTION_RULES_CHARS);
    if (rules) sections[key] = rules;
  }
  if (!global && Object.keys(sections).length === 0) return;
  const { error } = await admin
    .from('practitioners')
    .update({ ai_style_preferences: JSON.stringify({ global, sections }) })
    .eq('id', userId);
  if (error) await reportDbError('update_style_preferences', error, userId);
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

  // Steps of this request, sent as breadcrumbs with any Sentry event of the request.
  const trail = createTrail();
  const sentry = (tags: Record<string, string | null> = {}) => ({
    functionName: 'generate',
    userId,
    request: req,
    breadcrumbs: trail.items,
    tags: { task: task || 'unknown', generation_id: generationId, ...tags },
  });

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
    trail.add('auth', 'User authenticated');

    if (!SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
      await captureEdgeMessage('SERVER_MISCONFIGURED: missing SUPABASE_SERVICE_ROLE_KEY or GEMINI_API_KEY', {
        ...sentry(),
        level: 'fatal',
      });
      return json(origin, 500, { error: 'SERVER_MISCONFIGURED' });
    }
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!(await checkRateLimit(admin, userId)))
      return json(origin, 429, { error: 'RATE_LIMITED', message: 'Trop de requêtes. Réessayez plus tard.' });

    const contentLength = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });

    const body = await req.json();
    task = String(body.task || '') as AITask;
    const payload = (body.payload || {}) as Record<string, unknown>;
    const providedGenId = typeof body.generation_id === 'string' ? body.generation_id : null;
    const requestBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    trail.add('request', `Task ${task}`, { requestBytes, providedGenerationId: providedGenId });
    if (requestBytes > MAX_PAYLOAD_BYTES) {
      await captureEdgeMessage(`PAYLOAD_TOO_LARGE (${requestBytes} bytes)`, {
        ...sentry(),
        extra: { requestBytes, max: MAX_PAYLOAD_BYTES },
      });
      return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });
    }
    if (!AI_TASKS.includes(task)) return json(origin, 400, { error: 'INVALID_TASK' });

    // ── Style feedback: no credit, no generation session ──
    if (task === 'extract_style_feedback') {
      const result = await callGemini(buildTask(task, payload));
      trail.add('gemini', result.ok ? 'Gemini answered' : `Gemini failed: ${result.errorCode}`, result.detail);
      if (!result.ok) {
        await captureEdgeMessage(`Gemini ${result.errorCode} (${task})`, {
          ...sentry({ error_code: result.errorCode }),
          extra: result.detail,
          fingerprint: ['gemini', result.errorCode, task],
        });
        return json(origin, 502, { error: 'Feedback extraction failed', retryable: false });
      }
      await storeStylePreferences(admin, userId, result.text);
      return json(origin, 200, { text: result.text, generationId: null });
    }

    // ── Generation session ──
    if (providedGenId && !looksLikeUuid(providedGenId)) return json(origin, 400, { error: 'INVALID_GENERATION_SESSION' });
    let sessionId: string;
    if (task === 'report_diagnostic') {
      if (!providedGenId) return json(origin, 400, { error: 'MISSING_GENERATION_SESSION' });
      generationId = providedGenId;
      if (!(await isSessionReusable(admin, providedGenId, userId))) {
        await captureEdgeMessage('INVALID_GENERATION_SESSION: diagnostic on a session that is not pending or expired', {
          ...sentry(),
          extra: { reuseWindowMinutes: GENERATION_REUSE_WINDOW_MINUTES },
        });
        return json(origin, 400, { error: 'INVALID_GENERATION_SESSION' });
      }
      if (!(await claimSession(admin, providedGenId, userId))) {
        await captureEdgeMessage('GENERATION_SESSION_BUSY: diagnostic session already locked', {
          ...sentry(),
          extra: { lockTtlSeconds: GENERATION_LOCK_TTL_SECONDS },
        });
        return json(origin, 409, { error: 'GENERATION_SESSION_BUSY' });
      }
      sessionId = providedGenId;
      trail.add('session', 'Generation session claimed');
    } else {
      if (providedGenId) return json(origin, 400, { error: 'INVALID_GENERATION_SESSION' });
      const opened = await openGenerationSession(admin, userId, sessionKind(task));
      if (!opened) return json(origin, 402, { error: 'CREDIT_INSUFFICIENT', message: 'Crédits insuffisants.' });
      sessionId = opened;
      trail.add('session', 'Credit consumed, generation session opened', { generationId: opened });
    }
    generationId = sessionId; // for the catch block

    const result = await callGemini(buildTask(task, payload));
    trail.add('gemini', result.ok ? 'Gemini answered' : `Gemini failed: ${result.errorCode}`, result.detail);

    if (!result.ok) {
      await captureEdgeMessage(`Gemini ${result.errorCode} (${task})`, {
        ...sentry({ error_code: result.errorCode }),
        extra: { ...result.detail, generationId: sessionId, clientStatus: result.status, retryable: result.retryable },
        fingerprint: ['gemini', result.errorCode, task],
      });
      if (task === 'report_diagnostic') await releaseSession(admin, sessionId, userId);
      else await finalizeSession(admin, sessionId, userId, false, result.errorCode);
      settled = true;
      return json(origin, result.status, { error: 'AI generation failed', code: result.errorCode, retryable: result.retryable });
    }

    // report_bio stays pending: the diagnostic call finalizes the shared session.
    if (task !== 'report_bio') {
      await finalizeSession(admin, sessionId, userId, true);
      settled = true;
    }
    return json(origin, 200, { text: result.text, generationId: sessionId });
  } catch (err) {
    trail.add('error', 'Unhandled exception', { settled }, 'error');
    await captureEdgeException(err, { ...sentry(), extra: { generationId, settled } });
    if (admin && generationId && userId && !settled) {
      if (task === 'report_diagnostic') await releaseSession(admin, generationId, userId);
      else if (task !== null) await finalizeSession(admin, generationId, userId, false, 'INTERNAL_ERROR');
    }
    return json(origin, 500, { error: 'Internal server error' });
  }
});
