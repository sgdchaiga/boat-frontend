import { supabase } from "./supabase";

type QueueBase = {
  organizationId: string | null | undefined;
  sourceId: string;
  amount: number;
  purpose: string;
  requestedBy?: string | null;
  vendorId?: string | null;
  payeeName?: string | null;
};

async function upsertTreasuryRequest(payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("treasury_requests")
    .upsert(payload, { onConflict: "organization_id,source_type,source_id" });
  if (error) throw error;
}

export async function isSpendMoneyApprovalEnabled(organizationId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_permissions")
    .select("allowed")
    .eq("organization_id", organizationId)
    .eq("role_key", "__org__")
    .eq("permission_key", "treasury_spend_money_approval_enabled")
    .maybeSingle();
  if (error) throw error;
  return data?.allowed !== false;
}

export async function queueExpenseForTreasury(input: QueueBase): Promise<void> {
  if (!input.organizationId) throw new Error("Your account is not linked to an organization.");
  const releasedAt = new Date().toISOString();
  await upsertTreasuryRequest({
    organization_id: input.organizationId,
    source_type: "expense",
    source_id: input.sourceId,
    request_type: "expense",
    payee_name: input.payeeName || null,
    purpose: input.purpose || "Expense",
    amount: input.amount,
    vendor_id: input.vendorId || null,
    requested_by: input.requestedBy || null,
    status: "disbursed",
    approved_by: input.requestedBy || null,
    approved_at: releasedAt,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    disbursed_by: input.requestedBy || null,
    disbursed_at: releasedAt,
    payment_method: null,
    payment_reference: null,
  });
}

export async function queueApprovedBillForTreasury(input: QueueBase): Promise<void> {
  if (!input.organizationId) throw new Error("Your account is not linked to an organization.");
  await upsertTreasuryRequest({
    organization_id: input.organizationId,
    source_type: "bill",
    source_id: input.sourceId,
    request_type: "supplier_payment",
    payee_name: input.payeeName || null,
    purpose: input.purpose || "Approved supplier bill",
    amount: input.amount,
    vendor_id: input.vendorId || null,
    requested_by: input.requestedBy || null,
    status: "approved",
    approved_by: input.requestedBy || null,
    approved_at: new Date().toISOString(),
  });
}
