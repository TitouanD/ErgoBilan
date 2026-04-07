import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  chunkInventoryColumns,
  computeAdaptiveChunkSize,
  decideExtractionRouting,
  deduplicateInventoryColumnsForParametric,
  detectDuplicateColumns,
  detectOverlappingRanges,
  matchRepairColumns,
  sortTablesByInventoryOrder,
  summarizeInventoryCompleteness,
  normalizeKeyTolerant,
  isCombinedScoreColumn,
  type InventoryColumnDescriptor,
} from "./extractionUtils.ts";
import {
  buildFullExtractionTask,
  buildInventoryScanTaskV2,
  buildFocusedExtractionTaskV2,
  buildRepairExtractionTaskV2,
  parseInventoryResult,
  parseRepairRequest,
  EXTRACTION_RESPONSE_SCHEMA,
  LOOKUP_EXTRACTION_RESPONSE_SCHEMA,
  INVENTORY_RESPONSE_SCHEMA,
  type RepairRequestPayload,
  type InventoryResult,
} from "./prompts.ts";

// â”€â”€ SECRETS & DEPLOYMENT (env vars) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MAX_EXTRACTIONS_PER_HOUR = Number(Deno.env.get("EXTRACTION_MAX_PER_HOUR")) || 20;
const MAX_EXTRACTIONS_PER_DAY = Number(Deno.env.get("EXTRACTION_MAX_PER_DAY")) || 60;

// â”€â”€ HARDCODED CONSTANTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 45_000;
const GEMINI_MAX_RETRIES = 1;
const GEMINI_RETRY_BASE_MS = 2_000;
const MAX_OUTPUT_TOKENS = 65_536;
const CHUNK_OUTPUT_TOKENS = 16_384;
const INVENTORY_OUTPUT_TOKENS = 8_192;
const PRECHECK_COLUMN_THRESHOLD = 8;
const MAX_SUBTESTS_PER_CHUNK = 12;
const CHUNK_MIN_COLUMN_COVERAGE_RATIO = 0.4;
const MAX_REPAIR_TARGETS = 20;
// Extraction is mechanical table-reading — thinking tokens add latency with no benefit.
// Keep thinking only for inventory (structure analysis) and set to 0 for all other calls.
const THINKING_BUDGET = 0;
const INVENTORY_THINKING_BUDGET = 1024;
const MAX_PAYLOAD_BYTES = 10_000_000;
const MAX_IMAGE_PART_BYTES = 8_000_000;

const allowedMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

const APP_ENV = (Deno.env.get("APP_ENV") || Deno.env.get("ENV") || "").toLowerCase();
const IS_PRODUCTION = APP_ENV === "production" || APP_ENV === "prod" || !!Deno.env.get("DENO_DEPLOYMENT_ID");
const ALLOW_LOOPBACK_ORIGINS =
  (Deno.env.get("AI_ALLOW_LOOPBACK_ORIGINS") || "true").trim().toLowerCase() !== "false";
const AI_DEV_MODE =
  (Deno.env.get("AI_DEV_MODE") || "false").trim().toLowerCase() === "true";
const ALLOWED_ORIGINS = (Deno.env.get("AI_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((value: string) => value.trim())
  .filter((value: string) => value.length > 0);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryableStatus = (status: number) => status === 503 || status === 429;

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
};

const isAllowedOrigin = (req: Request): boolean => {
  const origin = (req.headers.get('origin') || '').trim();
  const loopbackOrigin = ALLOW_LOOPBACK_ORIGINS && !!origin && isLoopbackOrigin(origin);
  if (loopbackOrigin) return true;
  if (ALLOWED_ORIGINS.length > 0) return !!origin && ALLOWED_ORIGINS.includes(origin);
  return !IS_PRODUCTION || AI_DEV_MODE;
};

// â”€â”€ TYPES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface ExtractedTable {
  sid: string;
  ab?: string;
  rows: Record<string, unknown>[];
}

interface ExtractionResult {
  tc?: string;
  st?: string;
  pa0?: number | null;
  pa1?: number | null;
  tables?: ExtractedTable[];
}

type InventoryMode = 'off' | 'conditional' | 'required';

interface ExtractionUncertaintyLowCoverageColumn {
  column: string;
  extractedRows: number;
  medianRows: number;
}

interface ExtractionUncertaintyFlags {
  emptyExtractedColumns?: string[];
  lowCoverageColumns?: ExtractionUncertaintyLowCoverageColumn[];
  inventoryCoverageRatio?: number;
}

interface ExtractionMeta {
  strategy: string;
  apiCalls: number;
  repairedSubtests?: string[];
  inventoryMode?: InventoryMode;
  inventoryColumnCount?: number;
  isInvertedLookup?: boolean;
  expectedSourceColumns?: string[];
  missingSourceColumns?: string[];
  expectedSourceColumnCount?: number;
  uncertaintyFlags?: ExtractionUncertaintyFlags;
  confidenceScore?: number;
}

interface ExtractionRunResult {
  text: string;
  meta: ExtractionMeta;
}

// â”€â”€ RETRY UTILITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = GEMINI_MAX_RETRIES,
  baseDelayMs: number = GEMINI_RETRY_BASE_MS,
  shouldRetry: (error: unknown, attempt: number) => boolean = () => true
): Promise<T> => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }
      return await fn();
    } catch (error) {
      if (attempt === maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }
    }
  }
  throw new Error('Retry failed unexpectedly');
};

// â”€â”€ GEMINI CALL HELPER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Single place for calling Gemini with retry, timeout, and abort handling

const callGemini = async (
  contents: unknown[],
  responseMimeType: string = 'application/json',
  responseSchema?: Record<string, unknown>,
  thinkingBudget?: number,
  maxOutputTokens?: number,
): Promise<{ text: string | null; finishReason: string }> => {
  const generationConfig: Record<string, unknown> = {
    responseMimeType,
    maxOutputTokens: maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    thinkingConfig: { thinkingBudget: thinkingBudget ?? THINKING_BUDGET },
  };
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema;
  }
  const geminiBody = {
    contents,
    generationConfig,
  };

  const response = await retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        const res = await fetch(GEMINI_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': GEMINI_API_KEY,
          },
          body: JSON.stringify(geminiBody),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (res.ok) return res;

        if (!isRetryableStatus(res.status)) {
          await res.text();
          throw new Error(`Gemini error: ${res.status}`);
        }

        await res.text();
        throw new Error(`Retryable Gemini status: ${res.status}`);
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error('Gemini request timed out');
        }
        throw err;
      }
    },
    GEMINI_MAX_RETRIES,
    GEMINI_RETRY_BASE_MS,
    (error) => {
      const msg = String(error).toLowerCase();
      return msg.includes('retryable');
    }
  );

  const data: GeminiResponse = await response.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text ?? null;
  const finishReason = candidate?.finishReason ?? 'UNKNOWN';

  // content:{} with HTTP 200 = Gemini overloaded ("high demand") — treat as retryable
  // so retryWithBackoff handles it the same way as a 503.
  if (text === null) {
    throw new Error('Retryable Gemini empty content');
  }

  return { text, finishReason };
};

const applyInventoryOrdering = (
  result: ExtractionResult | null,
  inventoryColumns: InventoryColumnDescriptor[],
): ExtractionResult | null => {
  if (!result || !Array.isArray(result.tables) || result.tables.length === 0) return result;
  return {
    ...result,
    tables: sortTablesByInventoryOrder(result.tables, inventoryColumns),
  };
};

// â”€â”€ MERGE EXTRACTION RESULTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const buildInventoryColumnKeyLocal = (sid: unknown, ab: unknown): string => {
  const abStr = String(ab ?? '').trim();
  const sidStr = String(sid ?? '').trim();
  return normalizeKeyTolerant(abStr || sidStr);
};

