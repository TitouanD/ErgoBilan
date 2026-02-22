import { getVerifiedAccessToken, SUPABASE_ANON_KEY, SUPABASE_URL } from './db';
import { Logger } from '../utils/logger';
import type { ExtractionCallMeta, ExtractionRepairRequest } from '../types';

const FUNCTION_NAME = 'extract-norms';
const REQUEST_TIMEOUT_MS = 180_000;
const CLIENT_MAX_RETRIES = 2;
const CLIENT_RETRY_BASE_MS = 2_000;
const MIN_TOKEN_VALIDITY_MS = 120_000;

export interface ExtractionParams {
  filename: string;
  imagePart: unknown;
  knownSubtestNames?: string[];
  canonicalSubtestNames?: string[];
  repairRequest?: ExtractionRepairRequest;
}

export interface ExtractionResponse {
  text: string | null;
  meta?: ExtractionCallMeta;
}

export interface ExtractionBatchResult {
  filename: string;
  text: string | null;
  error?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const parseResponseBody = async (res: Response): Promise<any> => {
  const raw = await res.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const invokeTask = async (jwt: string, params: ExtractionParams) => {
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
      body: JSON.stringify({ payload: params }),
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
        message: isAbort ? 'TIMEOUT_EXTRACTION' : String((error as Error)?.message || error),
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

const isInvalidJwtError = (error: any): boolean => {
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.context?.status === 'number'
        ? error.context.status
        : undefined;

  if (status === 401) return true;

  return /invalid jwt|jwt expired|unauthorized/i.test(String(error?.message ?? ''));
};

const isRetryable = (edgeBody: any, error: any): boolean => {
  if (edgeBody?.retryable === true) return true;
  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.context?.status === 'number'
        ? error.context.status
        : undefined;

  if (status && status >= 500) return true;

  return /fetch failed|network|econnreset|socket|timeout_extraction/i.test(String(error?.message ?? ''));
};

export const callExtractionTask = async (params: ExtractionParams): Promise<ExtractionResponse> => {
  const initialToken = await getVerifiedAccessToken({
    minValidityMs: MIN_TOKEN_VALIDITY_MS,
    maxAttempts: 2,
  });
  if (!initialToken.token) {
    Logger.warn('AI', 'No verified session for extraction task', initialToken.error);
    throw new Error('SESSION_EXPIRED');
  }

  let accessToken = initialToken.token;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = CLIENT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      Logger.info(
        'AI',
        `Retrying extraction for ${params.filename} (${attempt + 1}/${CLIENT_MAX_RETRIES + 1}) after ${delayMs}ms`
      );
      await sleep(delayMs);
      const refreshed = await getVerifiedAccessToken({
        minValidityMs: MIN_TOKEN_VALIDITY_MS,
        maxAttempts: 2,
      });
      if (refreshed.token) {
        accessToken = refreshed.token;
      }
    }

    let { data, error } = await invokeTask(accessToken, params);

    if (error && isInvalidJwtError(error)) {
      Logger.warn('AI', 'Invalid JWT detected for extraction - refreshing session and retrying');
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

    if (edgeError === 'RATE_LIMITED') throw new Error('RATE_LIMITED');
    if (edgeError === 'PAID_PLAN_REQUIRED') throw new Error('PAID_PLAN_REQUIRED');
    if (edgeError === 'EXTRACTION_QUOTA_EXCEEDED') throw new Error('EXTRACTION_QUOTA_EXCEEDED');
    if (edgeError === 'Missing authorization' || edgeError === 'Unauthorized') throw new Error('SESSION_EXPIRED');

    const retryable = isRetryable(edgeBody, error);
    if ((error || edgeError) && !retryable) {
      throw new Error(`Extraction error: ${edgeError || error?.message}`);
    }

    if (error || edgeError) {
      lastError = new Error(`Extraction error: ${edgeError || error?.message}`);
      continue;
    }

    return {
      text: data?.text ?? null,
      meta: data?.meta ?? undefined,
    };
  }

  throw lastError ?? new Error('Extraction failed after retries');
};

export const callExtractionBatch = async (
  files: File[],
  knownSubtestNames?: string[]
): Promise<ExtractionBatchResult[]> => {
  const { fileToGenerativePart } = await import('../utils/aiHelpers');

  const filePromises = files.map(async (file, index) => {
    const imagePart = await fileToGenerativePart(file);
    return {
      filename: file.name,
      imagePart,
      index,
      knownSubtestNames: knownSubtestNames || [],
    };
  });

  const fileData = await Promise.all(filePromises);

  Logger.info('AI', `Starting batch extraction of ${files.length} files`);

  const extractionPromises = fileData.map(async (data) => {
    try {
      const result = await callExtractionTask({
        filename: data.filename,
        imagePart: data.imagePart,
        knownSubtestNames: data.knownSubtestNames,
      });
      return {
        filename: data.filename,
        text: result.text,
        index: data.index,
      };
    } catch (error) {
      Logger.error('AI', `Failed to extract ${data.filename}`, error);
      return {
        filename: data.filename,
        text: null,
        error: error instanceof Error ? error.message : String(error),
        index: data.index,
      };
    }
  });

  const results = await Promise.all(extractionPromises);

  return results.sort((a, b) => a.index - b.index);
};
