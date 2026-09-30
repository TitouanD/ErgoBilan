import { getVerifiedAccessToken, SUPABASE_ANON_KEY, SUPABASE_URL } from './db';
import { Logger } from '../utils/logger';
import { setAppContext } from './sentryService';
import type { AIAnswer, AIRequest, AITransport } from '../utils/reportGenerator';

const FUNCTION_NAME = 'generate';
const REQUEST_TIMEOUT_MS = 180_000;
const CLIENT_MAX_RETRIES = 2;
const CLIENT_RETRY_BASE_MS = 3_000;
const MIN_TOKEN_VALIDITY_MS = 120_000;


const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const parseResponseBody = async (res: Response): Promise<any> => {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const invokeTask = async (jwt: string, params: AIRequest) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        task: params.task,
        payload: params.payload,
        ...(params.generationId && { generation_id: params.generationId }),
      }),
      signal: controller.signal,
    });

    const parsedBody = await parseResponseBody(res);

    if (!res.ok) {
      return {
        data: null,
        error: {
          status: res.status,
          message:
            (parsedBody && typeof parsedBody === 'object' && (parsedBody.message || parsedBody.error)) ||
            `HTTP_${res.status}`,
          context: {
            status: res.status,
            body: parsedBody,
          },
        },
      };
    }

    return { data: parsedBody, error: null };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    return {
      data: null,
      error: {
        message: isAbort ? 'TIMEOUT_AI' : String((error as Error)?.message || error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
};

const getEdgeBody = (data: any, error: any): any => {
  if (data && typeof data === 'object') return data;
  const ctx = error?.context;
  if (ctx && typeof ctx === 'object') {
    if (ctx.body && typeof ctx.body === 'object') return ctx.body;
    if (typeof ctx.body === 'string') {
      try {
        return JSON.parse(ctx.body);
      } catch {
        return null;
      }
    }
    return ctx;
  }
  return null;
};

const isInvalidJwtError = (err: any): boolean => {
  const status = typeof err?.status === 'number' ? err.status : typeof err?.context?.status === 'number' ? err.context.status : undefined;
  if (status === 401) return true;
  return /invalid jwt|jwt expired|unauthorized/i.test(String(err?.message ?? ''));
};

const isRetryable = (edgeBody: any, error: any): boolean => {
  if (edgeBody?.retryable === true) return true;
  const status = typeof error?.status === 'number' ? error.status : typeof error?.context?.status === 'number' ? error.context.status : undefined;
  if (status && status >= 500) return true;
  return /fetch failed|network|econnreset|socket|timeout_ai/i.test(String(error?.message ?? ''));
};

/** HTTP transport of the report generator: the edge function `generate` (JWT, retries, error codes). */
export const callAIProxyTask: AITransport = async (params: AIRequest): Promise<AIAnswer> => {
  const initialToken = await getVerifiedAccessToken({
    minValidityMs: MIN_TOKEN_VALIDITY_MS,
    maxAttempts: 2,
  });
  if (!initialToken.token) {
    Logger.warn('AI', 'No verified session for AI task', initialToken.error);
    throw new Error('SESSION_EXPIRED');
  }

  let accessToken = initialToken.token;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = CLIENT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      Logger.info('AI', `Retrying edge task ${params.task} (${attempt + 1}/${CLIENT_MAX_RETRIES + 1}) after ${delayMs}ms`);
      await sleep(delayMs);
      const refreshed = await getVerifiedAccessToken({
        minValidityMs: MIN_TOKEN_VALIDITY_MS,
        maxAttempts: 2,
      });
      if (refreshed.token) {
        accessToken = refreshed.token;
      }
    }

    const startedAt = performance.now();
    let { data, error } = await invokeTask(accessToken, params);

    if (error && isInvalidJwtError(error)) {
      Logger.warn('AI', 'Invalid JWT detected - refreshing session and retrying');
      const refreshResult = await getVerifiedAccessToken({
        minValidityMs: MIN_TOKEN_VALIDITY_MS,
        forceRefresh: true,
        maxAttempts: 3,
      });
      if (!refreshResult.token) {
        throw new Error('SESSION_EXPIRED');
      }
      accessToken = refreshResult.token;
      ({ data, error } = await invokeTask(accessToken, params));
    }

    const edgeBody = getEdgeBody(data, error);
    const edgeError: string | undefined = edgeBody?.error;

    // Diagnostic trail for Sentry: correlate with the edge event through generation_id.
    const callInfo = {
      task: params.task,
      attempt: attempt + 1,
      maxAttempts: CLIENT_MAX_RETRIES + 1,
      httpStatus: (error as { status?: number } | null)?.status ?? 200,
      edgeError: edgeError ?? null,
      edgeCode: typeof edgeBody?.code === 'string' ? edgeBody.code : null,
      retryable: edgeBody?.retryable ?? null,
      transportError: error && !(error as { status?: number }).status ? String(error.message) : null,
      durationMs: Math.round(performance.now() - startedAt),
      generationId: data?.generationId ?? params.generationId ?? null,
      requestBytes: JSON.stringify(params.payload).length,
    };
    setAppContext('ai_last_call', callInfo);
    if (error || edgeError) Logger.warn('AI', `Edge task ${params.task} failed (attempt ${attempt + 1})`, callInfo);
    else Logger.info('AI', `Edge task ${params.task} succeeded`, callInfo);

    if (edgeError === 'CREDIT_INSUFFICIENT') throw new Error('CREDIT_INSUFFICIENT');
    if (edgeError === 'RATE_LIMITED') throw new Error('RATE_LIMITED');
    if (edgeError === 'MISSING_GENERATION_SESSION') throw new Error('MISSING_GENERATION_SESSION');
    if (edgeError === 'INVALID_GENERATION_SESSION') throw new Error('INVALID_GENERATION_SESSION');
    if (edgeError === 'GENERATION_SESSION_BUSY') throw new Error('GENERATION_SESSION_BUSY');
    if (edgeError === 'Missing authorization' || edgeError === 'Unauthorized') throw new Error('SESSION_EXPIRED');

    const retryable = isRetryable(edgeBody, error);
    if ((error || edgeError) && !retryable) {
      throw new Error(`AI proxy error: ${edgeError || error?.message}`);
    }

    if (error || edgeError) {
      lastError = new Error(`AI generation error: ${edgeError || error?.message}`);
      continue;
    }

    return { text: data?.text ?? null, generationId: data?.generationId ?? undefined };
  }

  throw lastError ?? new Error('AI generation failed after retries');
};
