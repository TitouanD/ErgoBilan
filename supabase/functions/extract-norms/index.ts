import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureEdgeException } from "../_shared/sentry.ts";
import {
  chunkInventoryColumns,
  compareVerificationResults,
  decideExtractionRouting,
  matchRepairColumns,
  sortTablesByInventoryOrder,
  summarizeInventoryCompleteness,
  type InventoryColumnDescriptor,
  type InventoryScanResult,
  type VerificationMismatch as ExtractionVerificationMismatch,
  type VerificationScanResult,
} from "./extractionUtils.ts";

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = parsePositiveInt(Deno.env.get("GEMINI_TIMEOUT_MS"), 40_000); // Keep each AI call bounded to avoid edge hard timeout (~150s)
const MAX_EXTRACTIONS_PER_HOUR = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_PER_HOUR"), 20);
const MAX_EXTRACTIONS_PER_DAY = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_PER_DAY"), 60);
const GEMINI_MAX_RETRIES = parsePositiveInt(Deno.env.get("GEMINI_MAX_RETRIES"), 1);
const GEMINI_RETRY_BASE_MS = parsePositiveInt(Deno.env.get("GEMINI_RETRY_BASE_MS"), 2_000);
const MAX_OUTPUT_TOKENS = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_OUTPUT_TOKENS"), 65536);
const PRECHECK_COLUMN_THRESHOLD = parsePositiveInt(
  Deno.env.get("EXTRACTION_PRECHECK_COLUMN_THRESHOLD") ?? Deno.env.get("EXTRACTION_CHUNKED_SUBTEST_THRESHOLD"),
  8,
); // Inventory precheck threshold: route dense LOOKUP pages directly to chunked extraction
const MAX_SUBTESTS_PER_CHUNK = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_SUBTESTS_PER_CHUNK"), 10); // Max subtests per focused extraction call
const CHUNK_MIN_COVERAGE_PERCENT = parsePositiveInt(Deno.env.get("EXTRACTION_CHUNK_MIN_COVERAGE_PERCENT"), 40);
const CHUNK_MIN_COLUMN_COVERAGE_RATIO = Math.min(1, Math.max(0.1, CHUNK_MIN_COVERAGE_PERCENT / 100));
const MAX_VERIFICATION_REPAIR_TARGETS = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_VERIFICATION_REPAIR_TARGETS"), 20);
const MAX_COLUMNS_FOR_SYNC_VERIFICATION = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_COLUMNS_FOR_SYNC_VERIFICATION"), 28);
const ENABLE_VERIFICATION_PASS = Deno.env.get("EXTRACTION_ENABLE_VERIFICATION") !== 'false'; // Lightweight verification after extraction
const THINKING_BUDGET = parsePositiveInt(Deno.env.get("EXTRACTION_THINKING_BUDGET"), 2048); // Gemini thinking tokens
const MAX_PAYLOAD_BYTES = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_PAYLOAD_BYTES"), 10_000_000);
const MAX_IMAGE_PART_BYTES = parsePositiveInt(Deno.env.get("EXTRACTION_MAX_IMAGE_BYTES"), 8_000_000);

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

// ── TYPES ──────────────────────────────────────────────────────────────────

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

// Gemini now returns compact keys (sid, tc, st) to save output tokens.
// Internal types use the compact form since they process Gemini output directly.
interface ExtractedTable {
  sid: string;           // subtest_id
  ab?: string;           // source_abbreviation (original column header from image)
  rows: Record<string, unknown>[];
}

interface ExtractionResult {
  tc?: string;           // test_context
  st?: string;           // structure_type
  pa0?: number | null;   // page_age_min_months
  pa1?: number | null;   // page_age_max_months
  tables?: ExtractedTable[];
}

interface LegacyInventoryDomain {
  domain: string;
  subtests: string[];
}

interface InventoryResult extends InventoryScanResult {
  domains?: LegacyInventoryDomain[];
}

interface RepairFocusSubtest {
  name: string;
  abbreviation?: string | null;
  domain?: string | null;
  columnOrder?: number | null;
  isInverted?: boolean | null;
}

interface RepairExpectedGroupCount {
  groupLabel: string;
  expectedCount: number;
}

interface RepairRequestPayload {
  focusSubtests: RepairFocusSubtest[];
  expectedGroupCounts: RepairExpectedGroupCount[];
  includeNeighborColumns: boolean;
  existingSubtests: string[];
  dominantAgeMin?: number | null;
  dominantAgeMax?: number | null;
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
  verificationMismatchColumns?: string[];
  adjacentDuplicateColumns?: string[];
  inventoryCoverageRatio?: number;
}

interface ExtractionMeta {
  strategy: string;
  apiCalls: number;
  repairedSubtests?: string[];
  inventoryMode?: InventoryMode;
  verified?: boolean;
  verificationRepairs?: number;
  verifiedSubtests?: string[];
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

type VerificationResult = VerificationScanResult;
type VerificationMismatch = ExtractionVerificationMismatch;

// ── RETRY UTILITY ──────────────────────────────────────────────────────────

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

// ── GEMINI CALL HELPER ─────────────────────────────────────────────────────
// Single place for calling Gemini with retry, timeout, and abort handling

const callGemini = async (
  contents: unknown[],
  responseMimeType: string = 'application/json'
): Promise<{ text: string | null; finishReason: string }> => {
  const geminiBody = {
    contents,
    generationConfig: {
      responseMimeType,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET },
    },
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

  return { text, finishReason };
};

// ── SHARED PROMPT BLOCKS ───────────────────────────────────────────────────

const buildKnownNamesBlock = (knownSubtestNames: string[]): string => {
  if (!knownSubtestNames || knownSubtestNames.length === 0) return '';
  return `
--- KNOWN SUBTESTS FROM PREVIOUS PAGES ---
The following subtest names have already been extracted from earlier pages of the SAME test manual.
YOU MUST REUSE these exact names when you encounter the same subtests on this page (even if the table header phrasing differs slightly).
Known names: ${JSON.stringify(knownSubtestNames)}
Only create a NEW subtest name if the subtest is genuinely different from all of the above.
`;
};

const buildScoreTypeHintBlock = (scoreTypeHint: string | undefined): string => {
  if (!scoreTypeHint) return '';
  const descriptions: Record<string, string> = {
    scaled: 'Scaled scores (NS/Note Standard), range 1-19, mean 10, SD 3.',
    standard: 'Standard scores (QI/Score Standard), range 40-160, mean 100, SD 15.',
    percentile: 'Percentile ranks, range 0-100.',
    't-score': 'T-scores, range 20-80, mean 50, SD 10.',
    stanine: 'Stanine scores, range 1-9, mean 5, SD 2.',
    sten: 'Sten scores, range 1-10, mean 5.5, SD 2.',
  };
  const desc = descriptions[scoreTypeHint] ?? scoreTypeHint;
  return `
--- SCORE TYPE HINT ---
The subtests in this test are expected to use: ${scoreTypeHint.toUpperCase()} (${desc})
Use this to validate your classification. If the column values match this range, classify accordingly.
Do NOT override this hint unless the data clearly contradicts it (e.g. values far outside the expected range).
`;
};

const buildCanonicalNamesBlock = (canonicalSubtestNames: string[]): string => {
  if (!canonicalSubtestNames || canonicalSubtestNames.length === 0) return '';
  return `
--- EXPECTED SUBTESTS (CANONICAL NAMES) ---
The user has identified this image as belonging to a known test. The canonical subtest names for this test are:
${JSON.stringify(canonicalSubtestNames)}
Use your clinical knowledge to resolve abbreviations to the full French clinical name.
If a column clearly matches one of the canonical names above, use that EXACT canonical name as the "sid" value.

CRITICAL - UNIQUE NAMING PROCEDURE BY STRUCTURE:
For PARAMETRIC tables:
- Do NOT create one sid per statistical column.
- "Moyenne"/"ET"/"SD" are value columns, not subtests.
- Keep one sid per clinical subtest only.
For LOOKUP tables:
- Read every data column header abbreviation.
- Keep one unique sid per lookup column variant and store the source abbreviation in "ab".
- If two columns would collide to the same sid, add a qualifier or fallback to abbreviation.
`;
};

const normalizePromptToken = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeInventoryToken = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

const SCORE_SCALE_TOKENS = new Set([
  'NS',
  'NOTESTANDARD',
  'NOTESTANDARDS',
  'NOTEETALONNEE',
  'NOTEETALONNEES',
  'SCORESTANDARD',
  'SCORESSTANDARD',
  'STANDARDSCORE',
  'SCALEDSCORE',
]);

const isLikelyScoreScaleColumn = (sid: string, ab: string): boolean => {
  const sidToken = normalizeInventoryToken(sid);
  const abToken = normalizeInventoryToken(ab);
  if (!sidToken && !abToken) return false;

  if (SCORE_SCALE_TOKENS.has(sidToken)) return true;
  if (sidToken.startsWith('NOTEETALONNEE') || sidToken.startsWith('NOTESTANDARD') || sidToken.startsWith('SCORESTANDARD')) {
    return true;
  }

  if ((abToken === 'NS' || SCORE_SCALE_TOKENS.has(abToken)) && (sidToken === 'NS' || sidToken.includes('NOTE') || sidToken.includes('SCORE'))) {
    return true;
  }

  return false;
};

const parseRepairRequest = (raw: unknown): RepairRequestPayload | null => {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;

  const focusSubtests = Array.isArray(input.focusSubtests)
    ? input.focusSubtests
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const value = entry as Record<string, unknown>;
        const name = normalizePromptToken(value.name);
        const abbreviation = normalizePromptToken(value.abbreviation);
        const domain = normalizePromptToken(value.domain);
        const columnOrderRaw = Number(value.columnOrder);
        const columnOrder = Number.isFinite(columnOrderRaw) ? Math.trunc(columnOrderRaw) : null;
        if (!name) return null;
        return {
          name,
          abbreviation: abbreviation || null,
          domain: domain || null,
          columnOrder,
          isInverted: value.isInverted === true,
        } as RepairFocusSubtest;
      })
      .filter((entry): entry is RepairFocusSubtest => !!entry)
    : [];

  if (focusSubtests.length === 0) return null;

  const expectedGroupCounts = Array.isArray(input.expectedGroupCounts)
    ? input.expectedGroupCounts
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const value = entry as Record<string, unknown>;
        const groupLabel = normalizePromptToken(value.groupLabel);
        const expectedRaw = Number(value.expectedCount);
        const expectedCount = Number.isFinite(expectedRaw) ? Math.trunc(expectedRaw) : NaN;
        if (!groupLabel || !Number.isFinite(expectedCount) || expectedCount <= 0) return null;
        return { groupLabel, expectedCount } as RepairExpectedGroupCount;
      })
      .filter((entry): entry is RepairExpectedGroupCount => !!entry)
    : [];

  const existingSubtests = Array.isArray(input.existingSubtests)
    ? input.existingSubtests
      .map((name) => normalizePromptToken(name))
      .filter((name) => !!name)
    : [];

  const dominantAgeMinRaw = Number(input.dominantAgeMin);
  const dominantAgeMaxRaw = Number(input.dominantAgeMax);
  const dominantAgeMin = Number.isFinite(dominantAgeMinRaw) ? Math.trunc(dominantAgeMinRaw) : null;
  const dominantAgeMax = Number.isFinite(dominantAgeMaxRaw) ? Math.trunc(dominantAgeMaxRaw) : null;

  return {
    focusSubtests,
    expectedGroupCounts,
    includeNeighborColumns: input.includeNeighborColumns === true,
    existingSubtests,
    dominantAgeMin,
    dominantAgeMax,
  };
};

