/**
 * Mint RS256 renewal JWTs for BOAT Desktop (Admin → Subscription renewal).
 *
 * Secrets (Supabase project → Edge Functions):
 *   SUBSCRIPTION_RENEWAL_PRIVATE_KEY — PKCS#8 PEM, one line or literal \n newlines.
 *     openssl pkcs8 -topk8 -inform PEM -in rsa-private.pem -outform PEM -nocrypt -out private-pkcs8.pem
 *
 * The matching **public** key must be embedded in desktop builds as VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  /** Browsers send a preflight for POST + Authorization; without this some environments show net::ERR_FAILED. */
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const ALLOWED = new Set(["trial", "active", "past_due", "cancelled", "expired", "none"]);

type Body = {
  organization_id?: string;
  status?: string;
  plan_code?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  /** How long the JWT may be pasted/applied (not subscription period). Default 90. */
  token_valid_days?: number;
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const pemRaw = (Deno.env.get("SUBSCRIPTION_RENEWAL_PRIVATE_KEY") || "").trim();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ ok: false, error: "Missing Supabase function env" }, 500);
    }
    if (!pemRaw) {
      return json(
        {
          ok: false,
          error: "renewal_signing_not_configured",
          message: "Set SUBSCRIPTION_RENEWAL_PRIVATE_KEY (PKCS#8 PEM) in Edge Function secrets for this project.",
        },
        503
      );
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: userData, error: authErr } = await authClient.auth.getUser();
    if (authErr || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const adminCheck = await serviceClient
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (adminCheck.error || !adminCheck.data) {
      return json({ ok: false, error: "forbidden_platform_admin_required" }, 403);
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }

    const organizationId = String(body.organization_id ?? "").trim();
    if (!organizationId) return json({ ok: false, error: "organization_id is required" }, 400);

    const status = String(body.status ?? "active").trim().toLowerCase();
    if (!ALLOWED.has(status)) {
      return json({ ok: false, error: "invalid_status", allowed: [...ALLOWED] }, 400);
    }

    const { data: orgRow, error: orgErr } = await serviceClient.from("organizations").select("id").eq("id", organizationId).maybeSingle();
    if (orgErr) return json({ ok: false, error: orgErr.message }, 400);
    if (!orgRow?.id) return json({ ok: false, error: "organization_not_found" }, 404);

    const jti = crypto.randomUUID();
    const now = new Date();
    const validDays = Math.min(365, Math.max(1, Math.floor(Number(body.token_valid_days ?? 90) || 90)));
    const expiresAt = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);

    const planCode = body.plan_code != null && String(body.plan_code).trim() ? String(body.plan_code).trim() : "desktop-local";
    const periodStart = body.period_start?.trim() || null;
    const periodEnd = body.period_end?.trim() || null;

    const payload: Record<string, string> = {
      jti,
      org_id: organizationId,
      status,
      plan_code: planCode,
      issued_at: now.toISOString(),
      not_before: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };
    if (periodStart) payload.period_start = periodStart;
    if (periodEnd) payload.period_end = periodEnd;

    const pem = pemRaw.replace(/\\n/g, "\n");
    if (!pem.includes("PRIVATE KEY")) {
      return json({ ok: false, error: "invalid_private_key_pem" }, 500);
    }

    let privateKey;
    try {
      privateKey = await importPKCS8(pem, "RS256");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "importPKCS8 failed";
      return json(
        {
          ok: false,
          error: "private_key_import_failed",
          message: msg + " — use PKCS#8 PEM (openssl pkcs8 -topk8 -nocrypt).",
        },
        500
      );
    }

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(privateKey);

    return json({
      ok: true,
      token,
      claims: {
        jti,
        org_id: organizationId,
        status,
        plan_code: planCode,
        period_start: periodStart,
        period_end: periodEnd,
        expires_at: payload.expires_at,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return json({ ok: false, error: "internal_error", message: msg }, 500);
  }
});
