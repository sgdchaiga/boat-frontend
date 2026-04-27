import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CollectRequest = {
  action: "collect";
  network: "mtn" | "airtel";
  amount: number;
  currency?: string;
  phone_number: string;
  customer_name?: string;
  customer_email?: string;
  tx_ref: string;
  sale_id?: string;
  organization_id?: string | null;
  payment_method?: string;
  timeout_seconds?: number;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

type AttemptStatus = "initiated" | "pending" | "successful" | "failed" | "timeout" | "cancelled";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const secretKey = Deno.env.get("FLW_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !secretKey) {
    return json({ ok: false, error: "Missing required env" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: authErr } = await authClient.auth.getUser();
  if (authErr || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);

  const payload = (await req.json()) as CollectRequest;
  if (payload.action !== "collect") return json({ ok: false, error: "Unsupported action" }, 400);
  if (!payload.phone_number || !payload.tx_ref || !Number.isFinite(payload.amount) || payload.amount <= 0) {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  const baseUrl = Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com/v3";
  const timeoutSeconds = Math.min(Math.max(payload.timeout_seconds ?? 60, 15), 60);
  const staffOrgRes = await authClient.from("staff").select("organization_id").eq("id", userData.user.id).maybeSingle();
  const organizationId = payload.organization_id ?? ((staffOrgRes.data as { organization_id?: string | null } | null)?.organization_id ?? null);

  const writeAttempt = async (status: AttemptStatus, patch: Record<string, unknown> = {}) => {
    await serviceClient.from("mobile_money_attempts").upsert(
      {
        tx_ref: payload.tx_ref,
        sale_id: payload.sale_id ?? null,
        organization_id: organizationId,
        payment_method: payload.payment_method ?? payload.network,
        network: payload.network,
        phone_number: payload.phone_number,
        amount: payload.amount,
        currency: payload.currency || "UGX",
        status,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tx_ref" }
    );
  };

  const withRetry = async <T>(
    work: () => Promise<T>,
    maxAttempts: number,
    onFail: (error: unknown, attempt: number) => Promise<void>
  ) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        lastError = error;
        await onFail(error, attempt);
        if (attempt < maxAttempts) {
          await wait(1000 * Math.pow(2, attempt));
        }
      }
    }
    throw lastError;
  };

  await writeAttempt("initiated");
  const chargeBody = {
    tx_ref: payload.tx_ref,
    amount: payload.amount,
    currency: payload.currency || "UGX",
    email: payload.customer_email || userData.user.email || "no-reply@boat.local",
    phone_number: payload.phone_number,
    fullname: payload.customer_name || "Retail Customer",
    network: payload.network,
  };

  const chargeJson = await withRetry(
    async () => {
      const chargeRes = await fetch(`${baseUrl}/charges?type=mobile_money_uganda`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(chargeBody),
      });
      const parsed = (await chargeRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!chargeRes.ok) {
        throw new Error(String(parsed.message || "Failed to send mobile money prompt"));
      }
      return parsed;
    },
    3,
    async (error, attempt) => {
      await writeAttempt("pending", {
        gateway_response: { stage: "charge_attempt", attempt, error: String(error) },
        attempts: attempt,
        last_error: String(error),
      });
    }
  );
  const chargeData = (chargeJson.data || {}) as Record<string, unknown>;
  const transactionId = Number(chargeData.id);
  if (!Number.isFinite(transactionId) || transactionId <= 0) {
    await writeAttempt("failed", { gateway_response: chargeJson, last_error: "Invalid Flutterwave transaction id" });
    return json({ ok: false, status: "failed", message: "Invalid Flutterwave transaction id", raw: chargeJson }, 400);
  }

  await writeAttempt("pending", {
    flutterwave_tx_id: transactionId,
    gateway_response: chargeJson,
    attempts: 1,
    last_error: null,
  });

  const deadline = Date.now() + timeoutSeconds * 1000;
  let verifyAttempts = 0;
  while (Date.now() < deadline) {
    await wait(5000);
    verifyAttempts += 1;
    const verifyRes = await fetch(`${baseUrl}/transactions/${transactionId}/verify`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const verifyJson = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
    const verifyData = (verifyJson.data || {}) as Record<string, unknown>;
    const txStatus = String(verifyData.status || "").toLowerCase();

    if (txStatus === "successful") {
      await writeAttempt("successful", {
        flutterwave_tx_id: transactionId,
        gateway_response: verifyJson,
        attempts: verifyAttempts,
        paid_at: new Date().toISOString(),
        last_error: null,
      });
      return json({
        ok: true,
        status: "successful",
        transaction_id: transactionId,
        tx_ref: payload.tx_ref,
        message: "Payment confirmed",
      });
    }
    if (txStatus === "failed" || txStatus === "cancelled") {
      await writeAttempt(txStatus === "cancelled" ? "cancelled" : "failed", {
        flutterwave_tx_id: transactionId,
        gateway_response: verifyJson,
        attempts: verifyAttempts,
        last_error: String(verifyJson.message || "Payment failed"),
      });
      return json({
        ok: false,
        status: "failed",
        transaction_id: transactionId,
        tx_ref: payload.tx_ref,
        message: String(verifyJson.message || "Payment failed"),
      }, 400);
    }
  }

  await writeAttempt("timeout", {
    flutterwave_tx_id: transactionId,
    attempts: verifyAttempts,
    last_error: "Payment timed out",
  });
  return json({
    ok: false,
    status: "timeout",
    transaction_id: transactionId,
    tx_ref: payload.tx_ref,
    message: "Payment timed out",
  }, 408);
});