const EXTRACTION_RULES = `
--- STEP 1: CLASSIFICATION (st) ---
A) "PARAMETRIC": Contains statistical constants per group (Mean/Moyenne/M AND SD/Ecart-Type/Sigma).
   The table does NOT map raw scores to percentiles directly. It gives the formula constants.
   PARAMETRIC HARD RULE: Statistical headers (Moyenne, M, ET, SD, Sigma, N, Nombre de sujets, %) are VALUES or METADATA, never subtest names (sid).
   PARAMETRIC HARD RULE: If you see statistical headers, you MUST look at the table title or surrounding context to find the CLINICAL subtest name (e.g. "Automatisation de la frappe").
B) "LOOKUP": Maps Raw Scores (ranges or single values) to Standard Scores (NS, Scaled) or Percentiles.

--- STEP 2: EXTRACTION RULES ---
1. PIVOT: If columns represent Ages/Grades and rows represent Stats (M, SD), YOU MUST PIVOT. Create ONE object per Age/Grade.
2. INVERTED / TRANSPOSED LOOKUP: Some LOOKUP tables are printed TRANSPOSED — ROWS = standard/scaled scores (e.g. NS 1-19 or "Note Standard" column on the left) and COLUMNS = subtests (or age groups).
   Detection: if the leftmost column header is "NS", "Note Standard", "Note Étalonnée", or a descending/ascending sequence of integers (1-19), the table IS inverted.
   The cell value is the raw score (single value or range). You MUST output one "sid" table entry per DATA COLUMN, with:
   - "r" = cell value (the raw score read from the cell)
   - "n" = row header (the NS/standard score from the left column)
  - One row object per visible cell in that column.
  - IMPORTANT: Cells containing "-", "–", "—" or ":" are NOT empty placeholders. They indicate "not scorable" and MUST be output as r:"-" with the corresponding n.
   CRITICAL FOR INVERTED TABLES: Read each column independently, top to bottom. Do NOT confuse adjacent columns. Mentally trace a vertical line from the column header down to each cell to verify horizontal alignment.
3. VALUES:
   - If Parametric: Extract "m" and "s".
   - If Parametric and a row/column has a class label (e.g. CE1, 6e, 2nde), also output "gl" with that original label.
   - If Lookup: Extract "r", "n", "p".
4. ACCURACY:
   - Clean units (sec, pts).
   - Keep decimals.
   - For LOOKUP, keep raw score ranges as strings (e.g. "0-5").
4b. DENSE TABLE READING STRATEGY (CRITICAL for tables with more than 8 data columns):
   - Read the table COLUMN BY COLUMN, not row by row.
  - For each column: (a) identify the column header/abbreviation, (b) scan every row from top to bottom, (c) record each visible cell with its row header (the NS/score from the leftmost column).
  - Dash-like cells ("-", "–", "—", ":") count as visible cells and must be extracted as r:"-".
  - After extracting each column, VERIFY the count of extracted values matches the number of visible cells in that column.
   - Common error on dense tables: reading a neighboring column's value instead of the target column. To prevent this, mentally trace a strict vertical line from the column header down to each cell.
   - The LAST columns (rightmost) are just as important as the first. Do NOT stop reading early.
5. SUBTEST NAMING (CRITICAL):
   - NEVER use abbreviated column headers as subtest names (e.g. "AA", "FD", "MV", "ST", "IP", "CF", "MD", "DT").
   - You MUST expand every abbreviation to its FULL FRENCH clinical name.
   - If EXPECTED SUBTESTS are provided above, match to those canonical names.
   - Use the test name (visible in the title or header), the domain section headers, and your clinical knowledge of standardized tests to determine the full subtest name.
   - The image always contains enough context: test title, domain groupings, and column abbreviations — combine them to resolve the full name.
   - Do NOT use English code-style names — use the French clinical name instead.
   - Do NOT add age, grade, or side qualifiers in the subtest name.
   - If a known subtest name from previous pages matches what you see, use it EXACTLY.
   - When you genuinely cannot determine the full name, use the abbreviation followed by the domain in parentheses (e.g. "DR (Langage)") as a last resort.
   - DISAMBIGUATION POLICY BY STRUCTURE:
     PARAMETRIC:
       - Statistical headers ("Moyenne", "M", "ET", "SD", "Sigma", "N", "Nombre de sujets") are strictly mapped to row values (m, s) or ignored (N). They MUST NOT appear in "sid".
       - One clinical subtest = ONE sid. If a table only has stat headers, derive the sid from the table title/text above.
       - Do not output separate sid entries such as "Copie (ET)" or "Copie (MOYENNE)".
       - Each sid must represent the clinical subtest only (e.g. "Copie", "Dictée", "Répétition", "Automatisation de la frappe").
     LOOKUP:
       - ABSOLUTE RULE: each data column on the page = 1 unique sid.
       - PRE-WRITING COLUMN COUNT (MANDATORY): count the exact number of data columns before output. "tables" must match that count exactly.
       - Store the ORIGINAL abbreviation in "ab" for each table entry.
       - If two columns would collide to the same sid name, keep unique names using qualifier or abbreviation fallback.
6. GROUPING:
   - For LOOKUP: Each "sid" entry groups all rows for ONE subtest. If the page covers a single age group (visible in the header), ALL rows under that subtest share the same a0/a1.
   - For PARAMETRIC: Each "sid" entry groups all age/grade rows for ONE subtest.
   COMPLETENESS CHECK (LOOKUP):
  - For inverted/transposed LOOKUP tables with NS rows (1-19 or similar), each subtest column should produce up to 19 rows.
  - If a cell is a dash-like token ("-", "–", "—", ":"), output r:"-" for that NS row (do NOT skip it).
  - Skip only truly blank/absent cells where no glyph is visible.
   - If you extracted significantly fewer rows for one column than for its neighbors, re-scan that column before finalizing.
   - The highest raw score for a subtest is typically at the highest NS (e.g. NS 19). Verify you did not stop reading a column early or confuse it with an adjacent column.
   - After generating the full output, do a final spot-check: compare the LAST two columns' max raw scores with what you see in the image. If they differ, re-read those columns.

--- STEP 3: NORMALIZATION RULES (CRITICAL FOR DATABASE) ---
You must calculate specific numeric values for the database:
1. AGE NORMALIZATION (a0, a1):
   - Convert label "4;6" or "4 ans 6 mois" -> 54 months.
   - Convert range "4;0 - 4;5" -> a0: 48, a1: 53.
   - If only grade is available, convert grade to age range in months using school mapping.
   - Primary grades: CP=72-83, CE1=84-95, CE2=96-107, CM1=108-119, CM2=120-131.
   - Secondary grades: 6e=132-143, 5e=144-155, 4e=156-167, 3e=168-179, 2nde=180-191, 1ere=192-203, Terminale=204-215.
   - STRICT RULE: never interpolate missing school levels; if a class is absent in the source, keep it absent.
   - CRITICAL: labels like "6e", "4e", "2nde" are grade levels, NOT ages 6/4/2 years. Never map them to 72/48/24 months.
   - PAGE-LEVEL AGE: When the page title, header, column heading, OR FILENAME shows an age group (e.g. "Ages 10;6-10;11", or filename "10;6-10;11.jpg", "13ans.jpg", "CE1.png"), that SINGLE age group applies to EVERY row on the entire page. Set pa0/pa1 at the top level. You do NOT need to repeat a0/a1 on every row — omit a0/a1 from rows when pa0/pa1 is set.
   - FILENAME AGE: If the filename contains an age hint (e.g. "5ans6mois" = 66 months, "13ans" = 156 months, "CE1" = ~84 months, "10;6-10;11" = 126-131 months), use it for pa0/pa1 when no age is visible in the table headers.
   - For LOOKUP tables, age must NEVER be missing. Set it via pa0/pa1 (page-level) or a0/a1 (row-level for multi-age pages).
   - OUTPUT TOKEN OPTIMIZATION: Do NOT output a0/a1 on rows when pa0/pa1 is set at top level (client inherits automatically). Only output row-level a0/a1 when rows have DIFFERENT ages (e.g. PARAMETRIC tables with multiple age groups).
2. RAW SCORE FORMAT (r):
   - Keep raw scores as display strings in "r" (e.g. "15-16", "7", "<5", ">19").
   - Do NOT output r0 or r1 — the client parses raw bounds from "r" automatically.
`;

