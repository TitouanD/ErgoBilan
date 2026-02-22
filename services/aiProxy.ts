import { supabase, ensureFreshSession } from './db';
import { Logger } from '../utils/logger';

const FUNCTION_NAME = 'generate';
const REQUEST_TIMEOUT_MS = 180_000;
const CLIENT_MAX_RETRIES = 2;
const CLIENT_RETRY_BASE_MS = 3_000;

export type AITask = 'report_bio' | 'report_diagnostic' | 'extract_norms';

export interface TaskParams {
  task: AITask;
  payload: Record<string, unknown>;
  generationId?: string;
}

export interface ProxyResponse {
  text: string | null;
  generationId?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const isLikelyJwt = (token: string | null | undefined): token is string => {
  if (!token) return false;
  if (token.startsWith('sb_publishable_') || token.startsWith('sb_secret_')) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
};

const invokeTask = async (jwt: string, params: TaskParams) => {
  const invokePromise = supabase.functions.invoke(FUNCTION_NAME, {
    headers: { Authorization: `Bearer ${jwt}` },
    body: {
      task: params.task,
      payload: params.payload,
      ...(params.generationId && { generation_id: params.generationId }),
    },
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('TIMEOUT_AI')), REQUEST_TIMEOUT_MS);
  });

  return Promise.race([invokePromise, timeoutPromise]) as Promise<{ data: any; error: any }>;
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
  return /invalid jwt/i.test(String(err?.message ?? ''));
};

const isRetryable = (edgeBody: any, error: any): boolean => {
  if (edgeBody?.retryable === true) return true;
  return /fetch failed|network|econnreset|socket/i.test(String(error?.message ?? ''));
};

export const callAIProxyTask = async (params: TaskParams): Promise<ProxyResponse> => {
  const { session, error: sessionErr } = await ensureFreshSession();
  if (!isLikelyJwt(session?.access_token)) {
    Logger.warn('AI', 'No valid session for AI task', sessionErr);
    throw new Error('SESSION_EXPIRED');
  }

  let accessToken = session.access_token;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = CLIENT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      Logger.info('AI', `Retrying edge task ${params.task} (${attempt + 1}/${CLIENT_MAX_RETRIES + 1}) after ${delayMs}ms`);
      await sleep(delayMs);
      const refreshInBackoff = await ensureFreshSession();
      if (isLikelyJwt(refreshInBackoff.session?.access_token)) {
        accessToken = refreshInBackoff.session.access_token;
      }
    }

    let { data, error } = await invokeTask(accessToken, params);

    if (error && isInvalidJwtError(error)) {
      Logger.warn('AI', 'Invalid JWT detected - refreshing session and retrying');
      const refreshResult = await ensureFreshSession({ forceRefresh: true });
      if (!isLikelyJwt(refreshResult.session?.access_token)) {
        throw new Error('SESSION_EXPIRED');
      }
      accessToken = refreshResult.session.access_token;
      ({ data, error } = await invokeTask(accessToken, params));
    }

    const edgeBody = getEdgeBody(data, error);
    const edgeError: string | undefined = edgeBody?.error;

    if (edgeError === 'CREDIT_INSUFFICIENT') throw new Error('CREDIT_INSUFFICIENT');
    if (edgeError === 'RATE_LIMITED') throw new Error('RATE_LIMITED');
    if (edgeError === 'MISSING_GENERATION_SESSION') throw new Error('MISSING_GENERATION_SESSION');
    if (edgeError === 'INVALID_GENERATION_SESSION') throw new Error('INVALID_GENERATION_SESSION');
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
