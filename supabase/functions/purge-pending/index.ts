// @ts-nocheck
/**
 * purge-pending — Manual / webhook-triggered purge of expired pending_questionnaires.
 *
 * This is a fallback for environments where pg_cron is not available.
 * It can also be called manually (e.g. from a Supabase cron webhook or admin panel).
 *
 * Primary purge: SQL migration 20260615000002_purge_expired_pending_questionnaires.sql (pg_cron)
 * Fallback: POST /functions/v1/purge-pending (this function, protected by service-role key)
 *
 * Deletes:
 *   - pending questionnaires older than 72h with status='pending'
 *   - processed questionnaires older than 24h with status='processed'
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow requests authenticated with the service role key
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date().toISOString();
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Purge pending > 72h
  const { count: deletedPending, error: err1 } = await adminClient
    .from("pending_questionnaires")
    .delete({ count: "exact" })
    .eq("status", "pending")
    .lt("created_at", cutoff72h);

  // Purge processed > 24h
  const { count: deletedProcessed, error: err2 } = await adminClient
    .from("pending_questionnaires")
    .delete({ count: "exact" })
    .eq("status", "processed")
    .lt("created_at", cutoff24h);

  if (err1 || err2) {
    console.error("Purge error:", err1 ?? err2);
    return new Response(
      JSON.stringify({ error: "Purge failed", detail: (err1 ?? err2)?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log(`[purge-pending] ${now} — deleted ${deletedPending} pending, ${deletedProcessed} processed`);

  return new Response(
    JSON.stringify({
      ok: true,
      deletedPending: deletedPending ?? 0,
      deletedProcessed: deletedProcessed ?? 0,
      ranAt: now,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