const JSON_SCHEMA = `
--- JSON OUTPUT SCHEMA (compact keys to save tokens) ---
{
  "tc": "string (Detected name of the test)",
  "st": "PARAMETRIC" | "LOOKUP",
  "pa0": number | null (page-level age_min in months — from the page header/title age group),
  "pa1": number | null (page-level age_max in months — from the page header/title age group),
  "tables": [
    {
      "sid": "string (Subtest name — FULL French clinical name, or raw abbreviation if expansion would duplicate)",
      "ab": "string (Original column abbreviation exactly as printed in the image, e.g. 'MF', 'MFDC')",
      "rows": [
        {
          "m": "string (Only if PARAMETRIC: Mean)",
          "s": "string (Only if PARAMETRIC: SD)",
          "r": "string (Only if LOOKUP: Raw Score as displayed, e.g. '0-3', '7', '<5')",
          "n": "string (Only if LOOKUP: Standard Score / Note Étalonnée)",
          "p": "string (Percentile if explicit)",
          "z": "string (Z-Score if explicit)",
          "gl": "string (Optional source class/grade label such as CE1, 6e, 2nde)",
          "a0": number (ONLY if rows have different ages — omit when pa0/pa1 covers all rows),
          "a1": number (ONLY if rows have different ages — omit when pa0/pa1 covers all rows)
        }
      ]
    }
  ]
}

KEY LEGEND: tc=test_context, st=structure_type, pa0=page_age_min_months, pa1=page_age_max_months, sid=subtest_id, ab=source_abbreviation, m=mean, s=sd, r=raw_range, n=standard, p=percentile, z=z_score, gl=group_label, a0=age_min_months, a1=age_max_months.
TOKEN SAVING: When pa0/pa1 is set, do NOT repeat a0/a1 on each row. Do NOT output r0/r1 — client computes them from "r".

OUTPUT RULES:
- Output valid JSON only.
- Do not use Markdown code blocks.
- Minify the JSON (no unnecessary whitespace).
- You MUST extract ALL subtests and ALL rows visible on the page. Do NOT stop early.
`;

// ── BUILD FULL EXTRACTION PROMPT ───────────────────────────────────────────

const buildFullExtractionTask = (payload: Record<string, unknown>) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
TASK: Analyze the image, CLASSIFY the table structure, then EXTRACT and NORMALIZE ALL data from ALL tables on this page.

