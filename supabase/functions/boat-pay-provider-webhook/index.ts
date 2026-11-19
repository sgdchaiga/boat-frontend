import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const asMoney = (value: unknown) => { const number = Number(value); return Number.isFinite(number) ? Math.round(number * 100) / 100 : Number.NaN; };
const status = (raw: unknown): "received" | "verified" | "failed" | "reversed" | "refunded" => {
  const value = String(raw ?? "").toLowerCase();
  if (["successful", "success", "completed"].includes(value)) return "verified";
  if (["failed", "cancelled", "canceled"].includes(value)) return "failed";
  if (["reversed", "chargeback"].includes(value)) return "reversed";
  if (["refunded", "refund"].includes(value)) return "refunded";
  return "received";
};
const digest = async (payload: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload))))).map((part) => part.toString(16).padStart(2, "0")).join("");

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), webhookHash = Deno.env.get("FLW_WEBHOOK_HASH");
  if (!url || !serviceKey || !webhookHash) return json({ ok: false, error: "Missing BOAT Pay webhook configuration" }, 500);
  if ((request.headers.get("verif-hash") ?? request.headers.get("Verif-Hash") ?? "") !== webhookHash) return json({ ok: false, error: "Unauthorized webhook" }, 401);

  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const reference = String(data.tx_ref ?? data.reference ?? "").trim();
  if (!reference) return json({ ok: false, error: "Missing provider reference" }, 400);
  const db = createClient(url, serviceKey);
  const { data: connection, error: connectionError } = await db.from("boat_pay_provider_connections").select("enabled,module_codes").eq("provider_code", "flutterwave").maybeSingle();
  if (connectionError) return json({ ok: false, error: connectionError.message }, 500);
  if (!connection?.enabled || !(connection.module_codes as string[]).includes("vsla")) return json({ ok: true, ignored: true, reason: "provider_not_enabled" }, 202);
  const { data: intent, error: intentError } = await db.from("boat_pay_payment_intents").select("organization_id,purpose,amount,currency,channel").eq("module_code", "vsla").eq("provider", "flutterwave").eq("provider_reference", reference).maybeSingle();
  if (intentError) return json({ ok: false, error: intentError.message }, 500);
  if (!intent) return json({ ok: true, ignored: true, reason: "payment_intent_not_found" }, 202);
  if (asMoney(data.amount) !== asMoney(intent.amount) || String(data.currency ?? "UGX").toUpperCase() !== String(intent.currency).toUpperCase()) return json({ ok: false, error: "Provider amount or currency mismatch" }, 400);

  const direction = ["loan_disbursement", "expense", "shareout_payout"].includes(String(intent.purpose)) ? "outgoing" : "incoming";
  const { error: eventError } = await db.rpc("boat_pay_record_payment_event", {
    p_organization_id: intent.organization_id, p_provider: "flutterwave", p_provider_reference: reference,
    p_provider_transaction_id: String(data.id ?? "") || null, p_channel: intent.channel, p_direction: direction,
    p_amount: intent.amount, p_currency: intent.currency, p_status: status(data.status), p_occurred_at: new Date().toISOString(),
    p_failure_reason: status(data.status) === "failed" ? String(data.processor_response ?? payload.message ?? "Provider did not complete payment") : null,
    p_payload_digest: await digest(payload), p_module_code: "vsla",
  });
  if (eventError) return json({ ok: false, error: eventError.message }, 500);
  return json({ ok: true });
});
