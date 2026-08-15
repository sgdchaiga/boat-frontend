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
    const credentials = { p_phone: String(phone || ""), p_pin: String(pin || "") };
    const saccoResult = await service.rpc("consume_sacco_member_pin_login", credentials);
    let row = Array.isArray(saccoResult.data) ? saccoResult.data[0] : saccoResult.data;
    let memberType = "sacco";
    if (!row?.login_email) {
      const vslaResult = await service.rpc("consume_vsla_member_pin_login", credentials);
      row = Array.isArray(vslaResult.data) ? vslaResult.data[0] : vslaResult.data;
      memberType = "vsla";
      if (vslaResult.error && !saccoResult.error) return json({ ok: false, error: vslaResult.error.message });
    }
    if (!row?.login_email) return json({ ok: false, error: "Invalid telephone or PIN" });
    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink", email: row.login_email, options: redirect_to ? { redirectTo: String(redirect_to) } : undefined,
    });
    if (linkError || !link?.properties?.hashed_token) return json({ ok: false, error: "Could not create member session" }, 500);
    return json({ ok: true, token_hash: link.properties.hashed_token, member_type: memberType });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
