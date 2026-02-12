// Supabase Edge Function — Gemini AI Proxy
// Keeps the API key server-side, never exposed to the client.
// SECURITY: Enforces credit consumption + rate limiting server-side.
// RELIABILITY: Retries transient Gemini errors (503/429) with exponential backoff.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 110_000; // 110s — leaves headroom below Edge Function's 150s wall-clock limit
const MAX_REQUESTS_PER_HOUR = 15;
const GEMINI_MAX_RETRIES = 2;        // Up to 3 total attempts for transient errors
const GEMINI_RETRY_BASE_MS = 2_000;  // 2s, 4s exponential backoff

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Safely refund a credit. supabase.rpc() returns a PostgrestFilterBuilder
 * (thenable but NOT a native Promise — no .catch()). We use try/await instead.
 */
const safeRefund = async (
  sb: ReturnType<typeof createClient> | null,
  genId: string | null,
  isReused: boolean,
) => {
  if (isReused || !sb || !genId) return;
  try {
    await sb.rpc('refund_credit', { p_generation_id: genId });
    console.log("Credit refunded for generation", genId);
  } catch (e) {
    console.error("Refund failed (non-blocking):", e);
  }
};

/** Whether a Gemini HTTP status is transient and worth retrying. */
const isRetryableStatus = (status: number) => status === 503 || status === 429;

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let supabase: ReturnType<typeof createClient> | null = null;
  let generationId: string | null = null;
  let isReusedSession = false; // true when a valid generation_id was provided (no new credit consumed)

  try {
    // 1. Verify JWT — only authenticated users can call this
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. SECURITY: Rate limiting — always checked, even for reused sessions
    const { data: withinLimit, error: rlErr } = await supabase.rpc('check_rate_limit', {
      p_max_per_hour: MAX_REQUESTS_PER_HOUR,
    });
    if (rlErr || !withinLimit) {
      return new Response(JSON.stringify({ error: "RATE_LIMITED", message: "Trop de requêtes. Réessayez dans quelques minutes." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Parse request body BEFORE credit logic (need generation_id param)
    const body = await req.json();
    const { contents, systemInstruction, responseMimeType, generation_id: providedGenId } = body;

    // 4. SECURITY: Credit logic — reuse session OR consume new credit
    //    A full report = 2 AI calls but 1 credit. The first call returns a generationId,
    //    and the second call passes it back to skip credit consumption.
    if (providedGenId && typeof providedGenId === 'string') {
      // Validate: belongs to user, not refunded, created < 10 min ago
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: validGen } = await supabase
        .from('generation_log')
        .select('id')
        .eq('id', providedGenId)
        .eq('user_id', user.id)
        .neq('status', 'refunded')
        .gte('created_at', tenMinAgo)
        .single();

      if (validGen) {
        generationId = providedGenId;
        isReusedSession = true;
      }
      // If invalid/expired, fall through to consume a new credit
    }

    if (!isReusedSession) {
      const { data: genId, error: creditErr } = await supabase.rpc('consume_credit');
      if (creditErr || !genId) {
        return new Response(JSON.stringify({ error: "CREDIT_INSUFFICIENT", message: "Crédits insuffisants." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      generationId = genId;
    }

    // 5. Validate Gemini API key
    if (!GEMINI_API_KEY) {
      await safeRefund(supabase, generationId, isReusedSession);
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Validate contents
    if (!contents) {
      await safeRefund(supabase, generationId, isReusedSession);
      return new Response(JSON.stringify({ error: "Missing 'contents' in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Build Gemini API request body
    const geminiBody: Record<string, unknown> = {
      contents: Array.isArray(contents) ? contents : [{ role: "user", parts: [{ text: contents }] }],
    };

    if (systemInstruction) {
      geminiBody.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    if (responseMimeType) {
      geminiBody.generationConfig = { responseMimeType };
    }

    // 8. Call Gemini API with retry for transient errors (503, 429)
    let geminiResponse: Response | null = null;
    let lastGeminiStatus = 0;

    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delayMs = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt - 1); // 2s, 4s
        console.log(`Gemini retry ${attempt}/${GEMINI_MAX_RETRIES} after ${delayMs}ms (last status: ${lastGeminiStatus})`);
        await sleep(delayMs);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

      try {
        geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (geminiResponse.ok) break; // Success — exit retry loop

        lastGeminiStatus = geminiResponse.status;

        // Only retry transient errors (503, 429); permanent errors fail immediately
        if (!isRetryableStatus(geminiResponse.status)) break;

        // Consume the body so the connection is released before retry
        await geminiResponse.text();
        geminiResponse = null; // Force re-fetch on next iteration

      } catch (err) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === "AbortError") {
          // Timeout — don't retry (we're already near the wall-clock limit)
          await safeRefund(supabase, generationId, isReusedSession);
          return new Response(JSON.stringify({ error: "Gemini request timed out", retryable: true }), {
            status: 504,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Network error on last attempt → refund and rethrow
        if (attempt === GEMINI_MAX_RETRIES) {
          await safeRefund(supabase, generationId, isReusedSession);
          throw err;
        }
        // Network error with retries left → continue loop
        lastGeminiStatus = 0;
        geminiResponse = null;
      }
    }

    // All retries exhausted or permanent error
    if (!geminiResponse || !geminiResponse.ok) {
      const errorText = geminiResponse ? await geminiResponse.text() : `Network error (status ${lastGeminiStatus})`;
      console.error("Gemini API error after retries:", errorText);
      await safeRefund(supabase, generationId, isReusedSession);
      const retryable = isRetryableStatus(lastGeminiStatus);
      return new Response(JSON.stringify({
        error: "AI generation failed",
        details: lastGeminiStatus || 0,
        retryable,
      }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiResponse.json();

    // 9. Extract text from Gemini response
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    // 10. Return — client marks 'completed' after all AI calls for a report succeed
    return new Response(JSON.stringify({ text, generationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Edge function error:", err);
    // Attempt refund on unexpected errors (safeRefund is no-op if already refunded/reused)
    await safeRefund(supabase, generationId, isReusedSession);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