CRITICAL: This page may contain MULTIPLE tables or sections (e.g. upper table + lower table). You MUST extract data from ALL of them, not just the first one.
${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

// ── BUILD INVENTORY SCAN PROMPT (lightweight — discovers subtests) ──────────

const buildInventoryScanTask = (payload: Record<string, unknown>) => {
  const filename = String(payload.filename || 'document');
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
${buildCanonicalNamesBlock(canonicalSubtestNames)}
TASK: List ALL subtest column headers visible on this page image, grouped by their domain/section header.

For each domain section visible (e.g. "Attention et fonctions exécutives", "Mémoire et apprentissage", etc.), list the subtests under it.

IMPORTANT: Do NOT use abbreviated column headers (e.g. "AA", "FD", "MV"). You MUST expand each abbreviation to its FULL FRENCH clinical subtest name using your knowledge of the test. For example: AA → "Attention auditive", FD → "Fluidité de dessins", ST → "Statue", etc.
If EXPECTED SUBTESTS are provided above, match abbreviations to those canonical names.

Also detect the table structure type:
- "PARAMETRIC" if the table contains Mean/SD statistical constants
- "LOOKUP" if it maps raw scores to standard scores or percentiles

JSON OUTPUT SCHEMA:
{
  "tc": "string (Name of the test, e.g. NEPSY-II)",
  "st": "PARAMETRIC" | "LOOKUP",
  "domains": [
    {
      "domain": "string (Domain section header)",
      "subtests": ["string (FULL French subtest name, NOT abbreviation)", ...]
    }
  ]
}

OUTPUT RULES:
- Output valid JSON only. No markdown.
- Include ALL column headers from ALL tables on the page.
- Be exhaustive — do not skip any section.
- NEVER use abbreviations as subtest names.`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

// ── BUILD FOCUSED EXTRACTION PROMPT (extracts specific subtests only) ──────

const buildFocusedExtractionTask = (
  payload: Record<string, unknown>,
  focusSubtests: string[],
  domainHint: string
) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
FOCUS CONSTRAINT: Extract data ONLY for these specific subtest columns: ${JSON.stringify(focusSubtests)}
These belong to the domain section: "${domainHint}".
IGNORE all other columns entirely. Only output data for the listed subtests.

TASK: Extract and normalize data for the specified subtests only.
${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

// ── BUILD REPAIR EXTRACTION PROMPT (single-call targeted repair) ────────────

const buildRepairExtractionTask = (
  payload: Record<string, unknown>,
  repairRequest: RepairRequestPayload
) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;

  const focusList = repairRequest.focusSubtests.map((entry) => ({
    sid: entry.name,
    ab: entry.abbreviation || null,
  }));
  const expectedCountsBlock = repairRequest.expectedGroupCounts.length > 0
    ? `EXPECTED ROW COUNTS PER AGE/GROUP (must be respected):
${repairRequest.expectedGroupCounts.map((entry) => `- "${entry.groupLabel}" => ${entry.expectedCount} rows per targeted subtest`).join('\n')}`
    : 'EXPECTED ROW COUNTS PER AGE/GROUP: not provided.';
  const existingSubtestsBlock = repairRequest.existingSubtests.length > 0
    ? `EXISTING SUBTESTS ALREADY PRESENT ON THIS PAGE (for name consistency only): ${JSON.stringify(repairRequest.existingSubtests)}`
    : '';
  const neighborColumnsRule = repairRequest.includeNeighborColumns
    ? 'If you detect clearly missing adjacent columns tied to the same domain block, include them as additional tables to recover omissions.'
    : 'Do NOT include any non-targeted column. Restrict output strictly to targeted subtests.';

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
REPAIR MODE: targeted re-extraction after quality issues.
TARGET SUBTESTS (extract these first, exhaustively): ${JSON.stringify(focusList)}
${expectedCountsBlock}
${existingSubtestsBlock}
${neighborColumnsRule}

MANDATORY REPAIR RULES:
- Extract ALL rows for each targeted subtest.
- Respect expected row counts when provided. If the page has one age group header, that count applies to that group.
- Keep one unique sid per physical source column variant and keep original abbreviation in "ab".
- Reuse known/canonical names when possible. Avoid creating duplicate aliases for the same target.
- Output valid JSON only.

${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

const sanitizeInventoryColumns = (columns: unknown): InventoryColumnDescriptor[] => {
  if (!Array.isArray(columns)) return [];

  const sanitized: Array<InventoryColumnDescriptor | null> = columns
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry as Record<string, unknown>;
      const sid = normalizePromptToken(value.sid);
      const ab = normalizePromptToken(value.ab);
      if (!sid || !ab) return null;
      if (isLikelyScoreScaleColumn(sid, ab)) return null;

      const domain = normalizePromptToken(value.domain);
      const columnOrderRaw = Number(value.columnOrder);
      const tableOrderRaw = Number(value.tableOrder);

      return {
        sid,
        ab,
        domain: domain || null,
        columnOrder: Number.isFinite(columnOrderRaw) ? Math.trunc(columnOrderRaw) : null,
        tableOrder: Number.isFinite(tableOrderRaw) ? Math.trunc(tableOrderRaw) : null,
        isInverted: value.isInverted === true,
      };
    });

  const nonNull = sanitized.filter((entry) => entry !== null) as InventoryColumnDescriptor[];

  return nonNull
    .sort((left, right) => {
      const leftTableOrder = Number.isFinite(Number(left.tableOrder)) ? Number(left.tableOrder) : 1;
      const rightTableOrder = Number.isFinite(Number(right.tableOrder)) ? Number(right.tableOrder) : 1;
      if (leftTableOrder !== rightTableOrder) return leftTableOrder - rightTableOrder;
      const leftColumnOrder = Number.isFinite(Number(left.columnOrder)) ? Number(left.columnOrder) : Number.MAX_SAFE_INTEGER;
      const rightColumnOrder = Number.isFinite(Number(right.columnOrder)) ? Number(right.columnOrder) : Number.MAX_SAFE_INTEGER;
      if (leftColumnOrder !== rightColumnOrder) return leftColumnOrder - rightColumnOrder;
      return `${left.sid}::${left.ab}`.localeCompare(`${right.sid}::${right.ab}`);
    });
};

const parseInventoryResult = (text: string | null): InventoryResult | null => {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      tc: typeof parsed.tc === 'string' ? parsed.tc : null,
      st: typeof parsed.st === 'string' ? parsed.st : null,
      isInverted: parsed.isInverted === true,
      columns: sanitizeInventoryColumns(parsed.columns),
    };
  } catch {
    return null;
  }
};

const buildInventoryScanTaskV2 = (payload: Record<string, unknown>) => {
  const filename = String(payload.filename || 'document');
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
${buildCanonicalNamesBlock(canonicalSubtestNames)}
TASK: Build a PHYSICAL COLUMN INVENTORY for this page before any extraction.

Inspect ALL tables or sections on the page and return every DATA COLUMN in physical left-to-right order.

For each physical data column, return:
- "sid": FULL French clinical subtest name
- "ab": original printed abbreviation exactly as visible in the image
- "domain": visible section/domain header above that column
- "tableOrder": 1-based order of the table block on the page (top table=1, next table=2, etc.)
- "columnOrder": 1-based left-to-right order inside that table block
- "isInverted": true if the table is inverted/transposed (leftmost column is NS / Note étalonnée / a 1-19 score scale)

IMPORTANT COLUMN FILTER:
- EXCLUDE the left score scale column itself (e.g. NS / Note etalonnee / Note standard).
- INCLUDE only true subtest data columns that contain raw-score cells.

Also detect the structure type:
- "PARAMETRIC" if the table contains Mean/SD statistical constants
- "LOOKUP" if it maps raw scores to standard scores or percentiles

OUTPUT JSON ONLY:
{
  "tc": "string",
  "st": "PARAMETRIC" | "LOOKUP",
  "isInverted": true | false,
  "columns": [
    {
      "sid": "string",
      "ab": "string",
      "domain": "string",
      "tableOrder": number,
      "columnOrder": number,
      "isInverted": true | false
    }
  ]
}

RULES:
- Include ALL data columns from ALL tables on the page.
- "columns" must follow physical order as printed in the image.
- NEVER use abbreviations as "sid".
- Do not stop early after the first domain or first table.
- If the page is LOOKUP, the inventory must include the rightmost columns too.`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

const buildFocusedExtractionTaskV2 = (
  payload: Record<string, unknown>,
  focusColumns: InventoryColumnDescriptor[],
  domainHint: string
) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;
  const serializedColumns = focusColumns.map((column) => ({
    sid: column.sid,
    ab: column.ab || null,
    domain: column.domain || null,
    tableOrder: column.tableOrder ?? null,
    columnOrder: column.columnOrder ?? null,
    isInverted: column.isInverted === true,
  }));

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
FOCUS CONSTRAINT: Extract data ONLY for these specific physical columns: ${JSON.stringify(serializedColumns)}
These belong to the domain section: "${domainHint}".
IGNORE all other columns entirely. Only output data for the listed columns.

CRITICAL FOR DENSE / INVERTED LOOKUP TABLES:
- Track the listed columns by their physical position, not only by name.
- Re-read the rightmost targeted columns before finalizing.
- Do NOT borrow values from adjacent columns unless the target list explicitly includes them.

TASK: Extract and normalize data for the specified columns only.
${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

const buildRepairExtractionTaskV2 = (
  payload: Record<string, unknown>,
  repairRequest: RepairRequestPayload
) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const canonicalSubtestNames = Array.isArray(payload.canonicalSubtestNames) ? payload.canonicalSubtestNames : [];
  const scoreTypeHint = typeof payload.scoreTypeHint === 'string' ? payload.scoreTypeHint : undefined;
  const imagePart = payload.imagePart;

  const focusList = repairRequest.focusSubtests.map((entry) => ({
    sid: entry.name,
    ab: entry.abbreviation || null,
    domain: entry.domain || null,
    columnOrder: entry.columnOrder ?? null,
    isInverted: entry.isInverted === true,
  }));
  const expectedCountsBlock = repairRequest.expectedGroupCounts.length > 0
    ? `EXPECTED ROW COUNTS PER AGE/GROUP (must be respected):
${repairRequest.expectedGroupCounts.map((entry) => `- "${entry.groupLabel}" => ${entry.expectedCount} rows per targeted subtest`).join('\n')}`
    : 'EXPECTED ROW COUNTS PER AGE/GROUP: not provided.';
  const existingSubtestsBlock = repairRequest.existingSubtests.length > 0
    ? `EXISTING SUBTESTS ALREADY PRESENT ON THIS PAGE (for name consistency only): ${JSON.stringify(repairRequest.existingSubtests)}`
    : '';
  const neighborColumnsRule = repairRequest.includeNeighborColumns
    ? 'If you detect clearly missing adjacent columns tied to the same domain block, include them as additional tables to recover omissions.'
    : 'Do NOT include any non-targeted column. Restrict output strictly to targeted subtests.';
  const dominantAgeRule =
    repairRequest.dominantAgeMin != null && repairRequest.dominantAgeMax != null
      ? `DOMINANT PAGE AGE CONSTRAINT: normalize this page to ${repairRequest.dominantAgeMin}-${repairRequest.dominantAgeMax} months. Do NOT drift to a neighboring age bucket.`
      : 'DOMINANT PAGE AGE CONSTRAINT: not provided.';

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}${buildScoreTypeHintBlock(scoreTypeHint)}
REPAIR MODE: targeted re-extraction after quality issues.
TARGET SUBTESTS (extract these first, exhaustively): ${JSON.stringify(focusList)}
${expectedCountsBlock}
${existingSubtestsBlock}
${neighborColumnsRule}
${dominantAgeRule}

MANDATORY REPAIR RULES:
- Extract ALL rows for each targeted subtest.
- Respect expected row counts when provided. If the page has one age group header, that count applies to that group.
- Keep one unique sid per physical source column variant and keep original abbreviation in "ab".
- Reuse known/canonical names when possible. Avoid creating duplicate aliases for the same target.
- Repair only the requested physical columns unless neighbor columns are explicitly allowed.
- On inverted tables, re-check the lowest NS and highest NS cells for every targeted column.
- Output valid JSON only.

${EXTRACTION_RULES}
${JSON_SCHEMA}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

const buildVerificationTaskV2 = (
  payload: Record<string, unknown>,
  columnsToVerify: InventoryColumnDescriptor[],
) => {
  const imagePart = payload.imagePart;
  const verifyList = columnsToVerify.map((column) => ({
    sid: column.sid,
    ab: column.ab || null,
    domain: column.domain || null,
    tableOrder: column.tableOrder ?? null,
    columnOrder: column.columnOrder ?? null,
    isInverted: column.isInverted === true,
  }));

  const prompt = `Verify the following physical columns independently in the image.
TARGET COLUMNS: ${JSON.stringify(verifyList)}

For EACH targeted column, report:
- sid
- ab
- domain
- columnOrder
- isInverted
- min_n (lowest standard/NS with data)
- max_n (highest standard/NS with data)
- min_r (raw at min_n)
- max_r (raw at max_n)
- count (number of visible cells, including dash-like placeholders "-", "–", "—", ":")

CRITICAL:
- Read each target column independently top-to-bottom.
- Do NOT confuse adjacent columns.
- For inverted tables, re-check the rightmost columns carefully.
- If a targeted column is missing or unreadable, still output an entry with sid/ab and count 0.

JSON only:
{"verify":[{"sid":"...","ab":"...","domain":"...","columnOrder":1,"isInverted":true,"min_n":1,"max_n":19,"min_r":"0-3","max_r":"44-46","count":19}]}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
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

// ── MERGE EXTRACTION RESULTS ───────────────────────────────────────────────

const normalizeStableKeyPart = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const buildInventoryColumnKeyLocal = (sid: unknown, ab: unknown): string => (
  `${normalizeStableKeyPart(sid)}::${normalizeStableKeyPart(ab || 'NOABBR')}`
);

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
  mismatches: VerificationMismatch[] = [],
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

  const verificationMismatchColumns = Array.from(new Set(
    mismatches
      .map((mismatch) => String(mismatch.ab || mismatch.sid || '').trim())
      .filter((value) => value.length > 0)
  ));

  const adjacentDuplicateColumns = Array.from(new Set(
    mismatches
      .filter((mismatch) => String(mismatch.reason || '').startsWith('adjacent_duplicate'))
      .map((mismatch) => String(mismatch.ab || mismatch.sid || '').trim())
      .filter((value) => value.length > 0)
  ));

  const coveredColumns = counts.filter((entry) => entry.rows > 0).length;
  const inventoryCoverageRatio = inventoryColumns.length > 0
    ? coveredColumns / inventoryColumns.length
    : undefined;

  const flags: ExtractionUncertaintyFlags = {};
  if (emptyExtractedColumns.length > 0) flags.emptyExtractedColumns = emptyExtractedColumns;
  if (lowCoverageColumns.length > 0) flags.lowCoverageColumns = lowCoverageColumns;
  if (verificationMismatchColumns.length > 0) flags.verificationMismatchColumns = verificationMismatchColumns;
  if (adjacentDuplicateColumns.length > 0) flags.adjacentDuplicateColumns = adjacentDuplicateColumns;
  if (typeof inventoryCoverageRatio === 'number') flags.inventoryCoverageRatio = inventoryCoverageRatio;

  return Object.keys(flags).length > 0 ? flags : undefined;
};

const computeConfidenceScore = (
  uncertaintyFlags: ExtractionUncertaintyFlags | undefined,
  mismatchCount: number,
  expectedColumnCount: number,
): number => {
  if (!Number.isFinite(expectedColumnCount) || expectedColumnCount <= 0) return 0.5;

  const coverage = uncertaintyFlags?.inventoryCoverageRatio ?? 1;
  const emptyCount = uncertaintyFlags?.emptyExtractedColumns?.length || 0;
  const lowCoverageCount = uncertaintyFlags?.lowCoverageColumns?.length || 0;
  const adjacentDuplicateCount = uncertaintyFlags?.adjacentDuplicateColumns?.length || 0;
  const mismatchRatio = mismatchCount / expectedColumnCount;
  const emptyRatio = emptyCount / expectedColumnCount;
  const lowCoverageRatio = lowCoverageCount / expectedColumnCount;
  const adjacentDuplicateRatio = adjacentDuplicateCount / expectedColumnCount;

  const score =
    coverage
    - (emptyRatio * 0.35)
    - (mismatchRatio * 0.45)
    - (lowCoverageRatio * 0.25)
    - (adjacentDuplicateRatio * 0.2);

  return clamp01(score);
};

const annotateExtractionQuality = (
  meta: ExtractionMeta,
  result: ExtractionResult | null,
  inventoryColumns: InventoryColumnDescriptor[],
  mismatches: VerificationMismatch[] = [],
) => {
  const uncertaintyFlags = computeUncertaintyFlags(result, inventoryColumns, mismatches);
  meta.uncertaintyFlags = uncertaintyFlags;
  meta.confidenceScore = computeConfidenceScore(uncertaintyFlags, mismatches.length, inventoryColumns.length);
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
    stableRowValue(row.n),
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

/** Parse the leading numeric value from a raw score string (e.g. "15-16" → 15, "<5" → 5, "7" → 7). */
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
      const tableKey = `${normalizeStableKeyPart(sid)}::${normalizeStableKeyPart(ab || 'NOABBR')}`;

      if (!tableMap.has(tableKey)) {
        tableMap.set(tableKey, {
          sid,
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

// ── SAFE JSON PARSE ────────────────────────────────────────────────────────

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

const normalizeAgeQualifierToken = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const AGE_QUALIFIER_AMBIGUOUS_PATTERNS = ['TEMPS', 'ITEM', 'ITEMS', 'ESSAI', 'ESSAIS', 'FOIS'];

const hasAmbiguousAgeQualifierContext = (token: string): boolean => (
  AGE_QUALIFIER_AMBIGUOUS_PATTERNS.some((pattern) => token.includes(pattern))
);

const isLikelyAgeQualifierToken = (value: unknown): boolean => {
  const token = normalizeAgeQualifierToken(value);
  if (!token) return false;

  const hasAmbiguousContext = hasAmbiguousAgeQualifierContext(token);

  if (((/\bAGES?\b|\bANS?\b|\bMOIS\b/.test(token) && /\d/.test(token)) || /\bTHROUGH\b/.test(token)) && !hasAmbiguousContext) {
    return true;
  }

  if (/\b(?:CP|CE1|CE2|CM1|CM2|6E|5E|4E|3E|2NDE|2DE|1ERE|1RE|TERMINALE|TLE)\b/.test(token)) {
    return true;
  }

  if ((/\d+\s*[;:.]\s*\d+/.test(token) || /\d+\s*[-–—]\s*\d+/.test(token)) && !hasAmbiguousContext) {
    return true;
  }

  return false;
};

const stripAgeQualifierFromSid = (sid: string): { sid: string; strippedQualifier?: string } => {
  const trimmed = sid.trim();
  if (!trimmed) return { sid: '' };

  const match = trimmed.match(/^(.*)\(([^()]{1,80})\)\s*$/u);
  if (!match) return { sid: trimmed };

  const qualifier = match[2].trim();
  if (!isLikelyAgeQualifierToken(qualifier)) return { sid: trimmed };

  const baseSid = match[1].trim();
  return {
    sid: baseSid || trimmed,
    strippedQualifier: qualifier,
  };
};

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

  const dashed = trimmed.match(/(?:[-–—:])\s*([A-Za-zÀ-ÿ.\s]+)\s*$/);
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

const sanitizeLookupExtraction = (result: ExtractionResult): ExtractionResult => {
  if (String(result.st || '').toUpperCase() !== 'LOOKUP' || !Array.isArray(result.tables)) {
    return result;
  }

  // Propagate page-level age to rows that are missing a0/a1
  const pa0 = typeof result.pa0 === 'number' && Number.isFinite(result.pa0) ? result.pa0 : null;
  const pa1 = typeof result.pa1 === 'number' && Number.isFinite(result.pa1) ? result.pa1 : null;

  const tableMap = new Map<string, { sid: string; ab?: string; rows: Map<string, Record<string, unknown>> }>();

  for (const table of result.tables) {
    const sidRaw = String(table?.sid || '').trim();
    if (!sidRaw || !Array.isArray(table?.rows)) continue;

    const normalizedSid = stripAgeQualifierFromSid(sidRaw).sid || sidRaw;
    if (!normalizedSid) continue;

    const abRaw = typeof table.ab === 'string' ? table.ab.trim() : '';
    const normalizedAb = isLikelyAgeQualifierToken(abRaw) ? '' : abRaw;
    const tableKey = `${normalizeStableKeyPart(normalizedSid)}::${normalizeStableKeyPart(normalizedAb || 'NOABBR')}`;

    if (!tableMap.has(tableKey)) {
      tableMap.set(tableKey, {
        sid: normalizedSid,
        ab: normalizedAb || undefined,
        rows: new Map<string, Record<string, unknown>>(),
      });
    }

    const accumulator = tableMap.get(tableKey)!;
    if (!accumulator.ab && normalizedAb) accumulator.ab = normalizedAb;

    for (const rawRow of table.rows) {
      if (!rawRow || typeof rawRow !== 'object') continue;
      const row = rawRow as Record<string, unknown>;
      // Fill in a0/a1 from pa0/pa1 if the row is missing them
      if (row.a0 == null && pa0 !== null) row.a0 = pa0;
      if (row.a1 == null && pa1 !== null) row.a1 = pa1;
      const rowKey = stableLookupRowKey(row);
      const existing = accumulator.rows.get(rowKey);
      if (!existing) {
        accumulator.rows.set(rowKey, { ...row });
      } else {
        accumulator.rows.set(rowKey, mergeStableRow(existing, row));
      }
    }
  }

  const sanitizedTables: ExtractedTable[] = Array.from(tableMap.values())
    .map((entry) => ({
      sid: entry.sid,
      ab: entry.ab,
      rows: sortStableRows(Array.from(entry.rows.values())),
    }))
    .filter((entry) => entry.rows.length > 0);

  return {
    ...result,
    tables: sanitizedTables,
  };
};

const sanitizeExtractionResult = (result: ExtractionResult): ExtractionResult => {
  const structure = String(result.st || '').toUpperCase();
  if (structure === 'PARAMETRIC') return sanitizeParametricExtraction(result);
  if (structure === 'LOOKUP') return sanitizeLookupExtraction(result);
  return result;
};

// ── VERIFICATION PASS ──────────────────────────────────────────────────────

const buildVerificationTask = (
  payload: Record<string, unknown>,
  subtestsToVerify: { sid: string; ab: string }[]
) => {
  const imagePart = payload.imagePart;
  const abList = subtestsToVerify.map((s) => s.ab).filter(Boolean);

  const prompt = `Verify each column abbreviation in the image. For EACH, report boundary values only.
Columns: ${JSON.stringify(abList)}
Per column: ab, min_n (lowest NS with data), max_n (highest NS with data), min_r (raw at min_n), max_r (raw at max_n), count (visible cells, including dash-like placeholders).
Treat "-", "–", "—" and ":" as visible data placeholders (count them and report min/max using the nearest numeric raw values when available).
Read each column independently top-to-bottom. Do NOT confuse adjacent columns.
JSON only, minified: {"verify":[{"ab":"XX","min_n":1,"min_r":"0-3","max_n":19,"max_r":"60-86","count":19},...]}`;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
  };
};

interface LegacyVerificationMismatch {
  sid: string;
  ab: string;
  reason: string;
}

const compareVerificationResultsLegacy = (
  extraction: ExtractionResult,
  verification: VerificationResult
): LegacyVerificationMismatch[] => {
  if (!verification?.verify || !Array.isArray(verification.verify)) return [];
  if (!extraction?.tables || !Array.isArray(extraction.tables)) return [];

  const mismatches: LegacyVerificationMismatch[] = [];
  const verifyMap = new Map<string, VerificationResult['verify'][number]>();
  for (const entry of verification.verify) {
    if (entry.ab) verifyMap.set(entry.ab.toUpperCase().trim(), entry);
  }

  for (const table of extraction.tables) {
    const ab = (table.ab || '').toUpperCase().trim();
    if (!ab) continue;
    const verified = verifyMap.get(ab);
    if (!verified) continue;
    const verifiedCount = Number.isFinite(Number(verified.count)) ? Number(verified.count) : null;
    const verifiedMaxN = Number.isFinite(Number(verified.max_n)) ? Number(verified.max_n) : null;

    const rows = table.rows || [];
    const extractedCount = rows.length;

    // Check row count mismatch (tolerance of 1)
    if (verifiedCount !== null && Math.abs(extractedCount - verifiedCount) > 1) {
      mismatches.push({
        sid: table.sid,
        ab: table.ab || ab,
        reason: `row_count: extracted=${extractedCount}, verified=${verifiedCount}`,
      });
      continue;
    }

    // Check max standard score (n) — find extracted max
    const extractedNValues = rows
      .map((r) => Number(r.n))
      .filter((n) => Number.isFinite(n));
    const extractedMaxN = extractedNValues.length > 0 ? Math.max(...extractedNValues) : null;

    if (extractedMaxN !== null && verifiedMaxN !== null && verifiedMaxN > 0 && Math.abs(extractedMaxN - verifiedMaxN) > 1) {
      mismatches.push({
        sid: table.sid,
        ab: table.ab || ab,
        reason: `max_standard: extracted=${extractedMaxN}, verified=${verifiedMaxN}`,
      });
      continue;
    }

    // Check max raw score at highest NS
    if (verified.max_r && extractedMaxN !== null) {
      const rowAtMaxN = rows.find((r) => Number(r.n) === extractedMaxN);
      const extractedMaxR = rowAtMaxN ? String(rowAtMaxN.r || '').trim() : '';
      const verifiedMaxR = String(verified.max_r).trim();
      if (extractedMaxR && verifiedMaxR && extractedMaxR !== verifiedMaxR) {
        mismatches.push({
          sid: table.sid,
          ab: table.ab || ab,
          reason: `max_raw: extracted="${extractedMaxR}", verified="${verifiedMaxR}"`,
        });
      }
    }
  }

  return mismatches;
};

// ── ORCHESTRATOR: Try single call, fallback to chunked ─────────────────────

const extractWithFallback = async (
  payload: Record<string, unknown>
): Promise<ExtractionRunResult> => {
  // ── PHASE 1: Try single full extraction ──
  const fullTask = buildFullExtractionTask(payload);
  const { text: fullText, finishReason } = await callGemini(fullTask.contents);

  const wasTruncated = finishReason === 'MAX_TOKENS' || finishReason === 'LENGTH';

  let baseResult: ExtractionRunResult;

  if (!wasTruncated && fullText) {
    // Single call succeeded without truncation — cheapest path
    baseResult = { text: fullText, meta: { strategy: 'single', apiCalls: 1 } };
  } else {
    // Parse what we got (may be partial)
    const partialResult = safeJsonParse(fullText);
    const extractedSubtestCount = partialResult?.tables?.length ?? 0;

    // If we got a reasonable number of subtests and no truncation signal, trust the result
    if (!wasTruncated && extractedSubtestCount >= 3) {
      baseResult = { text: fullText!, meta: { strategy: 'single', apiCalls: 1 } };
    } else {
      // ── PHASE 2: Inventory scan to discover all subtests ──
      const inventoryTask = buildInventoryScanTask(payload);
      const { text: inventoryText } = await callGemini(inventoryTask.contents);

      let inventory: InventoryResult | null = null;
      try {
        inventory = inventoryText ? JSON.parse(inventoryText) : null;
      } catch {
        inventory = null;
      }

      if (!inventory || !Array.isArray(inventory.domains) || inventory.domains.length === 0) {
        // Inventory failed — return the partial result from Phase 1 if we have anything
        if (!wasTruncated && fullText) {
          baseResult = { text: fullText, meta: { strategy: 'single-fallback', apiCalls: 2 } };
        } else {
          throw new Error('Both full extraction and inventory scan failed');
        }
      } else {
        const totalSubtests = inventory.domains.reduce((sum: number, d: LegacyInventoryDomain) => sum + d.subtests.length, 0);

        // If inventory shows few subtests, the single call should have been enough
        if (!wasTruncated && totalSubtests <= CHUNKED_SUBTEST_THRESHOLD && fullText) {
          baseResult = { text: fullText, meta: { strategy: 'single-verified', apiCalls: 2 } };
        } else {
          // ── PHASE 3: Chunked extraction by domain ──
          const chunks: { subtests: string[]; domainHint: string }[] = [];
          let currentChunk: string[] = [];
          let currentDomainHints: string[] = [];

          for (const domain of inventory.domains) {
            if (currentChunk.length + domain.subtests.length > MAX_SUBTESTS_PER_CHUNK && currentChunk.length > 0) {
              chunks.push({ subtests: [...currentChunk], domainHint: currentDomainHints.join(' + ') });
              currentChunk = [];
              currentDomainHints = [];
            }
            currentChunk.push(...domain.subtests);
            currentDomainHints.push(domain.domain);
          }
          if (currentChunk.length > 0) {
            chunks.push({ subtests: currentChunk, domainHint: currentDomainHints.join(' + ') });
          }

          // Execute chunk extractions in parallel
          const chunkResults = await Promise.all(
            chunks.map(async (chunk) => {
              const task = buildFocusedExtractionTask(payload, chunk.subtests, chunk.domainHint);
              const { text: chunkText } = await callGemini(task.contents);
              return safeJsonParse(chunkText);
            })
          );

          const allResults: ExtractionResult[] = chunkResults.filter(Boolean) as ExtractionResult[];
          if (partialResult && (partialResult.tables?.length ?? 0) > 0) {
            allResults.push(partialResult);
          }

          const merged = mergeExtractionResultsStable(allResults);
          baseResult = {
            text: JSON.stringify(merged),
            meta: {
              strategy: `chunked-${chunks.length}`,
              apiCalls: 2 + chunks.length,
            },
          };
        }
      }
    }
  }

  // ── PHASE 4: Verification pass (optional, LOOKUP only) ──
  if (!ENABLE_VERIFICATION_PASS) {
    return baseResult;
  }

  const parsed = safeJsonParse(baseResult.text);
  if (!parsed || String(parsed.st || '').toUpperCase() !== 'LOOKUP' || !Array.isArray(parsed.tables) || parsed.tables.length < 2) {
    return baseResult;
  }

  // Build subtest list with abbreviations for verification
  const subtestsToVerify = parsed.tables
    .filter((t) => t.ab && t.rows && t.rows.length > 0)
    .map((t) => ({ sid: t.sid, ab: t.ab! }));

  if (subtestsToVerify.length < 2) {
    return baseResult;
  }

  try {
    const verifyTask = buildVerificationTask(payload, subtestsToVerify);
    const { text: verifyText } = await callGemini(verifyTask.contents);
    baseResult.meta.apiCalls += 1;

    let verifyResult: VerificationResult | null = null;
    try {
      verifyResult = verifyText ? JSON.parse(verifyText) : null;
    } catch {
      verifyResult = null;
    }

    if (!verifyResult || !Array.isArray(verifyResult.verify)) {
      baseResult.meta.verified = false;
      return baseResult;
    }

    const mismatches = compareVerificationResultsLegacy(parsed, verifyResult);

    if (mismatches.length === 0) {
      baseResult.meta.verified = true;
      baseResult.meta.verificationRepairs = 0;
      return baseResult;
    }

    // Auto-repair mismatched subtests (up to 10 at once)
    const repairTargets = mismatches.slice(0, MAX_VERIFICATION_REPAIR_TARGETS);
    const repairRequest: RepairRequestPayload = {
      focusSubtests: repairTargets.map((m) => ({ name: m.sid, abbreviation: m.ab })),
      expectedGroupCounts: [],
      includeNeighborColumns: false,
      existingSubtests: parsed.tables.map((t) => t.sid),
    };

    const repairTask = buildRepairExtractionTask(payload, repairRequest);
    const { text: repairText } = await callGemini(repairTask.contents);
    baseResult.meta.apiCalls += 1;

    const repairedResult = safeJsonParse(repairText);
    if (repairedResult && Array.isArray(repairedResult.tables)) {
      // Merge repairs into the base extraction (repairs take priority)
      const merged = mergeExtractionResultsStable([parsed, repairedResult]);
      baseResult.text = JSON.stringify(merged);
    }

    baseResult.meta.verified = true;
    baseResult.meta.verificationRepairs = repairTargets.length;
    baseResult.meta.strategy += '+verified';
    return baseResult;
  } catch {
    // Verification failed — return base result without verification
    baseResult.meta.verified = false;
    return baseResult;
  }
};

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

const extractWithRepair = async (
  payload: Record<string, unknown>,
  repairRequest: RepairRequestPayload
): Promise<ExtractionRunResult> => {
  const task = buildRepairExtractionTask(payload, repairRequest);
  const { text } = await callGemini(task.contents);
  if (!text) {
    throw new Error('Repair extraction returned empty response');
  }

  const repairedSubtests = repairRequest.focusSubtests.map((entry) => entry.name);
  return {
    text,
    meta: {
      strategy: 'repair-focused',
      apiCalls: 1,
      repairedSubtests,
      inventoryMode: repairRequest.includeNeighborColumns ? 'conditional' : 'off',
    },
  };
};

const runChunkedInventoryExtraction = async (
  payload: Record<string, unknown>,
  inventory: InventoryResult,
): Promise<{ parsed: ExtractionResult; apiCalls: number; strategy: string }> => {
  const chunks = chunkInventoryColumns(inventory.columns, MAX_SUBTESTS_PER_CHUNK);
  if (chunks.length === 0) {
    throw new Error('Inventory scan did not return any extractable columns');
  }

  const runChunk = async (chunk: { columns: InventoryColumnDescriptor[]; domainHint: string }) => {
    const task = buildFocusedExtractionTaskV2(payload, chunk.columns, chunk.domainHint);
    const { text } = await callGemini(task.contents);
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
    chunks.map(async (chunk) => {
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
    const retried = await Promise.all(retryCandidates.map(async (entry) => runChunk(entry.chunk)));
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

const extractWithFallbackV2 = async (
  payload: Record<string, unknown>
): Promise<ExtractionRunResult> => {
  const inventoryTask = buildInventoryScanTaskV2(payload);
  const { text: inventoryText } = await callGemini(inventoryTask.contents);
  const inventory = parseInventoryResult(inventoryText);

  if (!inventory || !inventory.st) {
    const fullTask = buildFullExtractionTask(payload);
    const { text: fullText } = await callGemini(fullTask.contents);
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

  let parsed: ExtractionResult | null = null;
  if (routing.mode === 'lookup-chunked-verified' && inventory.columns.length > 0) {
    try {
      const chunked = await runChunkedInventoryExtraction(payload, inventory);
      parsed = chunked.parsed;
      baseMeta.apiCalls += chunked.apiCalls;
      baseMeta.strategy = chunked.strategy;
    } catch (chunkError) {
      // Dense lookup pages should avoid serial full recovery fallback to stay under edge timeout budget.
      if (inventory.columns.length > MAX_COLUMNS_FOR_SYNC_VERIFICATION) {
        throw chunkError;
      }
      const fullTask = buildFullExtractionTask(payload);
      const { text: recoveryText, finishReason: recoveryFinishReason } = await callGemini(fullTask.contents);
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
    const { text: fullText, finishReason } = await callGemini(fullTask.contents);
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
  const completeness = summarizeInventoryCompleteness(parsed, inventory.columns);
  baseMeta.expectedSourceColumns = completeness.expectedSourceColumns;
  baseMeta.missingSourceColumns = completeness.missingSourceColumns;
  baseMeta.expectedSourceColumnCount = completeness.expectedSourceColumnCount;
  annotateExtractionQuality(baseMeta, parsed, inventory.columns);
  let baseResult: ExtractionRunResult = {
    text: JSON.stringify(parsed),
    meta: baseMeta,
  };

  const isLookup = String(parsed.st || inventory.st || '').toUpperCase() === 'LOOKUP';
  const shouldVerifySynchronously =
    ENABLE_VERIFICATION_PASS
    && isLookup
    && inventory.columns.length > 0
    && inventory.columns.length <= MAX_COLUMNS_FOR_SYNC_VERIFICATION;

  if (!shouldVerifySynchronously) {
    if (ENABLE_VERIFICATION_PASS && isLookup && inventory.columns.length > MAX_COLUMNS_FOR_SYNC_VERIFICATION) {
      baseResult.meta.strategy = `${baseResult.meta.strategy}+verify-skipped-dense`;
      baseResult.meta.verified = false;
    }
    return baseResult;
  }

  const verifyTask = buildVerificationTaskV2(payload, inventory.columns);
  const { text: verifyText } = await callGemini(verifyTask.contents);
  baseResult.meta.apiCalls += 1;

  let verifyResult: VerificationResult | null = null;
  try {
    verifyResult = verifyText ? JSON.parse(verifyText) : null;
  } catch {
    verifyResult = null;
  }

  if (!verifyResult || !Array.isArray(verifyResult.verify)) {
    baseResult.meta.verified = false;
    if (typeof baseResult.meta.confidenceScore === 'number') {
      baseResult.meta.confidenceScore = clamp01(baseResult.meta.confidenceScore - 0.1);
    }
    return baseResult;
  }

  const mismatches = compareVerificationResults(parsed, verifyResult, inventory.columns);
  if (mismatches.length === 0) {
    baseResult.meta.verified = true;
    baseResult.meta.verificationRepairs = 0;
    baseResult.meta.verifiedSubtests = inventory.columns.map((column) => column.sid);
    annotateExtractionQuality(baseResult.meta, parsed, inventory.columns, []);
    return baseResult;
  }

  const repairTargets = mismatches.slice(0, MAX_VERIFICATION_REPAIR_TARGETS);
  const includeNeighborColumns =
    routing.mode === 'lookup-chunked-verified'
    || repairTargets.some((entry) =>
      entry.reason.startsWith('missing_') || entry.reason.startsWith('adjacent_duplicate'));

  const repairColumns = matchRepairColumns(
    inventory.columns,
    repairTargets.map((entry) => ({ sid: entry.sid, ab: entry.ab })),
    includeNeighborColumns,
  );

  if (repairColumns.length === 0) {
    baseResult.meta.verified = false;
    annotateExtractionQuality(baseResult.meta, parsed, inventory.columns, mismatches);
    return baseResult;
  }

  const repairRequest: RepairRequestPayload = {
    focusSubtests: repairColumns.map((column) => ({
      name: column.sid,
      abbreviation: column.ab || null,
      domain: column.domain || null,
      columnOrder: column.columnOrder ?? null,
      isInverted: column.isInverted === true,
    })),
    expectedGroupCounts: [],
    includeNeighborColumns,
    existingSubtests: parsed.tables?.map((table) => table.sid).filter(Boolean) || [],
    dominantAgeMin: parsed.pa0 ?? null,
    dominantAgeMax: parsed.pa1 ?? null,
  };

  const repairTask = buildRepairExtractionTaskV2(payload, repairRequest);
  const { text: repairText } = await callGemini(repairTask.contents);
  baseResult.meta.apiCalls += 1;
  const repairedResult = safeJsonParse(repairText);

  if (!repairedResult || !Array.isArray(repairedResult.tables)) {
    baseResult.meta.verified = false;
    annotateExtractionQuality(baseResult.meta, parsed, inventory.columns, mismatches);
    return baseResult;
  }

  const repairedMerged = applyInventoryOrdering(
    mergeExtractionResultsStable([parsed, repairedResult]),
    inventory.columns,
  );
  if (!repairedMerged) {
    baseResult.meta.verified = false;
    annotateExtractionQuality(baseResult.meta, parsed, inventory.columns, mismatches);
    return baseResult;
  }

  const reverifyTask = buildVerificationTaskV2(payload, repairColumns);
  const { text: reverifyText } = await callGemini(reverifyTask.contents);
  baseResult.meta.apiCalls += 1;
  let reverifyResult: VerificationResult | null = null;
  try {
    reverifyResult = reverifyText ? JSON.parse(reverifyText) : null;
  } catch {
    reverifyResult = null;
  }

  if (!reverifyResult || !Array.isArray(reverifyResult.verify)) {
    baseResult.meta.verified = false;
    annotateExtractionQuality(baseResult.meta, repairedMerged, inventory.columns, mismatches);
    if (typeof baseResult.meta.confidenceScore === 'number') {
      baseResult.meta.confidenceScore = clamp01(baseResult.meta.confidenceScore - 0.1);
    }
    return baseResult;
  }

  const reverifyMismatches = compareVerificationResults(repairedMerged, reverifyResult, repairColumns);
  if (reverifyMismatches.length > 0) {
    baseResult.meta.verified = false;
    annotateExtractionQuality(baseResult.meta, repairedMerged, inventory.columns, reverifyMismatches);
    return baseResult;
  }

  const finalMeta: ExtractionMeta = {
    ...baseResult.meta,
    strategy: `${baseMeta.strategy}+verified`,
    repairedSubtests: repairColumns.map((column) => column.sid),
    verified: true,
    verificationRepairs: repairColumns.length,
    verifiedSubtests: repairColumns.map((column) => column.sid),
  };
  annotateExtractionQuality(finalMeta, repairedMerged, inventory.columns, []);

  return {
    text: JSON.stringify(repairedMerged),
    meta: finalMeta,
  };
};

const extractWithRepairV2 = async (
  payload: Record<string, unknown>,
  repairRequest: RepairRequestPayload
): Promise<ExtractionRunResult> => {
  const inventoryTask = buildInventoryScanTaskV2(payload);
  const { text: inventoryText } = await callGemini(inventoryTask.contents);
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
  const { text } = await callGemini(repairTask.contents);
  if (!text) {
    throw new Error('Repair extraction returned empty response');
  }

  const parsed = safeJsonParse(text);
  if (!parsed) {
    throw new Error('Repair extraction returned invalid JSON');
  }

  const orderedParsed = applyInventoryOrdering(parsed, inventoryColumns) || parsed;
  const repairedSubtests = effectiveRepairRequest.focusSubtests.map((entry) => entry.name);
  const completeness = summarizeInventoryCompleteness(orderedParsed, inventoryColumns);
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
  annotateExtractionQuality(meta, orderedParsed, inventoryColumns);

  if (
    ENABLE_VERIFICATION_PASS
    && String(orderedParsed.st || inventory?.st || '').toUpperCase() === 'LOOKUP'
    && matchedColumns.length > 0
    && inventoryColumns.length <= MAX_COLUMNS_FOR_SYNC_VERIFICATION
  ) {
    const verifyTask = buildVerificationTaskV2(payload, matchedColumns);
    const { text: verifyText } = await callGemini(verifyTask.contents);
    meta.apiCalls += 1;

    let verifyResult: VerificationResult | null = null;
    try {
      verifyResult = verifyText ? JSON.parse(verifyText) : null;
    } catch {
      verifyResult = null;
    }

    if (verifyResult && Array.isArray(verifyResult.verify)) {
      const mismatches = compareVerificationResults(orderedParsed, verifyResult, matchedColumns);
      meta.verified = mismatches.length === 0;
      meta.verificationRepairs = mismatches.length === 0 ? matchedColumns.length : 0;
      if (mismatches.length === 0) {
        meta.verifiedSubtests = matchedColumns.map((column) => column.sid);
      }
      annotateExtractionQuality(meta, orderedParsed, inventoryColumns, mismatches);
    } else {
      meta.verified = false;
      if (typeof meta.confidenceScore === 'number') {
        meta.confidenceScore = clamp01(meta.confidenceScore - 0.1);
      }
    }
  } else if (
    ENABLE_VERIFICATION_PASS
    && String(orderedParsed.st || inventory?.st || '').toUpperCase() === 'LOOKUP'
    && inventoryColumns.length > MAX_COLUMNS_FOR_SYNC_VERIFICATION
  ) {
    meta.strategy = `${meta.strategy}+verify-skipped-dense`;
    meta.verified = false;
  }

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

const isValidImagePart = (imagePart: unknown): boolean => {
  return getImagePartValidationError(imagePart) === null;
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
    // ── AUTH VALIDATION ──
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

    // ── PARSE PAYLOAD & VALIDATE EARLY ──
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

    // ── RATE LIMITING (HOURLY CAP) ──
    const withinLimit = await checkExtractionRateLimit(supabase, adminSupabase!, currentUserId!);
    if (!withinLimit) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Trop d\'extractions cette heure. Réessayez plus tard.',
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

    // ── EXTRACT WITH SMART FALLBACK ──
    const repairRequest = parseRepairRequest(payload.repairRequest);
    activeRepairRequest = repairRequest;

    let result: ExtractionRunResult;

    try {
      if (repairRequest) {
        result = await extractWithRepairV2(payload, repairRequest);
      } else {
        result = await extractWithFallbackV2(payload);
      }
    } catch (err) {
      const errMsg = String(err);
      const retryable = errMsg.includes('timeout') || errMsg.includes('429') || errMsg.includes('503');
      await safeLogExtractionFailure(
        adminSupabase,
        currentUserId,
        requestFilename,
        remainingQuota,
        'failed_ai',
        activeRepairRequest,
      );
      return new Response(
        JSON.stringify({ error: 'AI extraction failed', details: errMsg, retryable }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const parsedResult = safeJsonParse(result.text);
    if (parsedResult) {
      result.text = JSON.stringify(sanitizeExtractionResult(parsedResult));
    }

    // ── LOG EXTRACTION (with strategy tracking) ──
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
