// @ts-nocheck
// Supabase Edge Function - Hardened signup endpoint
// SECURITY: multi-layer anti-abuse checks before auth.signup.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const MAX_SIGNUPS_PER_HOUR = parsePositiveInt(Deno.env.get("SIGNUP_MAX_PER_HOUR"), 3);
const MIN_PASSWORD_LENGTH = parsePositiveInt(Deno.env.get("SIGNUP_MIN_PASSWORD_LENGTH"), 10);
const FAIL_DELAY_MS = parsePositiveInt(Deno.env.get("SIGNUP_FAIL_DELAY_MS"), 400);
const MAX_BODY_BYTES = parsePositiveInt(Deno.env.get("SIGNUP_MAX_BODY_BYTES"), 16_384);
const TURNSTILE_TIMEOUT_MS = parsePositiveInt(Deno.env.get("TURNSTILE_TIMEOUT_MS"), 10_000);
const TURNSTILE_SECRET_KEY = (Deno.env.get("TURNSTILE_SECRET_KEY") || "").trim();
const SIGNUP_ACCESS_CODE = (Deno.env.get("SIGNUP_ACCESS_CODE") || "").trim();
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const APP_ENV = (Deno.env.get("APP_ENV") || Deno.env.get("ENV") || "").toLowerCase();
const IS_PRODUCTION = APP_ENV === "production" || APP_ENV === "prod" || !!Deno.env.get("DENO_DEPLOYMENT_ID");
const ALLOW_LOOPBACK_ORIGINS =
  (Deno.env.get("SIGNUP_ALLOW_LOOPBACK_ORIGINS") || "true").trim().toLowerCase() !== "false";
const SIGNUP_DEV_MODE =
  (Deno.env.get("SIGNUP_DEV_MODE") || "false").trim().toLowerCase() === "true";
const SIGNUP_AUTO_CONFIRM_IN_DEV =
  (Deno.env.get("SIGNUP_AUTO_CONFIRM_IN_DEV") || "true").trim().toLowerCase() !== "false";

const allowedOrigins = (Deno.env.get("SIGNUP_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v.length > 0);

const defaultBlockedDomains = [
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "yopmail.com",
  "sharklasers.com",
  "dispostable.com",
];

const blockedDomains = new Set(
  (Deno.env.get("SIGNUP_BLOCKED_EMAIL_DOMAINS") || defaultBlockedDomains.join(","))
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0),
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-captcha-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string) => {
  const enc = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return toHex(hash);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getEmailDomain = (email: string) => {
  const at = email.lastIndexOf("@");
  if (at === -1) return "";
  return email.slice(at + 1).toLowerCase();
};

const constantTimeEquals = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const getClientIp = (req: Request) => {
  const cfIp = (req.headers.get("cf-connecting-ip") || "").trim();
  if (cfIp) return cfIp;
  return "";
};

const isLoopbackOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
};

const getRequestSecurityContext = (req: Request) => {
  const origin = (req.headers.get("origin") || "").trim();
  const loopbackOrigin = ALLOW_LOOPBACK_ORIGINS && !!origin && isLoopbackOrigin(origin);
  // Automatic relaxed dev mode for localhost while no captcha secret is configured.
  const relaxedDevMode = SIGNUP_DEV_MODE || (!TURNSTILE_SECRET_KEY && loopbackOrigin);
  const originAllowed = (() => {
    if (!origin) return !IS_PRODUCTION || relaxedDevMode;
    if (loopbackOrigin) return true;
    if (allowedOrigins.length === 0) return !IS_PRODUCTION || relaxedDevMode;
    return allowedOrigins.includes(origin);
  })();
  return { origin, loopbackOrigin, relaxedDevMode, originAllowed };
};

const verifyTurnstileToken = async (secret: string, token: string, ip: string) => {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return false;
  }
  clearTimeout(timer);

  if (!res.ok) return false;
  const data = await res.json();
  return Boolean(data?.success);
};

