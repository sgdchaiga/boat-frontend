import { supabase } from "./supabase";
import { createJournalForExpenseWithLines, type ExpenseJournalLineInput } from "./journal";

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

export async function setSpendMoneyApprovalEnabled(organizationId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from("organization_permissions").upsert({
    organization_id: organizationId,
    role_key: "__org__",
    permission_key: "treasury_spend_money_approval_enabled",
    allowed: enabled,
  }, { onConflict: "organization_id,role_key,permission_key" });
  if (error) throw error;
}

export async function approveExpenseAndPost(input: {
  organizationId: string;
  expenseId: string;
  approvedBy: string | null;
}): Promise<void> {
  const [expenseResult, linesResult, requestResult] = await Promise.all([
    supabase.from("expenses").select("expense_date,status").eq("id", input.expenseId).eq("organization_id", input.organizationId).single(),
    supabase.from("expense_lines").select("expense_gl_account_id,source_cash_gl_account_id,amount,bank_charges,vat_amount,vat_gl_account_id,bank_charges_gl_account_id,comment,quantity").eq("expense_id", input.expenseId).order("sort_order"),
    supabase.from("treasury_requests").select("id,status").eq("organization_id", input.organizationId).eq("source_type", "expense").eq("source_id", input.expenseId).maybeSingle(),
  ]);
  if (expenseResult.error) throw expenseResult.error;
  if (linesResult.error) throw linesResult.error;
  if (requestResult.error) throw requestResult.error;
  if (expenseResult.data.status === "cancelled") throw new Error("Cancelled spending cannot be approved.");
  if (requestResult.data?.status !== "pending_approval") throw new Error("This spending entry is no longer pending approval.");

  const journal = await createJournalForExpenseWithLines(
    input.expenseId,
    expenseResult.data.expense_date,
    linesResult.data as ExpenseJournalLineInput[],
    input.approvedBy
  );
  if (!journal.ok) throw new Error(journal.error);

  const now = new Date().toISOString();
  const { error } = await supabase.from("treasury_requests").update({
    status: "disbursed",
    approved_by: input.approvedBy,
    approved_at: now,
    disbursed_by: input.approvedBy,
    disbursed_at: now,
  }).eq("id", requestResult.data.id).eq("status", "pending_approval");
  if (error) throw error;
}

export async function queueExpenseForTreasury(input: QueueBase): Promise<void> {
  if (!input.organizationId) throw new Error("Your account is not linked to an organization.");
  const approvalEnabled = await isSpendMoneyApprovalEnabled(input.organizationId);
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
    status: approvalEnabled ? "pending_approval" : "disbursed",
    approved_by: approvalEnabled ? null : input.requestedBy || null,
    approved_at: approvalEnabled ? null : releasedAt,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    disbursed_by: approvalEnabled ? null : input.requestedBy || null,
    disbursed_at: approvalEnabled ? null : releasedAt,
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