const getInventoryColumnLabel = (column: Pick<InventoryColumnDescriptor, 'sid' | 'ab'>): string => (
  String(column.ab || column.sid || '').trim()
);

const computeMedian = (values: number[]): number => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
};

const buildExtractionRowCountsByKey = (
  result: ExtractionResult,
): Map<string, number[]> => {
  const counts = new Map<string, number[]>();
  if (!Array.isArray(result.tables)) return counts;

  result.tables.forEach((table) => {
    const key = buildInventoryColumnKeyLocal(table.sid, table.ab || null);
    const rowCount = Array.isArray(table.rows) ? table.rows.length : 0;
    const existing = counts.get(key) || [];
    existing.push(rowCount);
    counts.set(key, existing);
  });

  return counts;
};

const buildExtractionRowCountsByInventoryOccurrence = (
  result: ExtractionResult,
  inventoryColumns: InventoryColumnDescriptor[],
): number[] => {
  const countsByKey = buildExtractionRowCountsByKey(result);
  const cursorByKey = new Map<string, number>();

  return inventoryColumns.map((column) => {
    const key = buildInventoryColumnKeyLocal(column.sid, column.ab || null);
    const values = countsByKey.get(key) || [];
    const cursor = cursorByKey.get(key) || 0;
    cursorByKey.set(key, cursor + 1);
    const rowCount = values[cursor];
    return Number.isFinite(rowCount) ? Number(rowCount) : 0;
  });
};

const buildInventoryColumnDisplayLabels = (
  inventoryColumns: InventoryColumnDescriptor[],
): string[] => {
  const labelTotals = new Map<string, number>();
  inventoryColumns.forEach((column) => {
    const label = getInventoryColumnLabel(column) || 'COL';
    labelTotals.set(label, (labelTotals.get(label) || 0) + 1);
  });

  const labelCursors = new Map<string, number>();
  return inventoryColumns.map((column) => {
    const label = getInventoryColumnLabel(column) || 'COL';
    const total = labelTotals.get(label) || 1;
    if (total <= 1) return label;
    const occurrence = (labelCursors.get(label) || 0) + 1;
    labelCursors.set(label, occurrence);
    return `${label} (#${occurrence})`;
  });
};

const computeUncertaintyFlags = (
  result: ExtractionResult | null,
  inventoryColumns: InventoryColumnDescriptor[],
): ExtractionUncertaintyFlags | undefined => {
  if (!result || !Array.isArray(inventoryColumns) || inventoryColumns.length === 0) return undefined;

  const rowCountsByInventoryIndex = buildExtractionRowCountsByInventoryOccurrence(result, inventoryColumns);
  const labels = buildInventoryColumnDisplayLabels(inventoryColumns);
  const counts = inventoryColumns.map((_, index) => {
    const rowCount = rowCountsByInventoryIndex[index] ?? 0;
    return {
      column: labels[index] || `COL #${index + 1}`,
      rows: rowCount,
    };
  });

  const positiveRows = counts.map((entry) => entry.rows).filter((value) => value > 0);
  const medianRows = computeMedian(positiveRows);
  const minExpectedRows = Math.max(3, Math.ceil(medianRows * 0.5));

  const emptyExtractedColumns = counts
    .filter((entry) => entry.rows === 0)
    .map((entry) => entry.column);

  const lowCoverageColumns: ExtractionUncertaintyLowCoverageColumn[] = medianRows > 0
    ? counts
      .filter((entry) => entry.rows > 0 && entry.rows < minExpectedRows)
      .map((entry) => ({
        column: entry.column,
        extractedRows: entry.rows,
        medianRows,
      }))
    : [];

  const coveredColumns = counts.filter((entry) => entry.rows > 0).length;
  const inventoryCoverageRatio = inventoryColumns.length > 0
    ? coveredColumns / inventoryColumns.length
    : undefined;

  const flags: ExtractionUncertaintyFlags = {};
  if (emptyExtractedColumns.length > 0) flags.emptyExtractedColumns = emptyExtractedColumns;
  if (lowCoverageColumns.length > 0) flags.lowCoverageColumns = lowCoverageColumns;
  if (typeof inventoryCoverageRatio === 'number') flags.inventoryCoverageRatio = inventoryCoverageRatio;

  return Object.keys(flags).length > 0 ? flags : undefined;
};

const computeConfidenceScore = (
  uncertaintyFlags: ExtractionUncertaintyFlags | undefined,
  expectedColumnCount: number,
  missingSourceColumnsCount: number,
): number => {
  if (!Number.isFinite(expectedColumnCount) || expectedColumnCount <= 0) return 0.5;

  const coverage = uncertaintyFlags?.inventoryCoverageRatio ?? 1;
  const emptyCount = uncertaintyFlags?.emptyExtractedColumns?.length || 0;
  const lowCoverageCount = uncertaintyFlags?.lowCoverageColumns?.length || 0;
  const emptyRatio = emptyCount / expectedColumnCount;
  const lowCoverageRatio = lowCoverageCount / expectedColumnCount;
  const missingSourceRatio = Math.min(1, Math.max(0, missingSourceColumnsCount / expectedColumnCount));

  const score =
    coverage
    - (emptyRatio * 0.35)
    - (lowCoverageRatio * 0.25)
    - (missingSourceRatio * 0.45);

  return clamp01(score);
};

const annotateExtractionQuality = (
  meta: ExtractionMeta,
  result: ExtractionResult | null,
  inventoryColumns: InventoryColumnDescriptor[],
) => {
  const uncertaintyFlags = computeUncertaintyFlags(result, inventoryColumns);
  meta.uncertaintyFlags = uncertaintyFlags;
  meta.confidenceScore = computeConfidenceScore(
    uncertaintyFlags,
    inventoryColumns.length,
    meta.missingSourceColumns?.length || 0,
  );
};

const hasStableValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const stableRowScore = (row: Record<string, unknown>): number =>
  Object.values(row).reduce<number>((score, value) => score + (hasStableValue(value) ? 1 : 0), 0);

const stableRowValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value);
};

const mergeStableRow = (
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> => {
  const existingScore = stableRowScore(existing);
  const incomingScore = stableRowScore(incoming);
  const preferIncomingOnConflict = incomingScore > existingScore;

  const merged: Record<string, unknown> = { ...existing };
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);
  for (const key of keys) {
    const current = existing[key];
    const next = incoming[key];
    const currentHasValue = hasStableValue(current);
    const nextHasValue = hasStableValue(next);
    if (!currentHasValue && nextHasValue) {
      merged[key] = next;
      continue;
    }
    if (currentHasValue && nextHasValue && preferIncomingOnConflict) {
      const currentNorm = stableRowValue(current);
      const nextNorm = stableRowValue(next);
      if (currentNorm !== nextNorm) {
        merged[key] = next;
      }
    }
  }
  return merged;
};

const isStableParametricRow = (row: Record<string, unknown>): boolean => (
  hasStableValue(row.m) || hasStableValue(row.s)
);

const stableLookupRowKey = (row: Record<string, unknown>): string => (
  `L|${[
    stableRowValue(row.a0),
    stableRowValue(row.a1),
    stableRowValue(row.r),
    stableRowValue(row.gl),
  ].join('|')}`
);

const stableParametricRowKey = (row: Record<string, unknown>): string => (
  `P|${[
    stableRowValue(row.a0),
    stableRowValue(row.a1),
    stableRowValue(row.gl),
  ].join('|')}`
);

const stableMergeRowKey = (row: Record<string, unknown>): string => (
  isStableParametricRow(row) ? stableParametricRowKey(row) : stableLookupRowKey(row)
);

