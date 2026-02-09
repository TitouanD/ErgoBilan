// Supabase Edge Function — Gemini AI Proxy
// Keeps the API key server-side, never exposed to the client.
// SECURITY: Enforces credit consumption + rate limiting server-side.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_TIMEOUT_MS = 110_000; // 110s — leaves headroom below Edge Function's 150s wall-clock limit
const MAX_REQUESTS_PER_HOUR = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
      if (!isReusedSession && supabase && generationId) {
        await supabase.rpc('refund_credit', { p_generation_id: generationId });
      }
      return new Response(JSON.stringify({ error: "AI service not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 6. Validate contents
    if (!contents) {
      if (!isReusedSession && supabase && generationId) {
        await supabase.rpc('refund_credit', { p_generation_id: generationId });
      }
      return new Response(JSON.stringify({ error: "Missing 'contents' in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build Gemini API request
    const geminiBody: Record<string, unknown> = {
      contents: Array.isArray(contents) ? contents : [{ role: "user", parts: [{ text: contents }] }],
    };

    if (systemInstruction) {
      geminiBody.system_instruction = { parts: [{ text: systemInstruction }] };
    }

    if (responseMimeType) {
      geminiBody.generationConfig = { responseMimeType };
    }

    // 6. Call Gemini API (with timeout)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let geminiResponse: Response;
    try {
      geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      // Refund on timeout or network error — only if we consumed a fresh credit
      if (!isReusedSession && supabase && generationId) {
        await supabase.rpc('refund_credit', { p_generation_id: generationId }).catch(() => {});
      }
      if (err instanceof DOMException && err.name === "AbortError") {
        return new Response(JSON.stringify({ error: "Gemini request timed out" }), {
          status: 504,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }
    clearTimeout(timer);

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", errorText);
      // Refund on Gemini API error — only if we consumed a fresh credit
      if (!isReusedSession && supabase && generationId) {
        await supabase.rpc('refund_credit', { p_generation_id: generationId }).catch(() => {});
      }
      return new Response(JSON.stringify({ error: "AI generation failed", details: geminiResponse.status }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiResponse.json();

    // 7. Extract text from Gemini response
    const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;

    // 8. Return — client marks 'completed' after all AI calls for a report succeed
    return new Response(JSON.stringify({ text, generationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
