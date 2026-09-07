import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { resolveBankChargesGlAccountId } from "@/lib/journal";
import { expenseReviewEntries } from "@/lib/expenseReview";
import { ExpenseReviewEditor } from "./ExpenseReviewEditor";

type Expense = { description: string; expense_date: string; amount: number; vendor_id: string | null };
type Line = {
  id: string; vendor_id: string | null; expense_gl_account_id: string; source_cash_gl_account_id: string;
  amount: number; vat_amount: number; bank_charges: number; quantity: number | null; comment: string | null;
  vat_gl_account_id: string | null; bank_charges_gl_account_id: string | null;
};
type Details = { expense: Expense; lines: Line[]; accounts: Record<string, string>; vendors: Record<string, string>; updatedAt: string; status: string; bankChargesAccountId: string | null };
const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 2 });

export function ExpenseRequestDetails({ expenseId, organizationId, requestId, payee, canEdit, onEditingChange, onSaved }: { expenseId: string; organizationId: string; requestId: string; payee: string | null; canEdit: boolean; onEditingChange: (editing: boolean) => void; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => () => onEditingChange(false), [onEditingChange]);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError("");
    async function load() {
      const requestResult = await supabase.from("treasury_requests").select("updated_at,status").eq("id", requestId).eq("organization_id", organizationId).eq("source_id", expenseId).single();
      if (requestResult.error) throw requestResult.error;
      const expenseResult = await supabase.from("expenses").select("description,expense_date,amount,vendor_id").eq("id", expenseId).eq("organization_id", organizationId).single();
      if (expenseResult.error) throw expenseResult.error;
      const expense = expenseResult.data as Expense;
      const lineResult = await supabase.from("expense_lines").select("id,vendor_id,expense_gl_account_id,source_cash_gl_account_id,amount,vat_amount,bank_charges,quantity,comment,vat_gl_account_id,bank_charges_gl_account_id").eq("expense_id", expenseId).order("sort_order");
      if (lineResult.error) throw lineResult.error;
      const lines = (lineResult.data || []) as Line[];
      const bankChargesAccountId = lines.some(line => Number(line.bank_charges) > 0 && !line.bank_charges_gl_account_id) ? await resolveBankChargesGlAccountId(organizationId) : null;
      const accountIds = [...new Set([...lines.flatMap(line => [line.expense_gl_account_id, line.source_cash_gl_account_id, line.vat_gl_account_id, line.bank_charges_gl_account_id]), bankChargesAccountId].filter((id): id is string => !!id))];
      const vendorIds = [...new Set([expense.vendor_id, ...lines.map(line => line.vendor_id)].filter((id): id is string => !!id))];
      const [accounts, vendors] = await Promise.all([
        accountIds.length ? supabase.from("gl_accounts").select("id,account_code,account_name").eq("organization_id", organizationId).in("id", accountIds) : Promise.resolve({ data: [], error: null }),
        vendorIds.length ? supabase.from("vendors").select("id,name").eq("organization_id", organizationId).in("id", vendorIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (accounts.error) throw accounts.error;
      if (vendors.error) throw vendors.error;
      const latestRequest = await supabase.from("treasury_requests").select("updated_at").eq("id", requestId).eq("organization_id", organizationId).single();
      if (latestRequest.error) throw latestRequest.error;
      if (latestRequest.data.updated_at !== requestResult.data.updated_at) throw new Error("Expense changed while loading. Retry to view its latest entries.");
      if (!cancelled) setDetails({ expense, lines, updatedAt: requestResult.data.updated_at, status: requestResult.data.status, bankChargesAccountId, accounts: Object.fromEntries((accounts.data || []).map(a => [a.id, `${a.account_code} — ${a.account_name}`])), vendors: Object.fromEntries((vendors.data || []).map(v => [v.id, v.name])) });
    }
    void load().catch(cause => { if (!cancelled) setError(cause?.message || "Unable to load expense details. Please retry."); });
    return () => { cancelled = true; };
  }, [expenseId, organizationId, requestId, attempt]);

  if (error) return <div role="alert" className="text-rose-700">{error} <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!details) return <p role="status" className="text-slate-500">Loading expense details...</p>;
  const { expense, lines, accounts, vendors } = details;
  const expensePayee = expense.vendor_id ? vendors[expense.vendor_id] || "Payee unavailable" : payee || "Not specified";
  const account = (id: string | null) => id ? accounts[id] || `Unavailable account (${id})` : "Not specified";
  const entries = expenseReviewEntries(lines, expense.description, details.bankChargesAccountId);
  const debitTotal = entries.filter(entry => entry.direction === "Debit").reduce((sum, entry) => sum + entry.amount, 0);
  const creditTotal = entries.filter(entry => entry.direction === "Credit").reduce((sum, entry) => sum + entry.amount, 0);
  const stopEditing = () => { setEditing(false); onEditingChange(false); };
  if (editing) return <ExpenseReviewEditor organizationId={organizationId} requestId={requestId} updatedAt={details.updatedAt} expense={expense} lines={lines} payee={payee} bankChargesAccountId={details.bankChargesAccountId} onCancel={stopEditing} onSaved={async () => { stopEditing(); await onSaved(); setAttempt(value => value + 1); }} />;
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-slate-900">Transaction entries</h3>{canEdit && details.status === "pending_approval" && <button type="button" className="rounded-lg border border-blue-300 bg-white px-3 py-2 font-semibold text-blue-700" onClick={() => { setEditing(true); onEditingChange(true); }}>Edit before approval</button>}</div>
    <dl className="grid gap-3 sm:grid-cols-3">
      <div><dt className="text-slate-500">Payee</dt><dd className="whitespace-pre-wrap break-words">{expensePayee}</dd></div>
      <div><dt className="text-slate-500">Expense date</dt><dd>{expense.expense_date}</dd></div>
      <div><dt className="text-slate-500">Total amount</dt><dd className="font-semibold">{money.format(expense.amount)}</dd></div>
      <div className="sm:col-span-3"><dt className="text-slate-500">Description</dt><dd className="whitespace-pre-wrap break-words">{expense.description || "Not specified"}</dd></div>
    </dl>
    {entries.length === 0 ? <p className="text-slate-500">No transaction entries recorded for this expense.</p> : <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-left text-sm">
      <thead className="bg-slate-100 text-xs text-slate-600"><tr>{["Date", "Entry", "Payee", "Particulars", "GL account", "Debit / Credit", "Amount"].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-200">{entries.map(entry => <tr key={entry.id} className="bg-white">
        <td className="whitespace-nowrap px-3 py-3 align-top">{expense.expense_date}</td><td className="px-3 py-3 align-top">{entry.line}</td><td className="px-3 py-3 align-top">{entry.vendorId ? vendors[entry.vendorId] || "Payee unavailable" : expensePayee}</td><td className="min-w-48 whitespace-pre-wrap break-words px-3 py-3 align-top">{entry.particulars}</td><td className="min-w-64 px-3 py-3 align-top">{account(entry.glAccountId)}</td><td className="px-3 py-3 align-top">{entry.direction}</td><td className="whitespace-nowrap px-3 py-3 text-right font-medium align-top">{money.format(entry.amount)}</td>
      </tr>)}</tbody><tfoot className="bg-slate-100 font-semibold"><tr><td colSpan={5} className="px-3 py-3">Total debits: {money.format(debitTotal)} · Total credits: {money.format(creditTotal)}</td><td colSpan={2} className="px-3 py-3 text-right">{Math.abs(debitTotal-creditTotal)<0.005 ? "Balanced" : "Out of balance"}</td></tr></tfoot>
    </table></div>}
  </div>;
}