/** Parse the leading numeric value from a raw score string (e.g. "15-16" â†’ 15, "<5" â†’ 5, "7" â†’ 7). */
const parseLeadingRaw = (value: unknown): number => {
  const s = stableRowValue(value);
  if (!s) return Number.MAX_SAFE_INTEGER;
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

const sortStableRows = (rows: Record<string, unknown>[]): Record<string, unknown>[] => {
  return [...rows].sort((a, b) => {
    const a0 = Number.isFinite(Number(a.a0)) ? Number(a.a0) : Number.MAX_SAFE_INTEGER;
    const b0 = Number.isFinite(Number(b.a0)) ? Number(b.a0) : Number.MAX_SAFE_INTEGER;
    if (a0 !== b0) return a0 - b0;
    const a1 = Number.isFinite(Number(a.a1)) ? Number(a.a1) : Number.MAX_SAFE_INTEGER;
    const b1 = Number.isFinite(Number(b.a1)) ? Number(b.a1) : Number.MAX_SAFE_INTEGER;
    if (a1 !== b1) return a1 - b1;
    // Sort by raw score numerically (parsed from r string since r0/r1 are no longer in output)
    const ar = parseLeadingRaw(a.r);
    const br = parseLeadingRaw(b.r);
    if (ar !== br) return ar - br;
    // Final tiebreaker: standard score numerically
    const an = Number.isFinite(Number(a.n)) ? Number(a.n) : Number.MAX_SAFE_INTEGER;
    const bn = Number.isFinite(Number(b.n)) ? Number(b.n) : Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return stableRowValue(a.r).localeCompare(stableRowValue(b.r));
  });
};

const mergeExtractionResultsStable = (results: ExtractionResult[]): ExtractionResult => {
  const merged: ExtractionResult = {
    tc: '',
    st: 'LOOKUP',
    pa0: null,
    pa1: null,
    tables: [],
  };

  const tableMap = new Map<string, { sid: string; ab?: string; rows: Map<string, Record<string, unknown>> }>();

  for (const result of results) {
    if (!result) continue;
    if (result.tc && !merged.tc) merged.tc = result.tc;
    if (result.st) merged.st = result.st;
    // Preserve page-level age (first non-null wins)
    if (result.pa0 != null && merged.pa0 == null) merged.pa0 = result.pa0;
    if (result.pa1 != null && merged.pa1 == null) merged.pa1 = result.pa1;

    if (!Array.isArray(result.tables)) continue;
    for (const table of result.tables) {
      const sid = String(table?.sid || '').trim();
      if (!sid || !Array.isArray(table?.rows)) continue;
      const ab = typeof table.ab === 'string' ? table.ab.trim() : '';
      // Use ab as primary merge key (stable across chunks); fall back to sid
      const primaryKey = ab || sid;
      const tableKey = normalizeKeyTolerant(primaryKey);

      if (!tableMap.has(tableKey)) {
        tableMap.set(tableKey, {
          sid: ab || sid,
          ab: ab || undefined,
          rows: new Map<string, Record<string, unknown>>(),
        });
      }

      const accumulator = tableMap.get(tableKey)!;
      if (!accumulator.ab && ab) accumulator.ab = ab;

      for (const rawRow of table.rows) {
        if (!rawRow || typeof rawRow !== 'object') continue;
        const row = rawRow as Record<string, unknown>;
        const rowKey = stableMergeRowKey(row);
        const existing = accumulator.rows.get(rowKey);
        if (!existing) {
          accumulator.rows.set(rowKey, { ...row });
        } else {
          accumulator.rows.set(rowKey, mergeStableRow(existing, row));
        }
      }
    }
  }

  merged.tables = Array.from(tableMap.values()).map((entry) => ({
    sid: entry.sid,
    ab: entry.ab,
    rows: sortStableRows(Array.from(entry.rows.values())),
  }));

  return merged;
};

// â”€â”€ SAFE JSON PARSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const safeJsonParse = (text: string | null): ExtractionResult | null => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Try to salvage truncated JSON by finding the last complete table entry
    const lastBracket = text.lastIndexOf('}');
    if (lastBracket > 0) {
      try {
        // Attempt to close the arrays/objects
        const truncated = text.substring(0, lastBracket + 1) + ']}';
        return JSON.parse(truncated);
      } catch {
        return null;
      }
    }
    return null;
  }
};

type StatRole = 'mean' | 'sd' | 'none';

type MergedParametricRow = {
  a0?: number;
  a1?: number;
  gl?: string;
  m?: string;
  s?: string;
};

type ParametricAccumulator = {
  sid: string;
  ab?: string;
  rows: Map<string, MergedParametricRow>;
};

type ParametricTableDescriptor = {
  tableKey: string;
  outputSid: string;
  outputAb?: string;
  role: StatRole;
  rows: Record<string, unknown>[];
};

const normalizeToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const STAT_MEAN_TOKENS = new Set(['M', 'MOY', 'MOYENNE', 'MEAN', 'AVG']);
const STAT_SD_TOKENS = new Set(['ET', 'SD', 'SIGMA', 'ECARTTYPE', 'ECARTTYPESTD', 'STDDEV']);

const detectStatRoleFromValue = (value: unknown): StatRole => {
  if (typeof value !== 'string' || !value.trim()) return 'none';
  const token = normalizeToken(value);
  if (!token) return 'none';
  if (STAT_MEAN_TOKENS.has(token)) return 'mean';
  if (STAT_SD_TOKENS.has(token)) return 'sd';
  return 'none';
};

const splitStatSuffix = (sid: string): { baseSid: string; suffixToken?: string } => {
  const trimmed = sid.trim();
  if (!trimmed) return { baseSid: '' };

  const parenthetical = trimmed.match(/\(([^)]+)\)\s*$/);
  if (parenthetical && typeof parenthetical.index === 'number') {
    return {
      baseSid: trimmed.slice(0, parenthetical.index).trim(),
      suffixToken: parenthetical[1].trim(),
    };
  }

  const dashed = trimmed.match(/(?:[-\u2013\u2014:])\s*([A-Za-z\u00C0-\u00FF.\s]+)\s*$/);
  if (dashed && typeof dashed.index === 'number') {
    return {
      baseSid: trimmed.slice(0, dashed.index).trim(),
      suffixToken: dashed[1].trim(),
    };
  }

  return { baseSid: trimmed };
};

const pickNumericString = (value: unknown): string | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const raw = value.trim();
  if (!raw) return undefined;
  const cleaned = raw.replace(',', '.').replace(/[^0-9.+-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '+' || cleaned === '.' || cleaned === '+.' || cleaned === '-.') {
    return undefined;
  }

  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) return undefined;
  return cleaned;
};

const pickOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
};

const sanitizeGroupLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const buildParametricRowKey = (row: MergedParametricRow): string => {
  const agePart = `${row.a0 ?? 'na'}|${row.a1 ?? 'na'}`;
  const groupPart = row.gl ? normalizeToken(row.gl) : '';
  return `${agePart}|${groupPart || 'nogroup'}`;
};

const describeParametricTable = (table: ExtractedTable): ParametricTableDescriptor | null => {
  const sid = String(table?.sid || '').trim();
  if (!sid || !Array.isArray(table?.rows) || table.rows.length === 0) return null;

  const { baseSid, suffixToken } = splitStatSuffix(sid);
  const roleFromSuffix = detectStatRoleFromValue(suffixToken);
  const roleFromAb = detectStatRoleFromValue(table.ab);
  const role: StatRole = roleFromAb !== 'none' ? roleFromAb : roleFromSuffix;
  const outputSid = role !== 'none' && baseSid ? baseSid : sid;
  if (!outputSid) return null;

  const abRaw = typeof table.ab === 'string' ? table.ab.trim() : '';
  const isNonStatAb = !!abRaw && detectStatRoleFromValue(abRaw) === 'none';
  const outputAb = role === 'none' && isNonStatAb ? abRaw : undefined;
  const tableKey = outputAb ? `${outputSid}::ab:${normalizeToken(outputAb)}` : outputSid;

  return {
    tableKey,
    outputSid,
    outputAb,
    role,
    rows: table.rows as Record<string, unknown>[],
  };
};

