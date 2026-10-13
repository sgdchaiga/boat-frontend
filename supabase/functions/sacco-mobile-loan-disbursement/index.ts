import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Disbursement = { id: string; organization_id: string; amount: number; currency: string; phone_number: string; network: "mtn" | "airtel"; status: string; provider: string; provider_reference: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), flwKey = Deno.env.get("FLW_SECRET_KEY");
  if (!url || !anon || !serviceKey || !flwKey) return json({ ok: false, error: "Missing payment service configuration" }, 500);
  const authorization = req.headers.get("Authorization") ?? "";
  const auth = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
  const { data: user } = await auth.auth.getUser();
  if (!user.user) return json({ ok: false, error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as { disbursement_id?: string };
  if (!body.disbursement_id) return json({ ok: false, error: "Disbursement id is required" }, 400);
  const staff = await auth.from("staff").select("organization_id").eq("id", user.user.id).maybeSingle();
  if (!staff.data?.organization_id) return json({ ok: false, error: "Only SACCO staff may send a disbursement" }, 403);
  const db = createClient(url, serviceKey);
  const found = await db.from("sacco_loan_disbursements").select("*").eq("id", body.disbursement_id).eq("organization_id", staff.data.organization_id).maybeSingle();
  if (found.error) return json({ ok: false, error: found.error.message }, 500);
  const row = found.data as Disbursement | null;
  if (!row) return json({ ok: false, error: "Disbursement not found" }, 404);
  if (row.status === "paid") return json({ ok: true, status: "paid", reference: row.provider_reference });
  if (row.status !== "authorized") return json({ ok: false, error: `Disbursement is ${row.status}` }, 409);
  // Atomic claim makes a double click/retry harmless; only this worker owns the provider call.
  const claimed = await db.from("sacco_loan_disbursements").update({ status: "processing", processed_at: new Date().toISOString() }).eq("id", row.id).eq("status", "authorized").select("*").maybeSingle();
  if (claimed.error) return json({ ok: false, error: claimed.error.message }, 500);
  if (!claimed.data) return json({ ok: false, error: "Disbursement is already being processed" }, 409);
  const base = Deno.env.get("FLW_BASE_URL") || "https://api.flutterwave.com/v3";
  // Flutterwave transfer credentials and the SACCO's payout arrangement are deliberately server-only.
  const transfer = await fetch(`${base}/transfers`, { method: "POST", headers: { Authorization: `Bearer ${flwKey}`, "Content-Type": "application/json" }, body: JSON.stringify({
    account_bank: row.network === "mtn" ? "MPS" : "AIRTEL",
    account_number: row.phone_number,
    amount: row.amount,
    narration: "BOAT SACCO loan disbursement",
    currency: row.currency,
    reference: row.provider_reference,
    callback_url: `${url}/functions/v1/sacco-mobile-loan-disbursement-webhook`,
    debit_currency: row.currency,
  }) });
  const payload = await transfer.json().catch(() => ({})) as Record<string, unknown>;
  const providerId = String((payload.data as Record<string, unknown> | undefined)?.id ?? "");
  if (!transfer.ok || !providerId) {
    const message = String(payload.message ?? "Provider rejected the payout");
    await db.from("sacco_loan_disbursements").update({ status: "failed", failure_reason: message, provider_response: payload }).eq("id", row.id);
    return json({ ok: false, status: "failed", error: message }, 502);
  }
  await db.from("sacco_loan_disbursements").update({ provider_transaction_id: providerId, provider_response: payload }).eq("id", row.id);
  return json({ ok: true, status: "processing", reference: row.provider_reference, provider_transaction_id: providerId }, 202);
});
