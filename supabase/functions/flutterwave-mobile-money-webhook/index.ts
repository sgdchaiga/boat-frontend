import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, verif-hash",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const normalizeStatus = (raw: unknown): "pending" | "successful" | "failed" | "cancelled" => {
  const value = String(raw || "").toLowerCase();
  if (value === "successful") return "successful";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  return "pending";
};

const asMoney = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookHash = Deno.env.get("FLW_WEBHOOK_HASH");
  if (!supabaseUrl || !serviceRoleKey || !webhookHash) {
    return json({ ok: false, error: "Missing required env" }, 500);
  }

  const incomingHash = req.headers.get("verif-hash") || req.headers.get("Verif-Hash") || "";
  if (!incomingHash || incomingHash !== webhookHash) {
    return json({ ok: false, error: "Unauthorized webhook" }, 401);
  }

  const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (payload.data || {}) as Record<string, unknown>;
  const txRef = String(data.tx_ref || "");
  const transactionId = Number(data.id);
  const status = normalizeStatus(data.status);

  if (!txRef) {
    return json({ ok: false, error: "Missing tx_ref" }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: existingAttempt, error: lookupError } = await serviceClient
    .from("mobile_money_attempts")
    .select("amount,currency")
    .eq("tx_ref", txRef)
    .maybeSingle();
  if (lookupError) return json({ ok: false, error: lookupError.message }, 500);
  if (!existingAttempt) return json({ ok: true, ignored: true, reason: "attempt_not_found" }, 202);

  const returnedAmount = asMoney(data.amount);
  const expectedAmount = asMoney((existingAttempt as { amount?: unknown }).amount);
  if (Number.isFinite(returnedAmount) && returnedAmount !== expectedAmount) {
    return json({ ok: false, error: "Gateway amount mismatch" }, 400);
  }
  const returnedCurrency = String(data.currency || (existingAttempt as { currency?: string }).currency || "UGX").toUpperCase();
  const expectedCurrency = String((existingAttempt as { currency?: string }).currency || "UGX").toUpperCase();
  if (returnedCurrency !== expectedCurrency) {
    return json({ ok: false, error: "Gateway currency mismatch" }, 400);
  }

  const updatePayload: Record<string, unknown> = {
    status,
    gateway_response: payload,
    updated_at: new Date().toISOString(),
  };
  if (Number.isFinite(transactionId) && transactionId > 0) {
    updatePayload.flutterwave_tx_id = transactionId;
  }
  if (status === "successful") {
    updatePayload.paid_at = new Date().toISOString();
    updatePayload.last_error = null;
  } else if (status === "failed" || status === "cancelled") {
    updatePayload.last_error = String(payload.message || data.processor_response || "Payment not successful");
  }

  const { error } = await serviceClient.from("mobile_money_attempts").update(updatePayload).eq("tx_ref", txRef);
  if (error) return json({ ok: false, error: error.message }, 500);

  const { error: reconcileError } = await serviceClient.rpc("reconcile_mobile_money_attempt", { p_tx_ref: txRef });
  if (reconcileError) return json({ ok: false, error: reconcileError.message }, 500);

  const { error: walletFinalizeError } = await serviceClient.rpc("customer_wallet_mobile_money_finalize", { p_tx_ref: txRef });
  if (walletFinalizeError) return json({ ok: false, error: walletFinalizeError.message }, 500);

  return json({ ok: true });
});
