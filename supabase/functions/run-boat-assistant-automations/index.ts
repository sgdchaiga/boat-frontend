import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json" };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ ok: false, error: "Method not allowed" }, 405);
  const secret = Deno.env.get("CRON_SECRET");
  const supplied = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || supplied !== secret) return reply({ ok: false, error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ ok: false, error: "Missing Supabase environment" }, 500);
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.rpc("run_due_boat_assistant_automations", { p_limit: 100 });
  if (error) return reply({ ok: false, error: error.message }, 500);
  return reply({ ok: true, result: data });
});

