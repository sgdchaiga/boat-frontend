import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json" };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers });
  const secret = Deno.env.get("CRON_SECRET");
  const supplied = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || supplied !== secret) return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers });
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return new Response(JSON.stringify({ ok: false, error: "Missing Supabase environment" }), { status: 500, headers });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [monitoring, hotelPack] = await Promise.all([
    client.rpc("run_control_centre_monitoring", { p_limit: 100 }),
    client.rpc("run_due_hotel_revenue_assurance_controls", { p_limit: 100 }),
  ]);
  const posCash = await client.rpc("run_due_hotel_pos_cash_controls", { p_limit: 100 });
  const error = monitoring.error ?? hotelPack.error ?? posCash.error;
  return new Response(JSON.stringify(error ? { ok: false, error: error.message } : { ok: true, monitoring: monitoring.data, hotel_pack: hotelPack.data, pos_cash_pack: posCash.data }), { status: error ? 500 : 200, headers });
});
