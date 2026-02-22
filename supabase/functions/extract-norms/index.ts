import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 180_000; // Allow extra time for chunked fallback
const MAX_EXTRACTIONS_PER_HOUR = Number(Deno.env.get("EXTRACTION_MAX_PER_HOUR") || "20");
const MAX_EXTRACTIONS_PER_DAY = Number(Deno.env.get("EXTRACTION_MAX_PER_DAY") || "60");
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2_000;
const MAX_OUTPUT_TOKENS = 65536;
const CHUNKED_SUBTEST_THRESHOLD = 8; // Trigger chunked fallback if inventory finds > N subtests

const APP_ENV = (Deno.env.get("APP_ENV") || Deno.env.get("ENV") || "").toLowerCase();
const IS_PRODUCTION = APP_ENV === "production" || APP_ENV === "prod" || !!Deno.env.get("DENO_DEPLOYMENT_ID");
const ALLOWED_ORIGINS = (Deno.env.get("AI_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryableStatus = (status: number) => status === 503 || status === 429;

const isAllowedOrigin = (req: Request): boolean => {
  const origin = (req.headers.get('origin') || '').trim();
  if (ALLOWED_ORIGINS.length > 0) return !!origin && ALLOWED_ORIGINS.includes(origin);
  return !IS_PRODUCTION;
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
  tables?: ExtractedTable[];
}

interface InventoryDomain {
  domain: string;
  subtests: string[];
}

interface InventoryResult {
  tc?: string;           // test_context
  st?: string;           // structure_type
  domains: InventoryDomain[];
}

interface RepairFocusSubtest {
  name: string;
  abbreviation?: string | null;
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
}

type InventoryMode = 'off' | 'conditional';

interface ExtractionMeta {
  strategy: string;
  apiCalls: number;
  repairedSubtests?: string[];
  inventoryMode?: InventoryMode;
}

interface ExtractionRunResult {
  text: string;
  meta: ExtractionMeta;
}

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
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const response = await retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        const res = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
      return msg.includes('timeout') || msg.includes('retryable');
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
          if (!name) return null;
          return {
            name,
            abbreviation: abbreviation || null,
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

  return {
    focusSubtests,
    expectedGroupCounts,
    includeNeighborColumns: input.includeNeighborColumns === true,
    existingSubtests,
  };
};

const EXTRACTION_RULES = `
--- STEP 1: CLASSIFICATION (st) ---
A) "PARAMETRIC": Contains statistical constants per group (Mean/Moyenne/M AND SD/Ecart-Type/Sigma).
   The table does NOT map raw scores to percentiles directly. It gives the formula constants.
   PARAMETRIC HARD RULE: "Moyenne"/"M"/"ET"/"SD"/"Sigma" are statistical columns, never subtests.
   PARAMETRIC HARD RULE: one valid row must contain both "m" and "s"; if one is missing, skip the row.
B) "LOOKUP": Maps Raw Scores (ranges or single values) to Standard Scores (NS, Scaled) or Percentiles.

--- STEP 2: EXTRACTION RULES ---
1. PIVOT: If columns represent Ages/Grades and rows represent Stats (M, SD), YOU MUST PIVOT. Create ONE object per Age/Grade.
2. INVERTED LOOKUP: Some LOOKUP tables are printed with ROWS = standard/scaled scores and COLUMNS = age groups.
   In that case, the cell value is the raw score. You MUST still output one object per age group (column) with "r" = cell value, "n" = row header.
3. VALUES:
   - If Parametric: Extract "m" and "s".
   - If Parametric and a row/column has a class label (e.g. CE1, 6e, 2nde), also output "gl" with that original label.
   - If Lookup: Extract "r", "n", "p".
4. ACCURACY:
   - Clean units (sec, pts).
   - Keep decimals.
   - For LOOKUP, keep raw score ranges as strings (e.g. "0-5").
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
       - Statistical headers ("Moyenne", "M", "ET", "SD", "Sigma") MUST stay inside row values, never in sid.
       - Do not output separate sid entries such as "Copie (ET)" or "Copie (MOYENNE)".
       - Each sid must represent the clinical subtest only (e.g. "Copie", "Dictée", "Répétition").
     LOOKUP:
       - ABSOLUTE RULE: each data column on the page = 1 unique sid.
       - PRE-WRITING COLUMN COUNT (MANDATORY): count the exact number of data columns before output. "tables" must match that count exactly.
       - Store the ORIGINAL abbreviation in "ab" for each table entry.
       - If two columns would collide to the same sid name, keep unique names using qualifier or abbreviation fallback.
6. GROUPING:
   - For LOOKUP: Each "sid" entry groups all rows for ONE subtest. If the page covers a single age group (visible in the header), ALL rows under that subtest share the same a0/a1.
   - For PARAMETRIC: Each "sid" entry groups all age/grade rows for ONE subtest.

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
   - PAGE-LEVEL AGE: When the page title, header, column heading, OR FILENAME shows an age group (e.g. "Ages 10;6-10;11", or filename "10;6-10;11.jpg", "13ans.jpg", "CE1.png"), that SINGLE age group applies to EVERY row on the entire page. You MUST propagate it to a0/a1 of ALL rows AND to pa0/pa1 at the top level. Example: "Ages 10;6-10;11" -> a0: 126, a1: 131 for every row.
   - FILENAME AGE: If the filename contains an age hint (e.g. "5ans6mois" = 66 months, "13ans" = 156 months, "CE1" = ~84 months, "10;6-10;11" = 126-131 months), use it for pa0/pa1 and a0/a1 when no age is visible in the table headers.
   - For LOOKUP tables, a0 and a1 must NEVER be null. The age is ALWAYS visible somewhere on the page (title, header, sub-header) or in the filename. Search for it and apply it.
2. RAW SCORE NORMALIZATION (r0, r1):
   - "15-16" -> r0: 15, r1: 16
   - "7" -> r0: 7, r1: 7
   - "<5" -> r0: 0, r1: 5
   - ">19" or "19+" -> r0: 19, r1: 999 (use a high number for infinity)
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
          "r": "string (Only if LOOKUP: Raw Score as displayed)",
          "n": "string (Only if LOOKUP: Standard Score / Note Étalonnée)",
          "p": "string (Percentile if explicit)",
          "z": "string (Z-Score if explicit)",
          "gl": "string (Optional source class/grade label such as CE1, 6e, 2nde)",
          "a0": number | null (age_min in months),
          "a1": number | null (age_max in months),
          "r0": number | null (raw_min),
          "r1": number | null (raw_max)
        }
      ]
    }
  ]
}

KEY LEGEND: tc=test_context, st=structure_type, pa0=page_age_min_months, pa1=page_age_max_months, sid=subtest_id, ab=source_abbreviation, m=mean, s=sd, r=raw_range, n=standard, p=percentile, z=z_score, gl=group_label, a0=age_min_months, a1=age_max_months, r0=raw_min, r1=raw_max.
CRITICAL: If the page shows a single age group in its header/title (e.g. "Ages 10;6-10;11"), you MUST set pa0 and pa1 at the top level AND copy them into every row's a0/a1.

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
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}
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
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png", "13ans.jpg", "10;6-10;11.jpg", "5ans6mois.png"). Use this to infer a0/a1 and pa0/pa1 when no age is visible in the table itself.
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}
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
${buildCanonicalNamesBlock(canonicalSubtestNames)}${buildKnownNamesBlock(knownSubtestNames)}
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

// ── MERGE EXTRACTION RESULTS ───────────────────────────────────────────────

const normalizeStableKeyPart = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const hasStableValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const stableRowScore = (row: Record<string, unknown>): number =>
  Object.values(row).reduce((score, value) => score + (hasStableValue(value) ? 1 : 0), 0);

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
    stableRowValue(row.r0),
    stableRowValue(row.r1),
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

const sortStableRows = (rows: Record<string, unknown>[]): Record<string, unknown>[] => {
  return [...rows].sort((a, b) => {
    const a0 = Number.isFinite(Number(a.a0)) ? Number(a.a0) : Number.MAX_SAFE_INTEGER;
    const b0 = Number.isFinite(Number(b.a0)) ? Number(b.a0) : Number.MAX_SAFE_INTEGER;
    if (a0 !== b0) return a0 - b0;
    const a1 = Number.isFinite(Number(a.a1)) ? Number(a.a1) : Number.MAX_SAFE_INTEGER;
    const b1 = Number.isFinite(Number(b.a1)) ? Number(b.a1) : Number.MAX_SAFE_INTEGER;
    if (a1 !== b1) return a1 - b1;
    const ar0 = Number.isFinite(Number(a.r0)) ? Number(a.r0) : Number.MAX_SAFE_INTEGER;
    const br0 = Number.isFinite(Number(b.r0)) ? Number(b.r0) : Number.MAX_SAFE_INTEGER;
    if (ar0 !== br0) return ar0 - br0;
    const ar1 = Number.isFinite(Number(a.r1)) ? Number(a.r1) : Number.MAX_SAFE_INTEGER;
    const br1 = Number.isFinite(Number(b.r1)) ? Number(b.r1) : Number.MAX_SAFE_INTEGER;
    if (ar1 !== br1) return ar1 - br1;
    return stableRowValue(a.r).localeCompare(stableRowValue(b.r));
  });
};

const mergeExtractionResultsStable = (results: ExtractionResult[]): ExtractionResult => {
  const merged: ExtractionResult = {
    tc: '',
    st: 'LOOKUP',
    tables: [],
  };

  const tableMap = new Map<string, { sid: string; ab?: string; rows: Map<string, Record<string, unknown>> }>();

  for (const result of results) {
    if (!result) continue;
    if (result.tc && !merged.tc) merged.tc = result.tc;
    if (result.st) merged.st = result.st;

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

const isLikelyAgeQualifierToken = (value: unknown): boolean => {
  const token = normalizeAgeQualifierToken(value);
  if (!token) return false;

  if ((/\bAGES?\b|\bANS?\b|\bMOIS\b/.test(token) && /\d/.test(token)) || /\bTHROUGH\b/.test(token)) {
    return true;
  }

  if (/\b(?:CP|CE1|CE2|CM1|CM2|6E|5E|4E|3E|2NDE|2DE|1ERE|1RE|TERMINALE|TLE)\b/.test(token)) {
    return true;
  }

  if (/\d+\s*[;:.]\s*\d+/.test(token) || /\d+\s*[-–—]\s*\d+/.test(token)) {
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

const sanitizeParametricExtraction = (result: ExtractionResult): ExtractionResult => {
  if (String(result.st || '').toUpperCase() !== 'PARAMETRIC' || !Array.isArray(result.tables)) {
    return result;
  }

  const tableMap = new Map<string, ParametricAccumulator>();

  for (const table of result.tables) {
    const sid = String(table?.sid || '').trim();
    if (!sid || !Array.isArray(table?.rows)) continue;

    const { baseSid, suffixToken } = splitStatSuffix(sid);
    const roleFromSuffix = detectStatRoleFromValue(suffixToken);
    const roleFromAb = detectStatRoleFromValue(table.ab);
    const role: StatRole = roleFromAb !== 'none' ? roleFromAb : roleFromSuffix;

    const outputSid = role !== 'none' && baseSid ? baseSid : sid;
    if (!outputSid) continue;

    const abRaw = typeof table.ab === 'string' ? table.ab.trim() : '';
    const isNonStatAb = !!abRaw && detectStatRoleFromValue(abRaw) === 'none';
    const tableKey = role === 'none' && isNonStatAb
      ? `${outputSid}::ab:${normalizeToken(abRaw)}`
      : outputSid;

    if (!tableMap.has(tableKey)) {
      tableMap.set(tableKey, {
        sid: outputSid,
        ab: role === 'none' && isNonStatAb ? abRaw : undefined,
        rows: new Map<string, MergedParametricRow>(),
      });
    }

    const accumulator = tableMap.get(tableKey)!;

    for (const rawRow of table.rows) {
      if (!rawRow || typeof rawRow !== 'object') continue;
      const row = rawRow as Record<string, unknown>;

      let meanVal = pickNumericString(row.m);
      let sdVal = pickNumericString(row.s);
      if (role === 'mean' && !meanVal) meanVal = pickNumericString(row.s);
      if (role === 'sd' && !sdVal) sdVal = pickNumericString(row.m);

      const mergedCandidate: MergedParametricRow = {
        a0: pickOptionalNumber(row.a0),
        a1: pickOptionalNumber(row.a1),
        gl: sanitizeGroupLabel(row.gl),
      };

      const rowKey = buildParametricRowKey(mergedCandidate);
      if (!accumulator.rows.has(rowKey)) {
        accumulator.rows.set(rowKey, { ...mergedCandidate });
      }

      const mergedRow = accumulator.rows.get(rowKey)!;
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

// ── ORCHESTRATOR: Try single call, fallback to chunked ─────────────────────

const extractWithFallback = async (
  payload: Record<string, unknown>
): Promise<ExtractionRunResult> => {
  // ── PHASE 1: Try single full extraction ──
  const fullTask = buildFullExtractionTask(payload);
  const { text: fullText, finishReason } = await callGemini(fullTask.contents);

  const wasTruncated = finishReason === 'MAX_TOKENS' || finishReason === 'LENGTH';

  if (!wasTruncated && fullText) {
    // Single call succeeded without truncation — cheapest path
    return { text: fullText, meta: { strategy: 'single', apiCalls: 1 } };
  }

  // Parse what we got (may be partial)
  const partialResult = safeJsonParse(fullText);
  const extractedSubtestCount = partialResult?.tables?.length ?? 0;

  // If we got a reasonable number of subtests and no truncation signal, trust the result
  if (!wasTruncated && extractedSubtestCount >= 3) {
    return { text: fullText!, meta: { strategy: 'single', apiCalls: 1 } };
  }

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
      return { text: fullText, meta: { strategy: 'single-fallback', apiCalls: 2 } };
    }
    throw new Error('Both full extraction and inventory scan failed');
  }

  const totalSubtests = inventory.domains.reduce((sum, d) => sum + d.subtests.length, 0);

  // If inventory shows few subtests, the single call should have been enough
  // The issue might be something else — return partial
  if (!wasTruncated && totalSubtests <= CHUNKED_SUBTEST_THRESHOLD && fullText) {
    return { text: fullText, meta: { strategy: 'single-verified', apiCalls: 2 } };
  }

  // ── PHASE 3: Chunked extraction by domain ──
  // Group domains into reasonable chunks (max ~10 subtests per call)
  const chunks: { subtests: string[]; domainHint: string }[] = [];
  let currentChunk: string[] = [];
  let currentDomainHints: string[] = [];

  for (const domain of inventory.domains) {
    if (currentChunk.length + domain.subtests.length > 10 && currentChunk.length > 0) {
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

  // Also include partial result from Phase 1 if it had valid data
  const allResults: ExtractionResult[] = chunkResults.filter(Boolean) as ExtractionResult[];
  if (partialResult && (partialResult.tables?.length ?? 0) > 0) {
    allResults.push(partialResult);
  }

  const merged = mergeExtractionResultsStable(allResults);
  const mergedText = JSON.stringify(merged);

  // Total API calls: 1 (full) + 1 (inventory) + N (chunks)
  return {
    text: mergedText,
    meta: {
      strategy: `chunked-${chunks.length}`,
      apiCalls: 2 + chunks.length,
    },
  };
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;

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

    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!bearerMatch) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = bearerMatch[1].trim();
    const jwtParts = accessToken.split('.');
    const malformedJwt = jwtParts.length !== 3 || jwtParts.some((part) => part.length === 0);
    if (
      !accessToken ||
      accessToken.startsWith('sb_publishable_') ||
      accessToken.startsWith('sb_secret_') ||
      malformedJwt
    ) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── PARSE PAYLOAD & VALIDATE EARLY ──
    const body = await req.json();
    const payload = (body.payload || {}) as Record<string, unknown>;

    if (!payload.imagePart) {
      return new Response(JSON.stringify({ error: 'Missing imagePart in payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: accessData, error: accessErr } = await supabase.rpc('check_extraction_access');
    const accessRow = Array.isArray(accessData) ? accessData[0] : accessData;
    const hasAccess = accessRow?.has_access === true;
    const remainingQuota = Number(accessRow?.remaining_quota ?? 0);

    if (accessErr || !hasAccess) {
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
    const { data: withinLimit, error: rlErr } = await supabase.rpc('check_extraction_rate_limit', {
      p_max_per_hour: MAX_EXTRACTIONS_PER_HOUR,
      p_max_per_day: MAX_EXTRACTIONS_PER_DAY,
    });
    if (rlErr || !withinLimit) {
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

    let result: ExtractionRunResult;

    try {
      if (repairRequest) {
        result = await extractWithRepair(payload, repairRequest);
      } else {
        result = await extractWithFallback(payload);
      }
    } catch (err) {
      const errMsg = String(err);
      const retryable = errMsg.includes('timeout') || errMsg.includes('429') || errMsg.includes('503');
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
      await supabase.from('extraction_log').insert({
        user_id: user.id,
        filename: String(payload.filename || 'unknown'),
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
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