const sanitizeParametricExtraction = (result: ExtractionResult): ExtractionResult => {
  if (String(result.st || '').toUpperCase() !== 'PARAMETRIC' || !Array.isArray(result.tables)) {
    return result;
  }

  // Propagate page-level age to rows that are missing a0/a1
  const pa0 = typeof result.pa0 === 'number' && Number.isFinite(result.pa0) ? result.pa0 : null;
  const pa1 = typeof result.pa1 === 'number' && Number.isFinite(result.pa1) ? result.pa1 : null;

  const tableMap = new Map<string, ParametricAccumulator>();
  const descriptors = result.tables
    .map((table) => describeParametricTable(table))
    .filter((descriptor): descriptor is ParametricTableDescriptor => !!descriptor);

  for (const descriptor of descriptors) {
    let accumulator = tableMap.get(descriptor.tableKey);
    if (!accumulator) {
      accumulator = {
        sid: descriptor.outputSid,
        ab: descriptor.outputAb,
        rows: new Map<string, MergedParametricRow>(),
      };
      tableMap.set(descriptor.tableKey, accumulator);
    } else if (!accumulator.ab && descriptor.outputAb) {
      accumulator.ab = descriptor.outputAb;
    }

    for (const row of descriptor.rows) {
      const mergedCandidate: MergedParametricRow = {
        a0: pickOptionalNumber(row.a0) ?? (pa0 !== null ? pa0 : undefined),
        a1: pickOptionalNumber(row.a1) ?? (pa1 !== null ? pa1 : undefined),
        gl: sanitizeGroupLabel(row.gl),
      };

      const rowKey = buildParametricRowKey(mergedCandidate);
      let mergedRow = accumulator.rows.get(rowKey);
      if (!mergedRow) {
        mergedRow = { ...mergedCandidate };
        accumulator.rows.set(rowKey, mergedRow);
      }

      let meanVal = pickNumericString(row.m);
      let sdVal = pickNumericString(row.s);
      if (descriptor.role === 'mean' && !meanVal) meanVal = pickNumericString(row.s);
      if (descriptor.role === 'sd' && !sdVal) sdVal = pickNumericString(row.m);

      if (mergedRow.a0 === undefined && mergedCandidate.a0 !== undefined) mergedRow.a0 = mergedCandidate.a0;
      if (mergedRow.a1 === undefined && mergedCandidate.a1 !== undefined) mergedRow.a1 = mergedCandidate.a1;
      if (!mergedRow.gl && mergedCandidate.gl) mergedRow.gl = mergedCandidate.gl;
      if (meanVal && !mergedRow.m) mergedRow.m = meanVal;
      if (sdVal && !mergedRow.s) mergedRow.s = sdVal;
    }
  }

  const sanitizedTables: ExtractedTable[] = [];
  for (const accumulator of tableMap.values()) {
    const rows = Array.from(accumulator.rows.values())
      .filter((row) => !!row.m && !!row.s)
      .sort((a, b) => {
        const a0 = a.a0 ?? Number.MAX_SAFE_INTEGER;
        const b0 = b.a0 ?? Number.MAX_SAFE_INTEGER;
        if (a0 !== b0) return a0 - b0;
        const a1 = a.a1 ?? Number.MAX_SAFE_INTEGER;
        const b1 = b.a1 ?? Number.MAX_SAFE_INTEGER;
        return a1 - b1;
      })
      .map((row) => {
        const cleanRow: Record<string, unknown> = {
          m: row.m,
          s: row.s,
        };
        if (typeof row.gl === 'string' && row.gl) cleanRow.gl = row.gl;
        if (typeof row.a0 === 'number') cleanRow.a0 = row.a0;
        if (typeof row.a1 === 'number') cleanRow.a1 = row.a1;
        return cleanRow;
      });

    if (rows.length === 0) continue;
    const nextTable: ExtractedTable = { sid: accumulator.sid, rows };
    if (accumulator.ab) nextTable.ab = accumulator.ab;
    sanitizedTables.push(nextTable);
  }

  return {
    ...result,
    tables: sanitizedTables,
  };
};

/**
 * Normalize common symbol corruption in raw score values.
 * Gemini sometimes outputs ">=", "R 282", "da45" instead of "≥ 282".
 * Deterministic server-side fix — cheaper than prompt tokens.
 */
const normalizeRawSymbols = (value: string): string => {
  let v = value.trim();
  // ">=" / ">=" → "≥", "<=" → "≤"
  v = v.replace(/^>=\s*/, '≥ ').replace(/^<=\s*/, '≤ ');
  // Bare ">" / "<" before a digit → "≥" / "≤" (Gemini reads ≥/≤ as >/< )
  v = v.replace(/^>\s*(\d)/, '≥ $1').replace(/^<\s*(\d)/, '≤ $1');
  // Leading "R " or "r " before a digit → "≥ " (OCR misread of ≥)
  v = v.replace(/^[Rr]\s+(\d)/, '≥ $1');
  return v.trim();
};

const sanitizeLookupExtraction = (result: ExtractionResult): ExtractionResult => {
  if (String(result.st || '').toUpperCase() !== 'LOOKUP' || !Array.isArray(result.tables)) {
    return result;
  }

  // Step 0: Normalize symbols on raw score values
  for (const table of result.tables) {
    if (!Array.isArray(table.rows)) continue;
    for (const row of table.rows) {
      if (typeof row.r === 'string') {
        row.r = normalizeRawSymbols(row.r);
      }
    }
  }

  // Step 1: Propagate page-level age to rows missing a0/a1
  const pa0 = typeof result.pa0 === 'number' && Number.isFinite(result.pa0) ? result.pa0 : null;
  const pa1 = typeof result.pa1 === 'number' && Number.isFinite(result.pa1) ? result.pa1 : null;
  if (pa0 !== null || pa1 !== null) {
    for (const table of result.tables) {
      if (!Array.isArray(table.rows)) continue;
      for (const row of table.rows) {
        if (row.a0 == null && pa0 !== null) row.a0 = pa0;
        if (row.a1 == null && pa1 !== null) row.a1 = pa1;
      }
    }
  }

  // Step 2: Infer missing n values for inverted LOOKUP (NS 1-19)
  // Find a reference table that has full n values
  const refTable = result.tables.find((t) => {
    const rows = t.rows as Record<string, unknown>[];
    return rows.length >= 10
      && rows.length <= 25
      && rows.every((row) => row.n && String(row.n).trim() !== '');
  });

  if (refTable) {
    const refRows = refTable.rows as Record<string, unknown>[];
    const firstN = Number(refRows[0].n);
    const lastN = Number(refRows[refRows.length - 1].n);
    const ascending = !Number.isFinite(firstN) || !Number.isFinite(lastN) || lastN >= firstN;

    const fillMissingN = (
      rows: Record<string, unknown>[],
    ) => {
      if (rows.length === 0 || rows.length > 25) return;
      const missingN = rows.filter((row) => !row.n || String(row.n).trim() === '').length;
      if (missingN === 0) return;

      if (rows.length === refRows.length) {
        rows.forEach((row, i) => {
          if (!row.n || String(row.n).trim() === '') {
            row.n = String(refRows[i].n);
          }
        });
      } else {
        rows.forEach((row, i) => {
          if (!row.n || String(row.n).trim() === '') {
            row.n = ascending ? String(i + 1) : String(rows.length - i);
          }
        });
      }
    };

    for (const table of result.tables) {
      fillMissingN(table.rows as Record<string, unknown>[]);
    }
  } else {
    // No reference table: assign sequential 1..N
    for (const table of result.tables) {
      const rows = table.rows as Record<string, unknown>[];
      if (rows.length === 0 || rows.length > 25) continue;
      const missingN = rows.filter((row) => !row.n || String(row.n).trim() === '').length;
      if (missingN === 0) continue;
      rows.forEach((row, i) => {
        if (!row.n || String(row.n).trim() === '') {
          row.n = String(i + 1);
        }
      });
    }
  }


  return result;
};

