import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body = {
  sale_id: string;
  amount_paid: number;
  payment_status: string;
  organization_id?: string | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const boatBase = (Deno.env.get("BOAT_CLEARING_SERVER_URL") ?? Deno.env.get("BOAT_SERVER_URL") ?? "").replace(/\/$/, "");
  const clearingApiKey = Deno.env.get("CLEARING_API_KEY")?.trim();

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ ok: false, error: "Missing Supabase function env" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: authErr } = await authClient.auth.getUser();
  if (authErr || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const saleId = typeof body.sale_id === "string" ? body.sale_id.trim() : "";
  const amountPaid = Number(body.amount_paid);
  const paymentStatus = typeof body.payment_status === "string" ? body.payment_status.trim() : "";

  if (!saleId || !Number.isFinite(amountPaid) || amountPaid <= 0) {
    return json({ ok: false, error: "sale_id and positive amount_paid are required" }, 400);
  }

  const allowedStatus = new Set(["partial", "completed", "overpaid"]);
  if (!allowedStatus.has(paymentStatus)) {
    return json({ ok: true, skipped: true, reason: "payment_status_not_settled" });
  }

  const staffRes = await authClient.from("staff").select("organization_id").eq("id", userData.user.id).maybeSingle();
  const staffOrg = (staffRes.data as { organization_id?: string | null } | null)?.organization_id ?? null;
  const orgHint = typeof body.organization_id === "string" ? body.organization_id.trim() : "";
  if (!staffOrg) {
    return json({ ok: false, error: "staff_organization_required" }, 403);
  }
  if (orgHint && orgHint !== staffOrg) {
    return json({ ok: false, error: "organization_scope_mismatch" }, 403);
  }
  const orgId = staffOrg;

  const { data: orgRow, error: orgErr } = await serviceClient
    .from("organizations")
    .select(
      "id, business_type, clearing_enabled, clearing_status, clearing_org_sacco_id, clearing_default_payer_sacco_id, clearing_merchant_sacco_id"
    )
    .eq("id", orgId)
    .maybeSingle();

  if (orgErr || !orgRow) {
    return json({ ok: false, error: "organization_not_found" }, 400);
  }

  const org = orgRow as {
    business_type?: string | null;
    clearing_enabled?: boolean | null;
    clearing_status?: string | null;
    clearing_org_sacco_id?: string | null;
    clearing_default_payer_sacco_id?: string | null;
    clearing_merchant_sacco_id?: string | null;
  };

  if (!org.clearing_enabled || org.clearing_status !== "active") {
    return json({ ok: true, skipped: true, reason: "clearing_not_active_for_org" });
  }

  let payer = org.clearing_default_payer_sacco_id?.trim() ?? "";
  let merchant = org.clearing_merchant_sacco_id?.trim() ?? "";

  if (!boatBase || !clearingApiKey) {
    return json({ ok: false, error: "clearing_server_not_configured_in_edge" }, 503);
  }

  if (!payer || !merchant) {
    const ensureUrl = `${boatBase}/api/v1/clearing/orgs/${orgId}/ensure-account`;
    const ensureRes = await fetch(ensureUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clearingApiKey}`,
      },
      body: JSON.stringify({ activate: false }),
    });

    const ensureRaw = await ensureRes.text();
    let ensureJson: { data?: { data?: { clearing_default_payer_sacco_id?: string; clearing_merchant_sacco_id?: string } } } = {};
    try {
      ensureJson = ensureRaw ? (JSON.parse(ensureRaw) as typeof ensureJson) : {};
    } catch {
      ensureJson = {};
    }
    if (!ensureRes.ok) {
      return json({ ok: false, error: "clearing_account_auto_provision_failed" }, 502);
    }
    payer = ensureJson.data?.data?.clearing_default_payer_sacco_id?.trim() ?? payer;
    merchant = ensureJson.data?.data?.clearing_merchant_sacco_id?.trim() ?? merchant;
  }
  if (!payer || !merchant) {
    return json({ ok: true, skipped: true, reason: "clearing_sacco_ids_not_configured" });
  }

  const transferUrl = `${boatBase}/api/v1/clearing/transfers`;
  const transferBody = {
    from_sacco_id: payer,
    to_sacco_id: merchant,
    amount: Math.round(amountPaid * 100) / 100,
    type: "retail",
    reference: `retail_sale:${saleId}`,
    idempotency_key: `retail_sale:${saleId}`,
    metadata: {
      organization_id: orgId,
      sale_id: saleId,
      payment_status: paymentStatus,
    },
  };

  const res = await fetch(transferUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${clearingApiKey}`,
    },
    body: JSON.stringify(transferBody),
  });

  const raw = await res.text();
  let parsed: { data?: unknown; error?: string; message?: string } = {};
  try {
    parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
  } catch {
    parsed = {};
  }

  if (!res.ok) {
    const msg = parsed.message || parsed.error || raw.slice(0, 300) || res.statusText;
    return json({ ok: false, error: "clearing_transfer_failed", detail: msg, status: res.status }, 502);
  }

  return json({ ok: true, data: parsed.data ?? parsed });
});
