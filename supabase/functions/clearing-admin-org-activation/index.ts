import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  organization_id?: string;
  enabled?: boolean;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const boatBase = (Deno.env.get("BOAT_CLEARING_SERVER_URL") ?? Deno.env.get("BOAT_SERVER_URL") ?? "").replace(/\/$/, "");
    const clearingApiKey = Deno.env.get("CLEARING_API_KEY")?.trim();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ ok: false, error: "Missing Supabase function env" });
    }
    if (!boatBase || !clearingApiKey) {
      return json({ ok: false, error: "clearing_server_not_configured_in_edge" });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: authErr } = await authClient.auth.getUser();
    if (authErr || !userData.user) return json({ ok: false, error: "Unauthorized" });

    const adminCheck = await serviceClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (adminCheck.error || !adminCheck.data) {
      return json({ ok: false, error: "forbidden_platform_admin_required" });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, error: "Invalid JSON" });
    }

    const organizationId = String(body.organization_id ?? "").trim();
    if (!organizationId) return json({ ok: false, error: "organization_id is required" });

    const enabled = Boolean(body.enabled);
    const url = `${boatBase}/api/v1/clearing/orgs/${organizationId}/activation`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${clearingApiKey}`,
        },
        body: JSON.stringify({ enabled }),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to reach clearing API";
      return json({ ok: false, error: "clearing_api_unreachable", message: msg });
    }

    const raw = await resp.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }

    if (!resp.ok) {
      return json(
        {
          ok: false,
          error: (parsed.error as string | undefined) || "clearing_activation_update_failed",
          message: (parsed.message as string | undefined) || (raw && raw.slice(0, 300)) || resp.statusText,
          status: resp.status,
        }
      );
    }

    return json({ ok: true, data: parsed.data ?? parsed });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unexpected edge function error";
    return json({ ok: false, error: "clearing_admin_org_activation_unhandled", message: msg });
  }
});