const sanitizeExtractionResult = (result: ExtractionResult): ExtractionResult => {
  const structure = String(result.st || '').toUpperCase();
  if (structure === 'PARAMETRIC') return sanitizeParametricExtraction(result);
  if (structure === 'LOOKUP') return sanitizeLookupExtraction(result);
  return result;
};

// V1 orchestrators (extractWithFallback, extractWithRepair) and all verification
// passes (V1 + V2) removed. Server-side quality is now handled by identifyRetryColumns.

const runChunkedInventoryExtraction = async (
  payload: Record<string, unknown>,
  inventory: InventoryResult,
): Promise<{ parsed: ExtractionResult; apiCalls: number; strategy: string }> => {
  const adaptiveChunkSize = computeAdaptiveChunkSize(inventory.columns.length, MAX_SUBTESTS_PER_CHUNK);
  const chunks = chunkInventoryColumns(inventory.columns, adaptiveChunkSize);
  if (chunks.length === 0) {
    throw new Error('Inventory scan did not return any extractable columns');
  }

  const runChunk = async (chunk: { columns: InventoryColumnDescriptor[]; domainHint: string }) => {
    const task = buildFocusedExtractionTaskV2(payload, chunk.columns, chunk.domainHint);
    const { text } = await callGemini(task.contents, 'application/json', LOOKUP_EXTRACTION_RESPONSE_SCHEMA, undefined, CHUNK_OUTPUT_TOKENS);
    return safeJsonParse(text);
  };

  const computeChunkCoverage = (
    parsed: ExtractionResult | null,
    columns: InventoryColumnDescriptor[],
  ): number => {
    if (!parsed || !Array.isArray(parsed.tables) || parsed.tables.length === 0 || columns.length === 0) return 0;

    const rowsByKey = new Map<string, number[]>();
    parsed.tables.forEach((table) => {
      const key = buildInventoryColumnKeyLocal(table.sid, table.ab || null);
      const rowCount = Array.isArray(table.rows) ? table.rows.length : 0;
      const existing = rowsByKey.get(key) || [];
      existing.push(rowCount);
      rowsByKey.set(key, existing);
    });

    const cursorByKey = new Map<string, number>();
    let coveredColumns = 0;
    columns.forEach((column) => {
      const key = buildInventoryColumnKeyLocal(column.sid, column.ab || null);
      const values = rowsByKey.get(key) || [];
      const cursor = cursorByKey.get(key) || 0;
      cursorByKey.set(key, cursor + 1);
      const rowCount = values[cursor] || 0;
      if (rowCount > 0) coveredColumns += 1;
    });

    return coveredColumns / Math.max(1, columns.length);
  };

  const assessed = await Promise.all(
    chunks.map(async (chunk, i) => {
      // Stagger chunk starts by 300ms each to avoid a simultaneous burst
      // that causes Gemini 503s (e.g. 15 chunks × 0ms = 15 parallel calls).
      if (i > 0) await sleep(i * 300);
      const parsed = await runChunk(chunk);
      return {
        chunk,
        parsed,
        coverage: computeChunkCoverage(parsed, chunk.columns),
      };
    }),
  );
  let apiCalls = chunks.length;

  const retryCandidates = assessed.filter((entry) => !entry.parsed || entry.coverage < CHUNK_MIN_COLUMN_COVERAGE_RATIO);
  if (retryCandidates.length > 0) {
    const retried = await Promise.all(retryCandidates.map(async (entry, i) => {
      if (i > 0) await sleep(i * 500);
      return runChunk(entry.chunk);
    }));
    apiCalls += retryCandidates.length;
    retryCandidates.forEach((entry, index) => {
      const parsed = retried[index];
      entry.parsed = parsed;
      entry.coverage = computeChunkCoverage(parsed, entry.chunk.columns);
    });
  }

  const incompleteChunks = assessed.filter((entry) => !entry.parsed || entry.coverage < CHUNK_MIN_COLUMN_COVERAGE_RATIO);
  if (incompleteChunks.length > 0) {
    throw new Error(`Chunked extraction incomplete: ${incompleteChunks.length}/${chunks.length} chunks below coverage threshold`);
  }

  const parsedResults = assessed
    .map((entry) => entry.parsed)
    .filter((entry): entry is ExtractionResult => !!entry);
  if (parsedResults.length === 0) {
    throw new Error('Chunked extraction returned no valid JSON');
  }

  const merged = applyInventoryOrdering(
    mergeExtractionResultsStable([
      {
        tc: inventory.tc || undefined,
        st: inventory.st || 'LOOKUP',
        tables: [],
      },
      ...parsedResults,
    ]),
    inventory.columns,
  );

  if (!merged) {
    throw new Error('Unable to merge chunked extraction results');
  }

  return {
    parsed: merged,
    apiCalls,
    strategy: retryCandidates.length > 0
      ? `inventory-chunked-${chunks.length}+retry-${retryCandidates.length}`
      : `inventory-chunked-${chunks.length}`,
  };
};

// Consolidated quality gate: identify ALL columns needing retry in a single pass.
// Checks: missing/low coverage, missing n values, overlapping raw ranges, duplicate columns.
// Returns a deduplicated list of inventory columns to re-extract in ONE repair call.
const identifyRetryColumns = (
  result: ExtractionResult,
  inventoryColumns: InventoryColumnDescriptor[],
): InventoryColumnDescriptor[] => {
  if (!result?.tables || inventoryColumns.length === 0) return [];

  const retryKeys = new Set<string>();
  const retryColumns: InventoryColumnDescriptor[] = [];

  const addRetryColumn = (col: InventoryColumnDescriptor) => {
    const key = normalizeKeyTolerant(col.ab || col.sid);
    if (retryKeys.has(key)) return;
    retryKeys.add(key);
    retryColumns.push(col);
  };

  // 1. Missing or very low coverage
  const rowCounts = buildExtractionRowCountsByInventoryOccurrence(result, inventoryColumns);
  const positiveRows = Object.values(rowCounts).filter((v) => v > 0);
  const medianRows = computeMedian(positiveRows);
  const minExpectedRows = Math.max(3, Math.ceil(medianRows * 0.5));
  const isLookup = String(result.st || '').toUpperCase() === 'LOOKUP';

  for (let idx = 0; idx < inventoryColumns.length; idx++) {
    const col = inventoryColumns[idx];
    const rows = rowCounts[idx] ?? 0;

    if (rows < minExpectedRows) {
      addRetryColumn(col);
      continue;
    }

    // Check for missing n values in LOOKUP tables
    if (isLookup) {
      const table = result.tables?.find((t) => t.sid === col.sid);
      if (table?.rows) {
        const missingN = table.rows.filter((r) => r.n === undefined || r.n === null || r.n === '').length;
        if (missingN > 0) {
          addRetryColumn(col);
        }
      }
    }
  }

  // 2. Overlapping raw ranges
  if (isLookup) {
    const overlaps = detectOverlappingRanges(result);
    for (const overlap of overlaps) {
      const col = inventoryColumns.find((c) =>
        normalizeKeyTolerant(c.ab || c.sid) === normalizeKeyTolerant(overlap.ab || overlap.sid)
      );
      if (col) addRetryColumn(col);
    }
  }

  // 3. Duplicate columns (hallucination/drift)
  const duplicates = detectDuplicateColumns(result);
  for (const dup of duplicates) {
    for (const sid of [dup.sid1, dup.sid2]) {
      const ab = sid === dup.sid1 ? dup.ab1 : dup.ab2;
      const col = inventoryColumns.find((c) =>
        normalizeKeyTolerant(c.ab || c.sid) === normalizeKeyTolerant(ab || sid)
      );
      if (col) addRetryColumn(col);
    }
  }

  // 4. Combined-score columns (e.g. "MP & MPD") — almost always drifted
  for (const col of inventoryColumns) {
    if (isCombinedScoreColumn(col)) {
      addRetryColumn(col);
    }
  }

  return retryColumns.slice(0, MAX_REPAIR_TARGETS);
};

