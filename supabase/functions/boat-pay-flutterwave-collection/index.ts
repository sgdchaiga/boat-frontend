import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type CollectionRequest = { intent_id?: string; phone_number?: string; network?: "mtn" | "airtel"; customer_name?: string };
type PaymentIntent = { id: string; organization_id: string; purpose: "savings" | "loan_repayment"; provider: string; channel: string; provider_reference: string; amount: number; currency: string; status: string };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anonKey = Deno.env.get("SUPABASE_ANON_KEY"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ ok: false, error: "Missing BOAT Pay service configuration" }, 500);
  const authorization = request.headers.get("Authorization") ?? "";
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await auth.auth.getUser();
  if (userError || !userData.user) return json({ ok: false, error: "Unauthorized" }, 401);
  const body = await request.json().catch(() => ({})) as CollectionRequest;
  if (!body.intent_id || !body.phone_number || !body.network) return json({ ok: false, error: "Payment request, mobile number, and network are required" }, 400);

  const staff = await auth.from("staff").select("organization_id").eq("id", userData.user.id).maybeSingle();
  if (!staff.data?.organization_id) return json({ ok: false, error: "Authenticated staff organization not found" }, 403);
  const role = await auth.rpc("vsla_v12_actor_has_role", { p_organization_id: staff.data.organization_id, p_group_id: null, p_roles: ["chairperson", "treasurer"] });
  if (role.error || !role.data) return json({ ok: false, error: "Your VSLA role cannot request a BOAT Pay collection" }, 403);

  const db = createClient(url, serviceKey);
  const { data: connection, error: connectionError } = await db.from("boat_pay_provider_connections").select("enabled,module_codes").eq("provider_code", "flutterwave").maybeSingle();
  if (connectionError) return json({ ok: false, error: connectionError.message }, 500);
  if (!connection?.enabled || !(connection.module_codes as string[]).includes("vsla")) return json({ ok: false, error: "Flutterwave is not enabled for BOAT Pay VSLA collections" }, 409);
  const { data: intentData, error: intentError } = await db.from("boat_pay_payment_intents").select("id,organization_id,purpose,provider,channel,provider_reference,amount,currency,status").eq("id", body.intent_id).eq("organization_id", staff.data.organization_id).maybeSingle();
  if (intentError) return json({ ok: false, error: intentError.message }, 500);
  const intent = intentData as PaymentIntent | null;
  if (!intent || intent.provider !== "flutterwave" || intent.channel !== "mobile_money" || !["savings", "loan_repayment"].includes(intent.purpose)) return json({ ok: false, error: "Eligible BOAT Pay mobile-money collection request not found" }, 404);
  if (intent.status !== "created") return json({ ok: false, error: `Collection request is ${intent.status}; reconcile the existing provider request instead of sending another prompt` }, 409);
  const { data: claimed } = await db.from("boat_pay_payment_intents").update({ status: "provider_pending" }).eq("id", intent.id).eq("status", "created").select("id").maybeSingle();
  if (!claimed) return json({ ok: false, error: "Collection request is already being processed" }, 409);

  // Reuse BOAT's existing Flutterwave service. This adapter owns only VSLA intent
  // validation and normalizes its confirmed result into the shared payment inbox.
  const providerResponse = await fetch(`${url}/functions/v1/flutterwave-mobile-money`, {
    method: "POST", headers: { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "collect", network: body.network, amount: intent.amount, currency: intent.currency, phone_number: body.phone_number, customer_name: body.customer_name ?? "VSLA member", tx_ref: intent.provider_reference, organization_id: intent.organization_id, payment_method: "vsla_boat_pay" }),
  });
  const providerPayload = await providerResponse.json().catch(() => ({})) as Record<string, unknown>;
  const successful = providerResponse.ok && providerPayload.ok === true && providerPayload.status === "successful";
  const terminalFailure = !providerResponse.ok && providerPayload.status === "failed";
  if (successful || terminalFailure) {
    const { error: recordError } = await db.rpc("boat_pay_record_payment_event", {
      p_organization_id: intent.organization_id, p_provider: "flutterwave", p_provider_reference: intent.provider_reference,
      p_provider_transaction_id: successful ? String(providerPayload.transaction_id ?? "") || null : null, p_channel: "mobile_money", p_direction: "incoming",
      p_amount: intent.amount, p_currency: intent.currency, p_status: successful ? "verified" : "failed", p_occurred_at: new Date().toISOString(),
      p_failure_reason: successful ? null : String(providerPayload.message ?? "Provider did not complete collection"), p_payload_digest: null, p_module_code: "vsla",
    });
    if (recordError) return json({ ok: false, error: recordError.message }, 500);
  }
  if (terminalFailure) await db.from("boat_pay_payment_intents").update({ status: "failed" }).eq("id", intent.id).eq("status", "provider_pending");
  return json(providerPayload, providerResponse.status);
});
