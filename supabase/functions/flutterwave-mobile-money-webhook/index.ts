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
  const updatePayload: Record<string, unknown> = {
    tx_ref: txRef,
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

  const { error } = await serviceClient.from("mobile_money_attempts").upsert(updatePayload, { onConflict: "tx_ref" });
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true });
});