// ── NS ROW DEDUP + PADDING ──────────────────────────────────────────────────
// For inverted LOOKUP tables (NS 1-19):
//  1. Deduplicate rows with the same NS value (keep real value over dash).
//  2. Pad missing NS values with r:"-" (dash = not scorable).
const padMissingNsRows = (result: ExtractionResult, isInverted: boolean): ExtractionResult => {
  if (!isInverted || !result.tables || result.tables.length === 0) return result;
  if (String(result.st || '').toUpperCase() !== 'LOOKUP') return result;

  const isDash = (r: unknown): boolean => {
    const s = String(r ?? '').trim();
    return s === '' || /^[-\u2013\u2014:]+$/.test(s);
  };

  for (const table of result.tables) {
    if (!Array.isArray(table.rows)) continue;

    // Step A: Deduplicate rows with the same n value
    const byN = new Map<number, Record<string, unknown>[]>();
    for (const row of table.rows) {
      const n = Number(row.n);
      if (!Number.isFinite(n)) continue;
      const bucket = byN.get(n) || [];
      bucket.push(row);
      byN.set(n, bucket);
    }
    const deduped: Record<string, unknown>[] = [];
    for (const [, rows] of byN) {
      if (rows.length === 1) {
        deduped.push(rows[0]);
      } else {
        // Prefer row with real raw value (non-dash) over dash
        const real = rows.find((r) => !isDash(r.r));
        deduped.push(real || rows[0]);
      }
    }
    // Include rows without valid n (shouldn't happen but defensive)
    for (const row of table.rows) {
      const n = Number(row.n);
      if (!Number.isFinite(n)) deduped.push(row);
    }
    table.rows = deduped;

    // Step B: Pad missing NS values
    const existingNs = new Set<number>();
    for (const row of table.rows) {
      const n = Number(row.n);
      if (Number.isFinite(n)) existingNs.add(n);
    }
    if (existingNs.size === 0) continue;
    const maxNs = Math.max(...existingNs);
    if (maxNs < 10 || maxNs > 25) continue;

    for (let ns = 1; ns <= maxNs; ns++) {
      if (!existingNs.has(ns)) {
        table.rows.push({ r: '-', n: String(ns) });
      }
    }
    // Re-sort rows by NS value
    table.rows.sort((a, b) => {
      const na = Number(a.n) || 0;
      const nb = Number(b.n) || 0;
      return na - nb;
    });
  }
  return result;
};