const responseJson = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fail = async (error: string, message: string, status: number) => {
  await sleep(FAIL_DELAY_MS);
  return responseJson({ ok: false, error, message, status });
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const security = getRequestSecurityContext(req);
    if (!security.originAllowed) {
      return new Response("forbidden", { status: 403, headers: corsHeaders });
    }
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return responseJson({
      ok: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed.",
      status: 405,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    if (!SERVICE_ROLE_KEY) {
      return await fail("SERVER_MISCONFIGURED", "Signup endpoint is not configured.", 500);
    }

    const supabase = createClient(supabaseUrl, SERVICE_ROLE_KEY);
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);

    const security = getRequestSecurityContext(req);
    if (!security.originAllowed) {
      return await fail("FORBIDDEN_ORIGIN", "Origin is not allowed.", 403);
    }

    let body: Record<string, unknown>;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
        return await fail("PAYLOAD_TOO_LARGE", "Request payload too large.", 413);
      }
      body = JSON.parse(rawBody);
    } catch {
      return await fail("INVALID_PAYLOAD", "Invalid request payload.", 400);
    }

    const rawEmail = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const signupCode = typeof body?.signupCode === "string" ? body.signupCode : "";
    const captchaToken = typeof body?.captchaToken === "string"
      ? body.captchaToken
      : (req.headers.get("x-captcha-token") || "");

    if (!rawEmail || !password) {
      return await fail("MISSING_FIELDS", "Missing email or password.", 400);
    }

    const email = normalizeEmail(rawEmail);
    if (!emailRegex.test(email)) {
      return await fail("INVALID_EMAIL", "Please use a valid email address.", 400);
    }

    const domain = getEmailDomain(email);
    if (!domain || blockedDomains.has(domain)) {
      return await fail("EMAIL_BLOCKED", "This email domain is not allowed.", 400);
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return await fail(
        "WEAK_PASSWORD",
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        400,
      );
    }

    if (SIGNUP_ACCESS_CODE) {
      if (!signupCode || !constantTimeEquals(signupCode, SIGNUP_ACCESS_CODE)) {
        return await fail("ACCESS_CODE_REQUIRED", "Signup is currently restricted.", 403);
      }
    }

    const ip = getClientIp(req);

    const requiresTurnstile = !security.relaxedDevMode && (IS_PRODUCTION || TURNSTILE_SECRET_KEY.length > 0);
    if (requiresTurnstile) {
      if (!TURNSTILE_SECRET_KEY) {
        return await fail("SERVER_MISCONFIGURED", "Captcha protection is not configured.", 500);
      }
      if (!captchaToken) {
        return await fail("CAPTCHA_REQUIRED", "Captcha token is required.", 400);
      }
      const captchaOk = await verifyTurnstileToken(TURNSTILE_SECRET_KEY, captchaToken, ip);
      if (!captchaOk) {
        return await fail("CAPTCHA_FAILED", "Captcha verification failed.", 403);
      }
    }

    const ipHash = ip ? await sha256Hex(ip) : null;
    const emailHash = await sha256Hex(email);

    const { data: withinLimit, error: rlErr } = await supabase.rpc("check_signup_rate_limit", {
      p_ip_hash: ipHash,
      p_email_hash: emailHash,
      p_max_per_hour: MAX_SIGNUPS_PER_HOUR,
    });

    if (rlErr || !withinLimit) {
      console.warn("Signup rate-limited", { rlErr, ipPresent: Boolean(ip) });
      return await fail("RATE_LIMITED", "Too many signup attempts. Please retry later.", 429);
    }

    const { data: createdData, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: security.relaxedDevMode && SIGNUP_AUTO_CONFIRM_IN_DEV,
      app_metadata: {
        signup_channel: "edge_signup_v1",
        signup_mode: security.relaxedDevMode ? "dev_relaxed" : "strict",
      },
    });

    if (createErr || !createdData?.user) {
      const rawMessage = String(createErr?.message || "");
      if (/already|registered|exists/i.test(rawMessage)) {
        return await fail("SIGNUP_FAILED", "Signup is not available right now.", 400);
      }
      console.warn("Auth createUser rejected", { message: rawMessage });
      return await fail("SIGNUP_FAILED", "Signup is not available right now.", 400);
    }

    const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
      email,
      password,
    });

    const payload: Record<string, unknown> = {
      user: createdData.user,
    };

    if (!signInErr && signInData?.session) {
      payload.session = signInData.session;
      payload.access_token = signInData.session.access_token;
      payload.refresh_token = signInData.session.refresh_token;
    }

    return responseJson({ ok: true, data: payload });
  } catch (err) {
    console.error("Signup edge error:", err);
    return await fail("INTERNAL", "Internal server error.", 500);
  }
});
