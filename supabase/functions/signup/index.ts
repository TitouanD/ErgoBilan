// @ts-nocheck
// Supabase Edge Function - Authenticated onboarding endpoint
// Auth is handled by Supabase Auth (captcha/email confirmation/etc).
// This function only provisions practitioner/org/subscription + PIN material.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { captureEdgeException } from "../_shared/sentry.ts";

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const MAX_BODY_BYTES = parsePositiveInt(Deno.env.get("SIGNUP_MAX_BODY_BYTES"), 16_384);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value: string) => value.trim();
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const responseJson = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fail = (error: string, message: string, status: number) =>
  responseJson({ ok: false, error, message }, status);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return fail("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return fail("SERVER_MISCONFIGURED", "Supabase is not configured.", 500);
    }

    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (!authHeader) {
      return fail("UNAUTHORIZED", "Missing authorization header.", 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return fail("UNAUTHORIZED", "Invalid or expired session.", 401);
    }

    let body: Record<string, unknown>;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
        return fail("PAYLOAD_TOO_LARGE", "Request payload too large.", 413);
      }
      body = JSON.parse(rawBody);
    } catch {
      return fail("INVALID_PAYLOAD", "Invalid request payload.", 400);
    }

    const authEmail = normalizeEmail(String(user.email || ""));
    const professionalEmail = typeof body?.email === "string" ? normalizeEmail(body.email) : "";
    if (!professionalEmail) {
      return fail("MISSING_FIELDS", "Missing practitioner email.", 400);
    }
    if (!emailRegex.test(professionalEmail)) {
      return fail("INVALID_EMAIL", "Please use a valid email address.", 400);
    }

    const firstName = typeof body?.firstName === "string" ? normalize(body.firstName) : "";
    const lastName = typeof body?.lastName === "string" ? normalize(body.lastName) : "";
    const phone = typeof body?.phone === "string" ? normalize(body.phone) : "";
    const siret = typeof body?.siret === "string" ? normalize(body.siret) : "";
    const address = typeof body?.address === "string" ? normalize(body.address) : "";
    const encryptionSalt = typeof body?.encryptionSalt === "string" ? normalize(body.encryptionSalt) : "";
    const encryptionValidator = typeof body?.encryptionValidator === "string"
      ? normalize(body.encryptionValidator)
      : "";
    const encryptedOrgKey = typeof body?.encryptedOrgKey === "string" ? normalize(body.encryptedOrgKey) : "";
    const orgName = typeof body?.orgName === "string" && body.orgName.trim().length > 0
      ? normalize(body.orgName)
      : "Mon Cabinet";

    if (!firstName || !lastName) {
      return fail("MISSING_FIELDS", "Missing practitioner firstName/lastName.", 400);
    }
    if (!encryptionSalt || !encryptionValidator || !encryptedOrgKey) {
      return fail("MISSING_FIELDS", "Missing PIN setup material.", 400);
    }
    if (encryptionSalt === "pending" || encryptionValidator === "pending") {
      return fail("INVALID_PIN_SETUP", "PIN material cannot be pending.", 400);
    }

    const practitionerPayload = {
      email: professionalEmail,
      first_name: firstName,
      last_name: lastName,
      phone_pro: phone,
      siret,
      address_pro: address,
      encryption_salt: encryptionSalt,
      encryption_validator: encryptionValidator,
    };

    let practitionerRow: Record<string, unknown> | null = null;
    let practitionerError: { message?: string } | null = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const { error: bootstrapPractitionerError } = await supabase.rpc("bootstrap_practitioner_for_user", {
        p_user_id: user.id,
        p_email: professionalEmail,
      });
      if (bootstrapPractitionerError) {
        practitionerError = bootstrapPractitionerError;
      }

      const { data: updatedPractitioner, error: updatePractitionerError } = await supabase
        .from("practitioners")
        .update(practitionerPayload)
        .eq("id", user.id)
        .select("id, email, first_name, last_name, phone_pro, siret, address_pro, encryption_salt, encryption_validator")
        .maybeSingle();

      if (!updatePractitionerError && updatedPractitioner) {
        practitionerRow = updatedPractitioner;
        practitionerError = null;
        break;
      }

      practitionerError = updatePractitionerError || practitionerError;
      await sleep(250 * (attempt + 1));
    }

    if (!practitionerRow) {
      console.warn("Practitioner bootstrap/update failed", practitionerError);
      return fail("PRACTITIONER_SETUP_FAILED", "Failed to setup practitioner profile.", 500);
    }

    const { data: orgIdRaw, error: bootstrapOrgError } = await supabase.rpc("bootstrap_org_for_user", {
      p_user_id: user.id,
      p_org_name: orgName,
    });
    if (bootstrapOrgError || !orgIdRaw) {
      console.warn("Org bootstrap failed", bootstrapOrgError);
      return fail("ORG_SETUP_FAILED", "Failed to setup organization.", 500);
    }
    const orgId = String(orgIdRaw);

    const { error: memberUpdateError } = await supabase
      .from("organization_members")
      .update({ encrypted_org_key: encryptedOrgKey })
      .eq("user_id", user.id)
      .eq("organization_id", orgId);
    if (memberUpdateError) {
      console.warn("Org key setup failed", memberUpdateError);
      return fail("ORG_KEY_SETUP_FAILED", "Failed to setup encrypted organization key.", 500);
    }

    return responseJson({
      ok: true,
      data: {
        user: { id: user.id, email: authEmail || null },
        professional_email: professionalEmail,
        practitioner: practitionerRow,
        organization_id: orgId,
      },
    });
  } catch (err) {
    await captureEdgeException(err, {
      functionName: 'signup',
    });
    console.error("Signup onboarding edge error:", err);
    return fail("INTERNAL", "Internal server error.", 500);
  }
});
