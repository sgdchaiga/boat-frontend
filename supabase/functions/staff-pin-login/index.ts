import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

function isExpectedPinFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("invalid staff code or pin")
    || normalized.includes("pin locked until")
    || normalized.includes("staff account is inactive");
}

type Body = {
  staff_code?: string;
  pin?: string;
  redirect_to?: string;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ ok: false, error: "Missing Supabase function env" }, 500);
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const staffCode = String(body.staff_code ?? "").trim();
    const pin = String(body.pin ?? "").trim();
    const redirectTo = String(body.redirect_to ?? "").trim();
    if (!staffCode || !pin) return json({ ok: false, error: "staff_code and pin are required" }, 400);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: rows, error: verifyError } = await serviceClient.rpc("consume_staff_pin_login", {
      p_staff_code: staffCode,
      p_pin: pin,
    });
    if (verifyError) {
      const message = verifyError.message || "Invalid staff code or PIN";
      if (isExpectedPinFailure(message)) {
        return json({ ok: false, error: message });
      }
      console.error("staff-pin-login verification RPC failed", verifyError);
      return json({ ok: false, error: message }, 500);
    }

    const row = Array.isArray(rows) ? rows[0] : rows;
    const email = row?.email ? String(row.email) : "";
    if (!email) return json({ ok: false, error: "PIN login account has no email" }, 400);

    const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    if (linkError || !linkData?.properties?.action_link) {
      console.error("staff-pin-login magic-link generation failed", linkError);
      return json({ ok: false, error: linkError?.message || "Failed to create PIN login session" }, 500);
    }

    return json({
      ok: true,
      action_link: linkData.properties.action_link,
      staff: {
        id: row.staff_id,
        organization_id: row.organization_id,
        email,
        full_name: row.full_name,
        role: row.role,
        pin_change_required: row.pin_change_required === true,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return json({ ok: false, error: "internal_error", message }, 500);
  }
});