const extractWithFallbackV2 = async (
  payload: Record<string, unknown>
): Promise<ExtractionRunResult> => {
  const inventoryTask = buildInventoryScanTaskV2(payload);
  const { text: inventoryText } = await callGemini(inventoryTask.contents, 'application/json', INVENTORY_RESPONSE_SCHEMA, INVENTORY_THINKING_BUDGET, INVENTORY_OUTPUT_TOKENS);
  const inventory = parseInventoryResult(inventoryText);

  if (!inventory || !inventory.st) {
    const fullTask = buildFullExtractionTask(payload);
    const { text: fullText } = await callGemini(fullTask.contents, 'application/json', EXTRACTION_RESPONSE_SCHEMA);
    if (!fullText) throw new Error('Full extraction returned empty response');
    return {
      text: fullText,
      meta: {
        strategy: 'single-no-inventory',
        apiCalls: 2,
        inventoryMode: 'conditional',
      },
    };
  }

  const routing = decideExtractionRouting(inventory, PRECHECK_COLUMN_THRESHOLD);
  const baseMeta: ExtractionMeta = {
    strategy: routing.mode,
    apiCalls: 1,
    inventoryMode: 'required',
    inventoryColumnCount: routing.inventoryColumnCount,
    isInvertedLookup: routing.isInverted,
  };

  // Conversion tables (NS→Percentile, etc.) are not norm data — skip extraction entirely.
  if (routing.mode === 'conversion-skip') {
    return {
      text: JSON.stringify({ st: 'CONVERSION', tc: inventory.tc || '', tables: [] }),
      meta: {
        ...baseMeta,
        strategy: 'conversion-skip',
        confidenceScore: 1,
        expectedSourceColumns: [],
        missingSourceColumns: [],
        expectedSourceColumnCount: 0,
      },
    };
  }

  let parsed: ExtractionResult | null = null;
  if (routing.mode === 'lookup-chunked' && inventory.columns.length > 0) {
    try {
      const chunked = await runChunkedInventoryExtraction(payload, inventory);
      parsed = chunked.parsed;
      baseMeta.apiCalls += chunked.apiCalls;
      baseMeta.strategy = chunked.strategy;
    } catch (chunkError) {
      // Dense lookup pages should avoid serial full recovery fallback to stay under edge timeout budget.
      if (inventory.columns.length > 20) {
        throw chunkError;
      }
      const fullTask = buildFullExtractionTask(payload);
      const { text: recoveryText, finishReason: recoveryFinishReason } = await callGemini(fullTask.contents, 'application/json', LOOKUP_EXTRACTION_RESPONSE_SCHEMA);
      baseMeta.apiCalls += 1;
      parsed = safeJsonParse(recoveryText);
      if (!parsed) {
        throw new Error('Chunked extraction incomplete and full recovery failed');
      }
      baseMeta.strategy = recoveryFinishReason === 'MAX_TOKENS' || recoveryFinishReason === 'LENGTH'
        ? `${routing.mode}+full-recovery-truncated`
        : `${routing.mode}+full-recovery`;
    }
  } else {
    const fullTask = buildFullExtractionTask(payload);
    const fullSchema = String(inventory.st || '').toUpperCase() === 'LOOKUP' ? LOOKUP_EXTRACTION_RESPONSE_SCHEMA : EXTRACTION_RESPONSE_SCHEMA;
    const { text: fullText, finishReason } = await callGemini(fullTask.contents, 'application/json', fullSchema);
    baseMeta.apiCalls += 1;
    parsed = safeJsonParse(fullText);

    const shouldFallbackToChunked =
      String(inventory.st || '').toUpperCase() === 'LOOKUP'
      && inventory.columns.length > 0
      && (
        finishReason === 'MAX_TOKENS'
        || finishReason === 'LENGTH'
        || !parsed
        || ((parsed?.tables?.length ?? 0) < Math.max(1, Math.floor(inventory.columns.length * 0.7)))
      );

    if (shouldFallbackToChunked) {
      const chunked = await runChunkedInventoryExtraction(payload, inventory);
      parsed = chunked.parsed;
      baseMeta.apiCalls += chunked.apiCalls;
      baseMeta.strategy = `${routing.mode}+chunk-fallback`;
    }
  }

  if (!parsed) {
    throw new Error('Extraction returned no valid JSON');
  }

  parsed = applyInventoryOrdering(parsed, inventory.columns);
  if (!parsed) {
    throw new Error('Extraction ordering failed');
  }
  // For PARAMETRIC, deduplicate columns to one per unique subtest before quality checks.
  // The extractor produces one Moyenne+ET pair per subtest regardless of how many
  // historical/duplicate visual columns the table contains.
  const qualityColumns = routing.mode === 'parametric-full'
    ? deduplicateInventoryColumnsForParametric(inventory.columns)
    : inventory.columns;
  const completeness = summarizeInventoryCompleteness(parsed, qualityColumns);
  baseMeta.expectedSourceColumns = completeness.expectedSourceColumns;
  baseMeta.missingSourceColumns = completeness.missingSourceColumns;
  baseMeta.expectedSourceColumnCount = completeness.expectedSourceColumnCount;
  annotateExtractionQuality(baseMeta, parsed, qualityColumns);

  // Pad missing NS rows for inverted LOOKUP
  parsed = padMissingNsRows(parsed, routing.isInverted);

  let baseResult: ExtractionRunResult = {
    text: JSON.stringify(parsed),
    meta: baseMeta,
  };


  // Server-side quality check: identify columns needing retry
  const retryColumns = identifyRetryColumns(parsed, inventory.columns);
  if (retryColumns.length === 0) {
    return baseResult;
  }

  // Single repair call for problematic columns
  const repairRequest: RepairRequestPayload = {
    focusSubtests: retryColumns.map((col) => ({
      name: col.sid,
      abbreviation: col.ab || null,
      domain: col.domain || null,
      columnOrder: col.columnOrder ?? null,
      isInverted: col.isInverted === true,
    })),
    expectedGroupCounts: [],
    includeNeighborColumns: true,
    existingSubtests: parsed.tables?.map((t) => t.sid).filter(Boolean) || [],
    dominantAgeMin: parsed.pa0 ?? null,
    dominantAgeMax: parsed.pa1 ?? null,
  };

  const repairTask = buildRepairExtractionTaskV2(payload, repairRequest);
  const isLookupStructure = String(inventory.st || '').toUpperCase() === 'LOOKUP';
  const repairSchema = isLookupStructure ? LOOKUP_EXTRACTION_RESPONSE_SCHEMA : EXTRACTION_RESPONSE_SCHEMA;
  const { text: repairText } = await callGemini(repairTask.contents, 'application/json', repairSchema, undefined, CHUNK_OUTPUT_TOKENS);
  baseMeta.apiCalls += 1;
  const repairedResult = safeJsonParse(repairText);

  if (!repairedResult || !Array.isArray(repairedResult.tables)) {
    baseMeta.strategy = `${baseMeta.strategy}+repair-failed`;
    return baseResult;
  }

  const merged = applyInventoryOrdering(
    mergeExtractionResultsStable([parsed, repairedResult]),
    inventory.columns,
  );
  if (!merged) {
    return baseResult;
  }

  baseMeta.strategy = `${baseMeta.strategy}+repaired`;
  baseMeta.repairedSubtests = retryColumns.map((col) => col.sid);
  annotateExtractionQuality(baseMeta, merged, qualityColumns);

  // Pad missing NS rows for inverted LOOKUP
  const paddedMerged = padMissingNsRows(merged, routing.isInverted);

  return {
    text: JSON.stringify(paddedMerged),
    meta: baseMeta,
  };
};
const extractWithRepairV2 = async (
  payload: Record<string, unknown>,
  repairRequest: RepairRequestPayload
): Promise<ExtractionRunResult> => {
  const inventoryTask = buildInventoryScanTaskV2(payload);
  const { text: inventoryText } = await callGemini(inventoryTask.contents, 'application/json', INVENTORY_RESPONSE_SCHEMA, INVENTORY_THINKING_BUDGET, INVENTORY_OUTPUT_TOKENS);
  const inventory = parseInventoryResult(inventoryText);

  const inventoryColumns = inventory?.columns || [];
  const matchedColumns = matchRepairColumns(
    inventoryColumns,
    repairRequest.focusSubtests.map((entry) => ({
      sid: entry.name,
      ab: entry.abbreviation || null,
    })),
    repairRequest.includeNeighborColumns,
  );

  const effectiveRepairRequest: RepairRequestPayload = {
    ...repairRequest,
    focusSubtests: matchedColumns.length > 0
      ? matchedColumns.map((column) => ({
        name: column.sid,
        abbreviation: column.ab || null,
        domain: column.domain || null,
        columnOrder: column.columnOrder ?? null,
        isInverted: column.isInverted === true,
      }))
      : repairRequest.focusSubtests,
  };

  const repairTask = buildRepairExtractionTaskV2(payload, effectiveRepairRequest);
  const repairIsLookup = String(inventory?.st || '').toUpperCase() === 'LOOKUP';
  const repairSchema = repairIsLookup ? LOOKUP_EXTRACTION_RESPONSE_SCHEMA : EXTRACTION_RESPONSE_SCHEMA;
  const { text } = await callGemini(repairTask.contents, 'application/json', repairSchema, undefined, CHUNK_OUTPUT_TOKENS);
  if (!text) {
    throw new Error('Repair extraction returned empty response');
  }

  const parsed = safeJsonParse(text);
  if (!parsed) {
    throw new Error('Repair extraction returned invalid JSON');
  }

  const orderedParsed = applyInventoryOrdering(parsed, inventoryColumns) || parsed;
  const repairedSubtests = effectiveRepairRequest.focusSubtests.map((entry) => entry.name);
  const repairIsParametric = String(inventory?.st || '').toUpperCase() === 'PARAMETRIC';
  const repairQualityColumns = repairIsParametric
    ? deduplicateInventoryColumnsForParametric(inventoryColumns)
    : inventoryColumns;
  const completeness = summarizeInventoryCompleteness(orderedParsed, repairQualityColumns);
  const meta: ExtractionMeta = {
    strategy: 'repair-focused-v2',
    apiCalls: 2,
    repairedSubtests,
    inventoryMode: 'required',
    inventoryColumnCount: inventoryColumns.length,
    isInvertedLookup: inventory?.isInverted === true,
    expectedSourceColumns: completeness.expectedSourceColumns,
    missingSourceColumns: completeness.missingSourceColumns,
    expectedSourceColumnCount: completeness.expectedSourceColumnCount,
  };
  annotateExtractionQuality(meta, orderedParsed, repairQualityColumns);


  return {
    text: JSON.stringify(orderedParsed),
    meta,
  };
};

const getImagePartByteSize = (imagePart: unknown): number => {
  if (!imagePart || typeof imagePart !== 'object') return 0;
  const inlineData = (imagePart as { inlineData?: { data?: unknown } }).inlineData;
  const base64 = typeof inlineData?.data === 'string' ? inlineData.data.trim() : '';
  if (!base64) return 0;
  return Math.floor((base64.length * 3) / 4);
};

