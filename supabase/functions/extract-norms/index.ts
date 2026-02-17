import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 180_000; // Allow extra time for chunked fallback
const MAX_EXTRACTIONS_PER_HOUR = 50;
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2_000;
const MAX_OUTPUT_TOKENS = 65536;
const CHUNKED_SUBTEST_THRESHOLD = 8; // Trigger chunked fallback if inventory finds > N subtests

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryableStatus = (status: number) => status === 503 || status === 429;

// ── TYPES ──────────────────────────────────────────────────────────────────

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

interface ExtractedTable {
  subtest_id: string;
  rows: Record<string, unknown>[];
}

interface ExtractionResult {
  test_context?: string;
  structure_type?: string;
  tables?: ExtractedTable[];
}

interface InventoryDomain {
  domain: string;
  subtests: string[];
}

interface InventoryResult {
  test_context?: string;
  structure_type?: string;
  domains: InventoryDomain[];
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

const EXTRACTION_RULES = `
--- STEP 1: CLASSIFICATION (structure_type) ---
A) "PARAMETRIC": Contains statistical constants per group (Mean/Moyenne/M AND SD/Ecart-Type/Sigma).
   The table does NOT map raw scores to percentiles directly. It gives the formula constants.
B) "LOOKUP": Maps Raw Scores (ranges or single values) to Standard Scores (NS, Scaled) or Percentiles.

--- STEP 2: EXTRACTION RULES ---
1. PIVOT: If columns represent Ages/Grades and rows represent Stats (M, SD), YOU MUST PIVOT. Create ONE object per Age/Grade.
2. VALUES:
   - If Parametric: Extract "mean" and "sd".
   - If Lookup: Extract "raw_range", "standard", "percentile".
3. ACCURACY:
   - Clean units (sec, pts).
   - Keep decimals.
   - For LOOKUP, keep raw score ranges as strings (e.g. "0-5").
4. SUBTEST NAMING (CRITICAL):
   - NEVER use abbreviated column headers as subtest names (e.g. "AA", "FD", "MV", "ST", "IP", "CF", "MD", "DT").
   - You MUST expand every abbreviation to its FULL FRENCH clinical name.
   - Use the test name (visible in the title or header), the domain section headers, and your clinical knowledge of standardized tests to determine the full subtest name.
   - The image always contains enough context: test title, domain groupings, and column abbreviations — combine them to resolve the full name.
   - Do NOT use English code-style names — use the French clinical name instead.
   - Do NOT add age, grade, or side qualifiers in the subtest name.
   - If a known subtest name from previous pages matches what you see, use it EXACTLY.
   - When you genuinely cannot determine the full name, use the abbreviation followed by the domain in parentheses (e.g. "DR (Langage)") as a last resort.

--- STEP 3: NORMALIZATION RULES (CRITICAL FOR DATABASE) ---
You must calculate specific numeric values for the database:
1. AGE NORMALIZATION (age_min_months, age_max_months):
   - Convert label "4;6" or "4 ans 6 mois" -> 54 months.
   - Convert range "4;0 - 4;5" -> min: 48, max: 53.
   - If only grade is available (e.g. "CP"), estimate typical age (CP = 6 years = 72 months).
2. RAW SCORE NORMALIZATION (raw_min, raw_max):
   - "15-16" -> min: 15, max: 16
   - "7" -> min: 7, max: 7
   - "<5" -> min: 0, max: 5
   - ">19" or "19+" -> min: 19, max: 999 (use a high number for infinity)
`;

const JSON_SCHEMA = `
--- JSON OUTPUT SCHEMA ---
{
  "test_context": "string (Detected name of the test)",
  "structure_type": "PARAMETRIC" | "LOOKUP",
  "tables": [
    {
      "subtest_id": "string (Subtest name)",
      "rows": [
        {
          "label": "string (Display Label, e.g. '4;0 - 4;5')",
          "mean": "string (Only if PARAMETRIC)",
          "sd": "string (Only if PARAMETRIC)",
          "raw_range": "string (Only if LOOKUP: Raw Score as displayed)",
          "standard": "string (Only if LOOKUP: Standard Score)",
          "percentile": "string (Only if LOOKUP: Percentile)",
          "z_score": "string (Z-Score if explicit)",
          "age_min_months": number | null,
          "age_max_months": number | null,
          "raw_min": number | null,
          "raw_max": number | null
        }
      ]
    }
  ]
}

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
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png" or "13ans.jpg"). Use this information to infer the row "label" if it's not explicitly in the table headers.
${buildKnownNamesBlock(knownSubtestNames)}
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
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".

TASK: List ALL subtest column headers visible on this page image, grouped by their domain/section header.

For each domain section visible (e.g. "Attention et fonctions exécutives", "Mémoire et apprentissage", etc.), list the subtests under it.

IMPORTANT: Do NOT use abbreviated column headers (e.g. "AA", "FD", "MV"). You MUST expand each abbreviation to its FULL FRENCH clinical subtest name using your knowledge of the test. For example: AA → "Attention auditive", FD → "Fluidité de dessins", ST → "Statue", etc.

Also detect the table structure type:
- "PARAMETRIC" if the table contains Mean/SD statistical constants
- "LOOKUP" if it maps raw scores to standard scores or percentiles

JSON OUTPUT SCHEMA:
{
  "test_context": "string (Name of the test, e.g. NEPSY-II)",
  "structure_type": "PARAMETRIC" | "LOOKUP",
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
  const imagePart = payload.imagePart;

  const prompt = `ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
CONTEXT: The filename is "${filename}".
IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png" or "13ans.jpg"). Use this information to infer the row "label" if it's not explicitly in the table headers.
${buildKnownNamesBlock(knownSubtestNames)}
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

// ── MERGE EXTRACTION RESULTS ───────────────────────────────────────────────

const mergeExtractionResults = (results: ExtractionResult[]): ExtractionResult => {
  const merged: ExtractionResult = {
    test_context: '',
    structure_type: 'LOOKUP',
    tables: [],
  };

  const seenSubtests = new Set<string>();

  for (const result of results) {
    if (!result) continue;
    if (result.test_context && !merged.test_context) merged.test_context = result.test_context;
    if (result.structure_type) merged.structure_type = result.structure_type;

    if (Array.isArray(result.tables)) {
      for (const table of result.tables) {
        if (!table.subtest_id) continue;
        // Deduplicate: keep the version with more rows
        if (seenSubtests.has(table.subtest_id)) {
          const existing = merged.tables!.find((t) => t.subtest_id === table.subtest_id);
          if (existing && table.rows.length > existing.rows.length) {
            existing.rows = table.rows;
          }
        } else {
          seenSubtests.add(table.subtest_id);
          merged.tables!.push(table);
        }
      }
    }
  }

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

// ── ORCHESTRATOR: Try single call, fallback to chunked ─────────────────────

const extractWithFallback = async (
  payload: Record<string, unknown>
): Promise<{ text: string; strategy: string; apiCalls: number }> => {
  // ── PHASE 1: Try single full extraction ──
  const fullTask = buildFullExtractionTask(payload);
  const { text: fullText, finishReason } = await callGemini(fullTask.contents);

  const wasTruncated = finishReason === 'MAX_TOKENS' || finishReason === 'LENGTH';

  if (!wasTruncated && fullText) {
    // Single call succeeded without truncation — cheapest path
    return { text: fullText, strategy: 'single', apiCalls: 1 };
  }

  // Parse what we got (may be partial)
  const partialResult = safeJsonParse(fullText);
  const extractedSubtestCount = partialResult?.tables?.length ?? 0;

  // If we got a reasonable number of subtests and no truncation signal, trust the result
  if (!wasTruncated && extractedSubtestCount >= 3) {
    return { text: fullText!, strategy: 'single', apiCalls: 1 };
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
    if (fullText) {
      return { text: fullText, strategy: 'single-fallback', apiCalls: 2 };
    }
    throw new Error('Both full extraction and inventory scan failed');
  }

  const totalSubtests = inventory.domains.reduce((sum, d) => sum + d.subtests.length, 0);

  // If inventory shows few subtests, the single call should have been enough
  // The issue might be something else — return partial
  if (totalSubtests <= CHUNKED_SUBTEST_THRESHOLD && fullText) {
    return { text: fullText, strategy: 'single-verified', apiCalls: 2 };
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

  const merged = mergeExtractionResults(allResults);
  const mergedText = JSON.stringify(merged);

  // Total API calls: 1 (full) + 1 (inventory) + N (chunks)
  return { text: mergedText, strategy: `chunked-${chunks.length}`, apiCalls: 2 + chunks.length };
};

// ── MAIN HANDLER ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;

  try {
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

    // ── RATE LIMITING (HOURLY CAP) ──
    const { data: withinLimit, error: rlErr } = await supabase.rpc('check_extraction_rate_limit', {
      p_max_per_hour: MAX_EXTRACTIONS_PER_HOUR,
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
    let result: { text: string; strategy: string; apiCalls: number };

    try {
      result = await extractWithFallback(payload);
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

    // ── LOG EXTRACTION (with strategy tracking) ──
    try {
      const tokenEstimate = result.text ? Math.ceil(result.text.length / 4) : 0;
      await supabase.from('extraction_log').insert({
        user_id: user.id,
        filename: String(payload.filename || 'unknown'),
        status: 'completed',
        token_estimate: tokenEstimate,
      });
    } catch (_logErr) {
      // Non-blocking
    }

    return new Response(JSON.stringify({ text: result.text }), {
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
