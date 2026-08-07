import { supabase } from "@/lib/supabase";

export type LiveActionItem = {
  id: string;
  kind: "unmatched_bank" | "overdue_receivable" | "missing_document";
  title: string;
  explanation: string;
  value: number;
  urgency: "low" | "medium" | "high";
  page: string;
  dueDate: string | null;
};

export async function loadLiveActionItems(organizationId: string): Promise<LiveActionItem[]> {
  const db = supabase as any;
  const today = new Date().toISOString().slice(0, 10);
  const [statementResult, matchedResult, invoiceResult, expenseResult] = await Promise.all([
    db.from("bank_statement_lines").select("id,amount").eq("organization_id", organizationId).limit(500),
    db.from("bank_reconciliation_match_items").select("statement_line_id").not("statement_line_id", "is", null).limit(2000),
    db.from("retail_invoices").select("id,total,due_date,customer_name").eq("organization_id", organizationId).lt("due_date", today).neq("status", "paid").neq("status", "void").limit(100),
    db.from("expenses").select("id,amount,expense_date,description,source_documents").eq("organization_id", organizationId).order("expense_date", { ascending: false }).limit(100),
  ]);
  const items: LiveActionItem[] = [];
  const matchedIds = new Set((matchedResult.data ?? []).map((row: { statement_line_id: string }) => row.statement_line_id));
  const unmatched = (statementResult.data ?? []).filter((row: { id: string }) => !matchedIds.has(row.id));
  if (unmatched.length) items.push({ id: "live-unmatched-bank", kind: "unmatched_bank", title: `${unmatched.length} unmatched bank or mobile-money entries`, explanation: "Statement entries still need to be matched to posted BOAT transactions.", value: unmatched.reduce((sum: number, row: { amount: number }) => sum + Math.abs(Number(row.amount || 0)), 0), urgency: "high", page: "accounting_bank_reconciliation", dueDate: null });
  const overdue = invoiceResult.data ?? [];
  if (overdue.length) items.push({ id: "live-overdue-receivables", kind: "overdue_receivable", title: `${overdue.length} overdue customer balance${overdue.length === 1 ? "" : "s"}`, explanation: "Customer invoices are past their due dates and remain unpaid.", value: overdue.reduce((sum: number, row: { total: number }) => sum + Number(row.total || 0), 0), urgency: "high", page: "retail_credit_invoices", dueDate: overdue.map((row: { due_date: string }) => row.due_date).sort()[0] ?? null });
  const missingDocs = (expenseResult.data ?? []).filter((row: { source_documents: unknown }) => !row.source_documents || (Array.isArray(row.source_documents) && row.source_documents.length === 0));
  if (missingDocs.length) items.push({ id: "live-missing-documents", kind: "missing_document", title: `${missingDocs.length} recent expense${missingDocs.length === 1 ? " is" : "s are"} missing documents`, explanation: "Attach receipts or invoices so reviewers can verify these expenses.", value: missingDocs.reduce((sum: number, row: { amount: number }) => sum + Number(row.amount || 0), 0), urgency: "medium", page: "purchases_expenses", dueDate: null });
  return items;
}
