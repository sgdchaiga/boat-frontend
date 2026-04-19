/**
 * Scheduled night audit: post missing hotel room charges (folio night = yesterday per org timezone).
 *
 * Deploy: `supabase functions deploy run-daily-room-charges --no-verify-jwt`
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   CRON_SECRET — long random string; send as Authorization: Bearer <CRON_SECRET>
 *
 * Supabase Dashboard → Database → Extensions: enable pg_cron if you HTTP-call this function,
 * or use Project Settings → Edge Functions → Schedules with the same Authorization header.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const secret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || auth !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ ok: false, error: "Missing Supabase env" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(url, serviceKey);
  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("business_type", "hotel");

  if (orgErr) {
    return new Response(JSON.stringify({ ok: false, error: orgErr.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const results: unknown[] = [];
  for (const org of orgs ?? []) {
    const { data, error } = await supabase.rpc("run_hotel_night_audit_for_org", {
      p_organization_id: org.id,
      p_folio_night_date: null,
      p_created_by: null,
    });
    results.push({
      organization_id: org.id,
      error: error?.message ?? null,
      result: data ?? null,
    });
  }

  return new Response(JSON.stringify({ ok: true, organizations: (orgs ?? []).length, results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
