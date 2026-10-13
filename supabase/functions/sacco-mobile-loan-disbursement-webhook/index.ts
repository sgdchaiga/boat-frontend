import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const expected = Deno.env.get("FLW_WEBHOOK_HASH"), incoming = req.headers.get("verif-hash") ?? "";
  if (!expected || incoming !== expected) return json({ ok: false, error: "Unauthorized webhook" }, 401);
  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const reference = String(data.reference ?? data.tx_ref ?? "");
  const providerId = String(data.id ?? "");
  if (!reference || !providerId) return json({ ok: false, error: "Incomplete provider event" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const status = String(data.status ?? "").toLowerCase();
  if (status === "successful") {
    const { error } = await db.rpc("finalize_sacco_mobile_loan_disbursement", { p_provider_reference: reference, p_provider_transaction_id: providerId, p_provider_response: payload });
    if (error) return json({ ok: false, error: error.message }, 500);
  } else if (["failed", "cancelled"].includes(status)) {
    await db.from("sacco_loan_disbursements").update({ status: "failed", failure_reason: String(data.processor_response ?? "Provider did not complete payout"), provider_response: payload }).eq("provider_reference", reference).eq("status", "processing");
  }
  return json({ ok: true });
});
