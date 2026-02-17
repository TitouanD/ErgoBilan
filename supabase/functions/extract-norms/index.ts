import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 30_000; // Vision is faster than text generation
const MAX_EXTRACTIONS_PER_HOUR = 50; // Higher limit than report generation
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_MS = 2_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isRetryableStatus = (status: number) => status === 503 || status === 429;

// ── BUILD EXTRACTION TASK WITH FULL RESTORED PROMPTS ──────────────────────

const buildExtractNormsTask = (payload: Record<string, unknown>) => {
  const filename = String(payload.filename || 'document');
  const knownSubtestNames = Array.isArray(payload.knownSubtestNames) ? payload.knownSubtestNames : [];
  const imagePart = payload.imagePart;

  const knownNamesBlock = (knownSubtestNames && knownSubtestNames.length > 0)
    ? `\n            --- KNOWN SUBTESTS FROM PREVIOUS PAGES ---
            The following subtest names have already been extracted from earlier pages of the SAME test manual.
            YOU MUST REUSE these exact names when you encounter the same subtests on this page (even if the table header phrasing differs slightly).
            Known names: ${JSON.stringify(knownSubtestNames)}
            Only create a NEW subtest name if the subtest is genuinely different from all of the above.
`
    : '';

  const prompt = `
            ROLE: Expert Data Extractor for Occupational Therapy Clinical Tests.
            CONTEXT: The filename is "${filename}".
            IMPORTANT: The filename often contains the target AGE or GRADE (e.g., "CE1.png" or "13ans.jpg"). Use this information to infer the row "label" if it's not explicitly in the table headers.
${knownNamesBlock}
            TASK: Analyze the image, CLASSIFY the table structure, then EXTRACT and NORMALIZE data.

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
                4. SUBTEST NAMING:
                    - Use the simplest canonical subtest name visible in the manual, IN FRENCH when possible.
                    - Do NOT use English code-style names like "mabc2_catching_2_hands" — use the French clinical name instead.
                    - Do NOT add age, grade, or side qualifiers in the subtest name.
                    - Avoid redundant phrasing; keep names short and stable.
                    - If a known subtest name from previous pages matches what you see, use it EXACTLY.

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
                      
                      // NORMALIZED FIELDS (MANDATORY)
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
            - Do not use Markdown code blocks (no \`\`\`json).
            - Minify the JSON (remove unnecessary whitespace) to ensure the response fits within the token limit.
          `;

  return {
    contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
    responseMimeType: 'application/json',
  };
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

    // ── RATE LIMITING (NO CREDIT CONSUMPTION) ──
    const { data: withinLimit, error: rlErr } = await supabase.rpc('check_extraction_rate_limit', {
      p_max_per_hour: MAX_EXTRACTIONS_PER_HOUR,
    });
    if (rlErr || !withinLimit) {
      return new Response(
        JSON.stringify({
          error: 'RATE_LIMITED',
          message: 'Trop d\'extractions. Réessayez plus tard.',
        }),
        {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ── PARSE PAYLOAD ──
    const body = await req.json();
    const payload = (body.payload || {}) as Record<string, unknown>;

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── BUILD EXTRACTION TASK ──
    const built = buildExtractNormsTask(payload);

    const geminiBody = {
      contents: built.contents,
      generationConfig: {
        responseMimeType: built.responseMimeType,
      },
    };

    // ── CALL GEMINI WITH RETRY ──
    let geminiResponse: Response | null = null;
    let lastGeminiStatus = 0;

    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (geminiResponse.ok) break;

        lastGeminiStatus = geminiResponse.status;
        if (!isRetryableStatus(geminiResponse.status)) break;

        await geminiResponse.text();
        geminiResponse = null;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') {
          return new Response(
            JSON.stringify({ error: 'Gemini request timed out', retryable: true }),
            {
              status: 504,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }
        if (attempt === GEMINI_MAX_RETRIES) {
          throw err;
        }
        lastGeminiStatus = 0;
        geminiResponse = null;
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      const retryable = isRetryableStatus(lastGeminiStatus);
      return new Response(
        JSON.stringify({
          error: 'AI extraction failed',
          details: lastGeminiStatus || 0,
          retryable,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const geminiData = await geminiResponse.json();
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    // ── LOG EXTRACTION (for analytics/debugging) ──
    try {
      await supabase.from('extraction_log').insert({
        user_id: user.id,
        filename: String(payload.filename || 'unknown'),
        status: 'completed',
      });
    } catch (_logErr) {
      // Non-blocking
    }

    return new Response(JSON.stringify({ text }), {
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
