import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizedPhone = (value: string) => {
  const clean = value.replace(/[^\d+]/g, "");
  if (clean.startsWith("+")) return clean;
  if (clean.startsWith("0")) return `+256${clean.slice(1)}`;
  if (clean.startsWith("256")) return `+${clean}`;
  return `+${clean}`;
};

const asMoney = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const flutterwaveSecret = Deno.env.get("FLW_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !flutterwaveSecret) {
    return json({ ok: false, error: "Missing required payment configuration" }, 500);
  }

  const authorization = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData, error: authError } = await authClient.auth.getUser();
  if (authError || !authData.user) return json({ ok: false, error: "Unauthorized" }, 401);

  const payload = await req.json().catch(() => ({})) as { payment_request_id?: string };
  if (!payload.payment_request_id) return json({ ok: false, error: "Payment request is required" }, 400);

  const { data: paymentRequest, error: requestError } = await serviceClient
    .from("marketplace_payment_requests")
    .select("id,customer_id,payment_reference,network,phone_number,amount,currency,status,gateway_transaction_id")
    .eq("id", payload.payment_request_id)
    .maybeSingle();
  if (requestError) return json({ ok: false, error: requestError.message }, 500);
  if (!paymentRequest) return json({ ok: false, error: "Payment request not found" }, 404);

  const { data: customer, error: customerError } = await serviceClient
    .from("marketplace_customers")
    .select("full_name,email,user_id")
    .eq("id", paymentRequest.customer_id)
    .maybeSingle();
  if (customerError) return json({ ok: false, error: customerError.message }, 500);
  if (!customer || customer.user_id !== authData.user.id) return json({ ok: false, error: "Payment request is not yours" }, 403);
  if (paymentRequest.status === "successful") {
    return json({ ok: true, status: "successful", tx_ref: paymentRequest.payment_reference, message: "Payment already confirmed" });
  }
  if (!["initiated", "pending"].includes(paymentRequest.status)) {
    return json({ ok: false, status: paymentRequest.status, tx_ref: paymentRequest.payment_reference, message: "Create a new payment request before trying again" });
  }
  if (paymentRequest.status === "pending" && paymentRequest.gateway_transaction_id) {
    return json({ ok: false, status: "pending", tx_ref: paymentRequest.payment_reference, message: "A mobile money prompt has already been sent. Approve it on your phone or wait for the result." });
  }

  const writeStatus = async (status: string, patch: Record<string, unknown> = {}) => {
    const { error } = await serviceClient.from("marketplace_payment_requests").update({ status, ...patch }).eq("id", paymentRequest.id);
    return error;
  };

  await writeStatus("pending", { last_error: null });
  const baseUrl = Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com/v3";
  const chargeResponse = await fetch(`${baseUrl}/charges?type=mobile_money_uganda`, {
    method: "POST",
    headers: { Authorization: `Bearer ${flutterwaveSecret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: paymentRequest.payment_reference,
      amount: paymentRequest.amount,
      currency: paymentRequest.currency || "UGX",
      email: customer.email || authData.user.email || "no-reply@boat.local",
      phone_number: normalizedPhone(paymentRequest.phone_number),
      fullname: customer.full_name || "BOAT Market customer",
      network: paymentRequest.network,
    }),
  });
  const chargeJson = await chargeResponse.json().catch(() => ({})) as Record<string, unknown>;
  if (!chargeResponse.ok) {
    const message = String(chargeJson.message || "Unable to send the mobile money prompt");
    await writeStatus("failed", { gateway_response: chargeJson, last_error: message });
    return json({ ok: false, status: "failed", tx_ref: paymentRequest.payment_reference, message });
  }

  const chargeData = (chargeJson.data || {}) as Record<string, unknown>;
  const transactionId = Number(chargeData.id);
  if (!Number.isFinite(transactionId) || transactionId <= 0) {
    await writeStatus("failed", { gateway_response: chargeJson, last_error: "Invalid Flutterwave transaction id" });
    return json({ ok: false, status: "failed", tx_ref: paymentRequest.payment_reference, message: "Invalid payment response" });
  }

  await writeStatus("pending", { gateway_transaction_id: transactionId, gateway_response: chargeJson });
  const deadline = Date.now() + 60_000;
  let verification: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    await wait(5_000);
    const verifyResponse = await fetch(`${baseUrl}/transactions/${transactionId}/verify`, { headers: { Authorization: `Bearer ${flutterwaveSecret}` } });
    verification = await verifyResponse.json().catch(() => ({})) as Record<string, unknown>;
    const verificationData = (verification.data || {}) as Record<string, unknown>;
    const status = String(verificationData.status || "").toLowerCase();
    if (status === "successful") {
      const matchingReference = String(verificationData.tx_ref || "") === paymentRequest.payment_reference;
      const matchingCurrency = String(verificationData.currency || paymentRequest.currency).toUpperCase() === String(paymentRequest.currency || "UGX").toUpperCase();
      const matchingAmount = asMoney(verificationData.amount) === asMoney(paymentRequest.amount);
      if (!matchingReference || !matchingCurrency || !matchingAmount) {
        await writeStatus("failed", { gateway_transaction_id: transactionId, gateway_response: verification, last_error: "Gateway payment did not match the request" });
        return json({ ok: false, status: "failed", tx_ref: paymentRequest.payment_reference, message: "Gateway payment did not match the request" });
      }
      const { error: finaliseError } = await serviceClient.rpc("marketplace_finalize_payment", {
        p_payment_reference: paymentRequest.payment_reference,
        p_gateway_transaction_id: transactionId,
        p_gateway_response: verification,
      });
      if (finaliseError) return json({ ok: false, error: finaliseError.message }, 500);
      return json({ ok: true, status: "successful", transaction_id: transactionId, tx_ref: paymentRequest.payment_reference, message: "Payment confirmed" });
    }
    if (status === "failed" || status === "cancelled") {
      const message = String(verification.message || "Mobile money payment was not completed");
      await writeStatus(status === "cancelled" ? "cancelled" : "failed", { gateway_transaction_id: transactionId, gateway_response: verification, last_error: message });
      return json({ ok: false, status, tx_ref: paymentRequest.payment_reference, message });
    }
  }

  await writeStatus("timeout", { gateway_transaction_id: transactionId, gateway_response: verification, last_error: "Payment confirmation timed out" });
  return json({ ok: false, status: "timeout", tx_ref: paymentRequest.payment_reference, message: "Payment prompt is still pending. Try again after confirming it on your phone." });
});
