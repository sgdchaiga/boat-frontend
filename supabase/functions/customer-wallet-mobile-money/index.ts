import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RequestBody = {
  action: "wallet_topup" | "wallet_bill_payment";
  wallet_id: string;
  amount: number;
  network: "mtn" | "airtel";
  phone_number: string;
  retail_invoice_id?: string | null;
  customer_name?: string;
  customer_email?: string;
  timeout_seconds?: number;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const cleanPhone = (raw: string) => raw.replace(/[^\d+]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ ok: false, error: "Missing Supabase function env" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: authErr } = await authClient.auth.getUser();
  if (authErr || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const amount = Number(body.amount);
  if (!body.wallet_id || !Number.isFinite(amount) || amount <= 0 || !body.phone_number) {
    return json({ ok: false, error: "wallet_id, phone_number, and positive amount are required" }, 400);
  }
  if (body.action === "wallet_bill_payment" && !body.retail_invoice_id) {
    return json({ ok: false, error: "retail_invoice_id is required for bill payment" }, 400);
  }

  const staffRes = await authClient.from("staff").select("organization_id").eq("id", userData.user.id).maybeSingle();
  if (staffRes.error) return json({ ok: false, error: staffRes.error.message }, 500);
  const orgId = (staffRes.data as { organization_id?: string | null } | null)?.organization_id ?? null;
  if (!orgId) return json({ ok: false, error: "Authenticated staff organization not found" }, 403);

  const walletRes = await serviceClient
    .from("wallets")
    .select("id, organization_id, customer_kind, hotel_customer_id, retail_customer_id, student_id")
    .eq("id", body.wallet_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (walletRes.error) return json({ ok: false, error: walletRes.error.message }, 500);
  if (!walletRes.data) return json({ ok: false, error: "Wallet not found for this organization" }, 404);

  if (body.action === "wallet_bill_payment") {
    const invoiceRes = await serviceClient
      .from("retail_invoices")
      .select("id, organization_id, customer_id, property_customer_id, total, status, invoice_number")
      .eq("id", body.retail_invoice_id)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (invoiceRes.error) return json({ ok: false, error: invoiceRes.error.message }, 500);
    if (!invoiceRes.data) return json({ ok: false, error: "Invoice not found for this organization" }, 404);
    if (invoiceRes.data.status === "void") return json({ ok: false, error: "Cannot pay a void invoice" }, 400);
  }

  const orgRes = await serviceClient
    .from("organizations")
    .select("retail_mobile_money_gateway")
    .eq("id", orgId)
    .maybeSingle();
  if (orgRes.error) return json({ ok: false, error: orgRes.error.message }, 500);
  const gateway = String((orgRes.data as { retail_mobile_money_gateway?: string | null } | null)?.retail_mobile_money_gateway || "flutterwave");
  const functionName = gateway === "dpo" ? "dpo-mobile-money" : "flutterwave-mobile-money";
  const paymentMethod = body.network === "airtel" ? "airtel_money" : "mtn_mobile_money";
  const txRef = `wallet-${body.action}-${crypto.randomUUID()}`;

  const gatewayRes = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "collect",
      network: body.network,
      amount,
      currency: "UGX",
      phone_number: cleanPhone(body.phone_number),
      customer_name: body.customer_name || "Wallet customer",
      customer_email: body.customer_email || userData.user.email || "no-reply@boat.local",
      tx_ref: txRef,
      organization_id: orgId,
      payment_method: paymentMethod,
      timeout_seconds: body.timeout_seconds ?? 60,
    }),
  });

  const gatewayJson = (await gatewayRes.json().catch(() => ({}))) as Record<string, unknown>;

  await serviceClient
    .from("mobile_money_attempts")
    .update({
      purpose: body.action,
      wallet_id: body.wallet_id,
      retail_invoice_id: body.action === "wallet_bill_payment" ? body.retail_invoice_id : null,
      customer_kind: walletRes.data.customer_kind,
      hotel_customer_id: walletRes.data.hotel_customer_id,
      retail_customer_id: walletRes.data.retail_customer_id,
      student_id: walletRes.data.student_id,
    })
    .eq("tx_ref", txRef)
    .eq("organization_id", orgId);

  let finalize: unknown = null;
  if (gatewayRes.ok && String(gatewayJson.status || "").toLowerCase() === "successful") {
    const fin = await serviceClient.rpc("customer_wallet_mobile_money_finalize", { p_tx_ref: txRef });
    finalize = fin.data ?? (fin.error ? { ok: false, error: fin.error.message } : null);
  }

  return json(
    {
      ok: gatewayRes.ok,
      tx_ref: txRef,
      gateway,
      gateway_result: gatewayJson,
      finalize,
    },
    gatewayRes.ok ? 200 : gatewayRes.status
  );
});
