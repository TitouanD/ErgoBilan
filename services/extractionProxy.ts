import { supabase, ensureFreshSession } from './db';
import { Logger } from '../utils/logger';
import type { ExtractionCallMeta, ExtractionRepairRequest } from '../types';

const FUNCTION_NAME = 'extract-norms';
const CLIENT_MAX_RETRIES = 2;
const CLIENT_RETRY_BASE_MS = 2_000;

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

// ── HELPER: Check if JWT looks valid ──────────────────────────────────────

const isLikelyJwt = (token: string | undefined): token is string => {
  if (!token) return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

// ── HELPER: Sleep utility ─────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── HELPER: Check if error is invalid JWT ─────────────────────────────────

const isInvalidJwtError = (error: any): boolean => {
  const msg = String(error?.message ?? '').toLowerCase();
  return /invalid.*jwt|jwt.*expired|unauthorized/i.test(msg);
};

// ── HELPER: Extract error from edge response ──────────────────────────────

const getEdgeBody = (data: any, error: any): any => {
  if (error) return null;
  if (typeof data === 'object' && data !== null) return data;
  return null;
};

// ── HELPER: Check if error is retryable ───────────────────────────────────

const isRetryable = (edgeBody: any, error: any): boolean => {
  if (edgeBody?.retryable === true) return true;
  return /fetch failed|network|econnreset|socket/i.test(String(error?.message ?? ''));
};

// ── CORE: Invoke extraction task ──────────────────────────────────────────

const invokeTask = async (accessToken: string, params: ExtractionParams) => {
  // Note: AbortController.signal is not supported by supabase.functions.invoke
  // Timeout is handled at the edge function level (30s)
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { payload: params },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return { data, error };
};

// ── PUBLIC: Call extraction task with retry logic ─────────────────────────

export const callExtractionTask = async (params: ExtractionParams): Promise<ExtractionResponse> => {
  const { session, error: sessionErr } = await ensureFreshSession();
  if (!isLikelyJwt(session?.access_token)) {
    Logger.warn('AI', 'No valid session for extraction task', sessionErr);
    throw new Error('SESSION_EXPIRED');
  }

  let accessToken = session.access_token;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= CLIENT_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = CLIENT_RETRY_BASE_MS * Math.pow(2, attempt - 1);
      Logger.info(
        'AI',
        `Retrying extraction for ${params.filename} (${attempt + 1}/${CLIENT_MAX_RETRIES + 1}) after ${delayMs}ms`
      );
      await sleep(delayMs);
      const refreshInBackoff = await ensureFreshSession();
      if (isLikelyJwt(refreshInBackoff.session?.access_token)) {
        accessToken = refreshInBackoff.session.access_token;
      }
    }

    let { data, error } = await invokeTask(accessToken, params);

    // Handle JWT refresh if needed
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

    // Non-retryable errors
    if (edgeError === 'RATE_LIMITED') throw new Error('RATE_LIMITED');
    if (edgeError === 'Missing authorization' || edgeError === 'Unauthorized')
      throw new Error('SESSION_EXPIRED');

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

// ── PUBLIC: Batch extraction with parallelization ─────────────────────────

export const callExtractionBatch = async (
  files: File[],
  knownSubtestNames?: string[]
): Promise<ExtractionBatchResult[]> => {
  const { fileToGenerativePart } = await import('../utils/aiHelpers');

  // Convert all files to image parts first
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

  // Execute all extractions in parallel
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

  // Sort by original index to maintain order
  return results.sort((a, b) => a.index - b.index);
};
