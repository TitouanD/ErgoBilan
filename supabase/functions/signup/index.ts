// @ts-nocheck
// Supabase Edge Function — Signup with rate limiting
// SECURITY: Enforces IP-based rate limiting before auth.signup

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_SIGNUPS_PER_HOUR = 5;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string) => {
  const enc = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return toHex(hash);
};

const getClientIp = (req: Request) => {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { email, password } = body ?? {};

    if (!email || !password) {
      return new Response(JSON.stringify({ error: "Missing email or password" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof password !== "string" || password.length < 8) {
      return new Response(JSON.stringify({ error: "Weak password", message: "Le mot de passe doit contenir au moins 8 caractères." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ip = getClientIp(req);
    const ipHash = ip ? await sha256Hex(ip) : null;
    const emailHash = await sha256Hex(String(email).toLowerCase().trim());

    const { data: withinLimit, error: rlErr } = await supabase.rpc("check_signup_rate_limit", {
      p_ip_hash: ipHash,
      p_email_hash: emailHash,
      p_max_per_hour: MAX_SIGNUPS_PER_HOUR,
    });

    if (rlErr || !withinLimit) {
      return new Response(
        JSON.stringify({ error: "RATE_LIMITED", message: "Trop d'inscriptions depuis cet appareil. Réessayez plus tard." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const signupRes = await fetch(`${supabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ email, password }),
    });

    const signupData = await signupRes.json();

    if (!signupRes.ok) {
      return new Response(JSON.stringify(signupData), {
        status: signupRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(signupData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Signup edge error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