const isStrictBase64 = (value: string): boolean => {
  if (!value || value.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
};

const getImagePartValidationError = (imagePart: unknown): string | null => {
  if (!imagePart || typeof imagePart !== 'object') return 'INVALID_IMAGE_PART';
  const inlineData = (imagePart as { inlineData?: { mimeType?: unknown; data?: unknown } }).inlineData;
  const mimeType = typeof inlineData?.mimeType === 'string' ? inlineData.mimeType.trim().toLowerCase() : '';
  const base64 = typeof inlineData?.data === 'string' ? inlineData.data.trim() : '';
  if (!mimeType || !base64) return 'INVALID_IMAGE_PART_MISSING_FIELDS';
  if (!allowedMimeTypes.has(mimeType)) return 'INVALID_IMAGE_PART_MIME_TYPE';
  if (!isStrictBase64(base64)) return 'INVALID_IMAGE_PART_BASE64_FORMAT';
  const imageBytes = getImagePartByteSize(imagePart);
  if (imageBytes <= 0) return 'INVALID_IMAGE_PART_EMPTY';
  if (imageBytes > MAX_IMAGE_PART_BYTES) return 'INVALID_IMAGE_PART_TOO_LARGE';
  return null;
};


const safeLogExtractionFailure = async (
  sb: ReturnType<typeof createClient> | null,
  userId: string | null,
  filename: string,
  remainingQuota: number,
  strategy: string,
  repairRequest: RepairRequestPayload | null,
) => {
  if (!sb || !userId) return;
  try {
    await sb.from('extraction_log').insert({
      user_id: userId,
      filename,
      status: 'failed',
      token_estimate: 0,
      remaining_quota: Math.max(0, remainingQuota),
      strategy,
      api_calls: 0,
      repair_mode: repairRequest ? 'targeted' : 'none',
      repair_targets_count: repairRequest?.focusSubtests.length || 0,
    });
  } catch (_err) {
    // no-op
  }
};

const isMissingRpcError = (error: { message?: string } | null | undefined, rpcName: string): boolean => {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const name = rpcName.toLowerCase();
  return msg.includes(name) && (msg.includes('does not exist') || msg.includes('not found'));
};

const checkExtractionAccess = async (
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ hasAccess: boolean; remainingQuota: number }> => {
  try {
    const { data, error } = await adminClient.rpc('check_extraction_access_for_user', {
      p_user_id: userId,
    });
    if (error) {
      if (!isMissingRpcError(error, 'check_extraction_access_for_user')) {
        return { hasAccess: false, remainingQuota: 0 };
      }
      const { data: legacyData, error: legacyError } = await userClient.rpc('check_extraction_access');
      const legacyRow = Array.isArray(legacyData) ? legacyData[0] : legacyData;
      if (legacyError || !legacyRow) return { hasAccess: false, remainingQuota: 0 };
      return {
        hasAccess: legacyRow.has_access === true,
        remainingQuota: Number(legacyRow.remaining_quota ?? 0),
      };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      hasAccess: row?.has_access === true,
      remainingQuota: Number(row?.remaining_quota ?? 0),
    };
  } catch {
    return { hasAccess: false, remainingQuota: 0 };
  }
};

const checkExtractionRateLimit = async (
  userClient: ReturnType<typeof createClient>,
  adminClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<boolean> => {
  try {
    const { data, error } = await adminClient.rpc('check_extraction_rate_limit_for_user', {
      p_user_id: userId,
      p_max_per_hour: MAX_EXTRACTIONS_PER_HOUR,
      p_max_per_day: MAX_EXTRACTIONS_PER_DAY,
    });
    if (error) {
      if (!isMissingRpcError(error, 'check_extraction_rate_limit_for_user')) return false;
      const { data: legacyData, error: legacyError } = await userClient.rpc('check_extraction_rate_limit', {
        p_max_per_hour: MAX_EXTRACTIONS_PER_HOUR,
        p_max_per_day: MAX_EXTRACTIONS_PER_DAY,
      });
      return !legacyError && legacyData === true;
    }
    return data === true;
  } catch {
    return false;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(req)) {
      return new Response('forbidden', { status: 403, headers: corsHeaders });
    }
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let adminSupabase: ReturnType<typeof createClient> | null = null;
  let currentUserId: string | null = null;
  let requestFilename = 'unknown';
  let remainingQuota = 0;
  let activeRepairRequest: RepairRequestPayload | null = null;

  try {
    if (!isAllowedOrigin(req)) {
      return new Response(JSON.stringify({ error: 'FORBIDDEN_ORIGIN' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // â”€â”€ AUTH VALIDATION â”€â”€
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: authHeader } },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    currentUserId = user.id;

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'SERVER_MISCONFIGURED' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    adminSupabase = createClient(Deno.env.get('SUPABASE_URL')!, SUPABASE_SERVICE_ROLE_KEY);

    // â”€â”€ PARSE PAYLOAD & VALIDATE EARLY â”€â”€
    const contentLength = Number(req.headers.get('content-length') || '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const payload = (body.payload || {}) as Record<string, unknown>;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;

    requestFilename = String(payload.filename || 'unknown').slice(0, 255);

    if (payloadBytes > MAX_PAYLOAD_BYTES) {
      return new Response(JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!payload.imagePart) {
      return new Response(JSON.stringify({ error: 'Missing imagePart in payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const imagePartError = getImagePartValidationError(payload.imagePart);
    if (imagePartError) {
      return new Response(JSON.stringify({ error: imagePartError }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessState = await checkExtractionAccess(supabase, adminSupabase!, currentUserId!);
    remainingQuota = accessState.remainingQuota;

    if (!accessState.hasAccess) {
      return new Response(
        JSON.stringify({
          error: 'PAID_PLAN_REQUIRED',
          message: 'Extraction reservee aux abonnes payants actifs.',
        }),
        {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (remainingQuota <= 0) {
      return new Response(
        JSON.stringify({
          error: 'EXTRACTION_QUOTA_EXCEEDED',
          message: 'Quota mensuel d\'extraction atteint.',
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // â”€â”€ RATE LIMITING (HOURLY CAP) â”€â”€
    const withinLimit = await checkExtractionRateLimit(supabase, adminSupabase!, currentUserId!);
    if (!withinLimit) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Trop d\'extractions cette heure. R\u00E9essayez plus tard.',
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // â”€â”€ EXTRACT WITH SMART FALLBACK â”€â”€
    const repairRequest = parseRepairRequest(payload.repairRequest);
    activeRepairRequest = repairRequest;

    let result: ExtractionRunResult;

    const runExtraction = () =>
      repairRequest
        ? extractWithRepairV2(payload, repairRequest)
        : extractWithFallbackV2(payload);

    try {
      result = await runExtraction();
    } catch (firstErr) {
      const firstMsg = String(firstErr);
      const isRetryable = firstMsg.includes('timeout') || firstMsg.includes('429') || firstMsg.includes('503');
      if (!isRetryable) {
        await safeLogExtractionFailure(
          adminSupabase, currentUserId, requestFilename,
          remainingQuota, 'failed_ai', activeRepairRequest,
        );
        return new Response(
          JSON.stringify({ error: 'AI extraction failed', details: firstMsg, retryable: false }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      // Single retry with back-off for transient errors
      try {
        await new Promise((r) => setTimeout(r, 2000));
        result = await runExtraction();
        result.meta.strategy = `${result.meta.strategy}+retried`;
      } catch (retryErr) {
        const retryMsg = String(retryErr);
        await safeLogExtractionFailure(
          adminSupabase, currentUserId, requestFilename,
          remainingQuota, 'failed_ai', activeRepairRequest,
        );
        return new Response(
          JSON.stringify({ error: 'AI extraction failed', details: retryMsg, retryable: true }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    const parsedResult = safeJsonParse(result.text);
    if (parsedResult) {
      result.text = JSON.stringify(sanitizeExtractionResult(parsedResult));
    }

    // â”€â”€ LOG EXTRACTION (with strategy tracking) â”€â”€
    try {
      const tokenEstimate = result.text ? Math.ceil(result.text.length / 4) : 0;
      const remainingQuotaAfter = Math.max(0, remainingQuota - 1);
      await adminSupabase.from('extraction_log').insert({
        user_id: currentUserId,
        filename: requestFilename,
        status: 'completed',
        token_estimate: tokenEstimate,
        remaining_quota: remainingQuotaAfter,
        strategy: result.meta.strategy,
        api_calls: result.meta.apiCalls,
        repair_mode: repairRequest ? 'targeted' : 'none',
        repair_targets_count: repairRequest?.focusSubtests.length || 0,
        metadata: {
          confidence_score: result.meta.confidenceScore ?? null,
          inventory_column_count: result.meta.inventoryColumnCount ?? null,
          missing_columns_count: (result.meta.missingSourceColumns || []).length,
          uncertainty_flags: result.meta.uncertaintyFlags ?? null,
          repaired_subtests: result.meta.repairedSubtests ?? null,
        },
      });
    } catch (_logErr) {
      // Non-blocking
    }

    return new Response(JSON.stringify({
      text: result.text,
      meta: result.meta,
      remainingQuota: Math.max(0, remainingQuota - 1),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    await captureEdgeException(_err, {
      functionName: 'extract-norms',
      extra: {
        userId: currentUserId,
        filename: requestFilename,
      },
    });
    await safeLogExtractionFailure(
      adminSupabase,
      currentUserId,
      requestFilename,
      remainingQuota,
      'failed_internal',
      activeRepairRequest,
    );
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
