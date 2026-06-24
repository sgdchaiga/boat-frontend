import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  try {
    const { phone, pin, redirect_to } = await req.json();
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({ ok: false, error: "Missing function configuration" }, 500);
    const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await service.rpc("consume_sacco_member_pin_login", { p_phone: String(phone || ""), p_pin: String(pin || "") });
    if (error) return json({ ok: false, error: error.message || "Invalid telephone or PIN" });
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.login_email) return json({ ok: false, error: "Invalid telephone or PIN" });
    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink", email: row.login_email, options: redirect_to ? { redirectTo: String(redirect_to) } : undefined,
    });
    if (linkError || !link?.properties?.hashed_token) return json({ ok: false, error: "Could not create member session" }, 500);
    return json({ ok: true, token_hash: link.properties.hashed_token });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
