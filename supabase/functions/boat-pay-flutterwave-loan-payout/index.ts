import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
type PayoutRequest = { intent_id?: string; phone_number?: string; network?: "mtn" | "airtel" };
type PayoutIntent = { id: string; organization_id: string; purpose: string; provider: string; channel: string; provider_reference: string; amount: number; currency: string; status: string };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), secret = Deno.env.get("FLW_SECRET_KEY");
  if (!url || !anonKey || !serviceKey || !secret) return json({ ok: false, error: "Missing BOAT Pay payout configuration" }, 500);
  const authorization = request.headers.get("Authorization") ?? "";
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData } = await auth.auth.getUser();
  if (!userData.user) return json({ ok: false, error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({})) as PayoutRequest;
  if (!body.intent_id || !body.phone_number || !body.network) return json({ ok: false, error: "Payment request, mobile number, and network are required" }, 400);
  const staff = await auth.from("staff").select("organization_id").eq("id", userData.user.id).maybeSingle();
  if (!staff.data?.organization_id) return json({ ok: false, error: "Authenticated staff organization not found" }, 403);
  const role = await auth.rpc("vsla_v12_actor_has_role", { p_organization_id: staff.data.organization_id, p_group_id: null, p_roles: ["chairperson", "treasurer"] });
  if (role.error || !role.data) return json({ ok: false, error: "Your VSLA role cannot send a digital payout" }, 403);

  const db = createClient(url, serviceKey);
  const { data: connection } = await db.from("boat_pay_provider_connections").select("enabled,module_codes").eq("provider_code", "flutterwave").maybeSingle();
  if (!connection?.enabled || !(connection.module_codes as string[]).includes("vsla")) return json({ ok: false, error: "Flutterwave is not enabled for BOAT Pay VSLA payouts" }, 409);
  const { data: intentData, error: intentError } = await db.from("boat_pay_payment_intents").select("id,organization_id,purpose,provider,channel,provider_reference,amount,currency,status").eq("id", body.intent_id).eq("organization_id", staff.data.organization_id).maybeSingle();
  if (intentError) return json({ ok: false, error: intentError.message }, 500);
  const intent = intentData as PayoutIntent | null;
  if (!intent || !["loan_disbursement", "shareout_payout"].includes(intent.purpose) || intent.provider !== "flutterwave" || intent.channel !== "mobile_money") return json({ ok: false, error: "Eligible BOAT Pay mobile-money payout request not found" }, 404);
  if (intent.status !== "created") return json({ ok: false, error: `Payout request is ${intent.status}; reconcile the existing provider payout instead of sending another instruction` }, 409);
  const { data: claimed } = await db.from("boat_pay_payment_intents").update({ status: "provider_pending" }).eq("id", intent.id).eq("status", "created").select("id").maybeSingle();
  if (!claimed) return json({ ok: false, error: "Payout request is already being processed" }, 409);

  const base = Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com/v3";
  const transfer = await fetch(`${base}/transfers`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ account_bank: body.network === "mtn" ? "MPS" : "AIRTEL", account_number: body.phone_number, amount: intent.amount, narration: intent.purpose === "loan_disbursement" ? "BOAT VSLA loan disbursement" : "BOAT VSLA share-out payout", currency: intent.currency, reference: intent.provider_reference, callback_url: `${url}/functions/v1/boat-pay-provider-webhook`, debit_currency: intent.currency }) });
  const payload = await transfer.json().catch(() => ({})) as Record<string, unknown>;
  const providerId = String((payload.data as Record<string, unknown> | undefined)?.id ?? "");
  if (!transfer.ok || !providerId) {
    const message = String(payload.message ?? "Provider rejected the payout");
    await db.rpc("boat_pay_record_payment_event", { p_organization_id: intent.organization_id, p_provider: "flutterwave", p_provider_reference: intent.provider_reference, p_provider_transaction_id: null, p_channel: "mobile_money", p_direction: "outgoing", p_amount: intent.amount, p_currency: intent.currency, p_status: "failed", p_occurred_at: new Date().toISOString(), p_failure_reason: message, p_payload_digest: null, p_module_code: "vsla" });
    await db.from("boat_pay_payment_intents").update({ status: "failed" }).eq("id", intent.id).eq("status", "provider_pending");
    return json({ ok: false, status: "failed", error: message }, 502);
  }
  return json({ ok: true, status: "provider_pending", reference: intent.provider_reference, provider_transaction_id: providerId }, 202);
});
