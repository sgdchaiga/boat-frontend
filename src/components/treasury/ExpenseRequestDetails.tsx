import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Expense = { description: string; expense_date: string; amount: number; vendor_id: string | null };
type Line = {
  id: string; vendor_id: string | null; expense_gl_account_id: string; source_cash_gl_account_id: string;
  amount: number; vat_amount: number; bank_charges: number; quantity: number | null; comment: string | null;
  vat_gl_account_id: string | null; bank_charges_gl_account_id: string | null;
};
type Details = { expense: Expense; lines: Line[]; accounts: Record<string, string>; vendors: Record<string, string> };
const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 2 });

export function ExpenseRequestDetails({ expenseId, organizationId, payee }: { expenseId: string; organizationId: string; payee: string | null }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError("");
    async function load() {
      const expenseResult = await supabase.from("expenses").select("description,expense_date,amount,vendor_id").eq("id", expenseId).eq("organization_id", organizationId).single();
      if (expenseResult.error) throw expenseResult.error;
      const expense = expenseResult.data as Expense;
      const lineResult = await supabase.from("expense_lines").select("id,vendor_id,expense_gl_account_id,source_cash_gl_account_id,amount,vat_amount,bank_charges,quantity,comment,vat_gl_account_id,bank_charges_gl_account_id").eq("expense_id", expenseId).order("sort_order");
      if (lineResult.error) throw lineResult.error;
      const lines = (lineResult.data || []) as Line[];
      const accountIds = [...new Set(lines.flatMap(line => [line.expense_gl_account_id, line.source_cash_gl_account_id, line.vat_gl_account_id, line.bank_charges_gl_account_id]).filter((id): id is string => !!id))];
      const vendorIds = [...new Set([expense.vendor_id, ...lines.map(line => line.vendor_id)].filter((id): id is string => !!id))];
      const [accounts, vendors] = await Promise.all([
        accountIds.length ? supabase.from("gl_accounts").select("id,account_code,account_name").eq("organization_id", organizationId).in("id", accountIds) : Promise.resolve({ data: [], error: null }),
        vendorIds.length ? supabase.from("vendors").select("id,name").eq("organization_id", organizationId).in("id", vendorIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (accounts.error) throw accounts.error;
      if (vendors.error) throw vendors.error;
      if (!cancelled) setDetails({ expense, lines, accounts: Object.fromEntries((accounts.data || []).map(a => [a.id, `${a.account_code} — ${a.account_name}`])), vendors: Object.fromEntries((vendors.data || []).map(v => [v.id, v.name])) });
    }
    void load().catch(() => { if (!cancelled) setError("Unable to load expense details. Please retry."); });
    return () => { cancelled = true; };
  }, [expenseId, organizationId, attempt]);

  if (error) return <div role="alert" className="text-rose-700">{error} <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>;
  if (!details) return <p role="status" className="text-slate-500">Loading expense details...</p>;
  const { expense, lines, accounts, vendors } = details;
  const expensePayee = expense.vendor_id ? vendors[expense.vendor_id] || "Payee unavailable" : payee || "Not specified";
  const account = (id: string | null) => id ? accounts[id] || `Unavailable account (${id})` : "Not specified";
  return <div className="space-y-4">
    <h3 className="font-semibold text-slate-900">Expense details</h3>
    <dl className="grid gap-3 sm:grid-cols-3">
      <div><dt className="text-slate-500">Payee</dt><dd className="whitespace-pre-wrap break-words">{expensePayee}</dd></div>
      <div><dt className="text-slate-500">Expense date</dt><dd>{expense.expense_date}</dd></div>
      <div><dt className="text-slate-500">Total amount</dt><dd className="font-semibold">{money.format(expense.amount)}</dd></div>
      <div className="sm:col-span-3"><dt className="text-slate-500">Description</dt><dd className="whitespace-pre-wrap break-words">{expense.description || "Not specified"}</dd></div>
    </dl>
    {lines.length === 0 ? <p className="text-slate-500">No line items recorded for this expense.</p> : <div className="overflow-x-auto"><table className="min-w-full text-left text-sm">
      <thead className="text-xs text-slate-500"><tr>{["Payee", "Description", "GL accounts", "Quantity", "Net amount", "VAT", "Bank charges", "Line total"].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-slate-200">{lines.map(line => <tr key={line.id}>
        <td className="px-3 py-3 align-top">{line.vendor_id ? vendors[line.vendor_id] || "Payee unavailable" : expensePayee}</td>
        <td className="min-w-48 whitespace-pre-wrap break-words px-3 py-3 align-top">{line.comment || expense.description || "Not specified"}</td>
        <td className="min-w-64 space-y-1 px-3 py-3 align-top"><p><span className="text-slate-500">Expense: </span>{account(line.expense_gl_account_id)}</p><p><span className="text-slate-500">Source of funds: </span>{account(line.source_cash_gl_account_id)}</p>{(line.vat_gl_account_id || Number(line.vat_amount) > 0) && <p><span className="text-slate-500">VAT: </span>{account(line.vat_gl_account_id)}</p>}{(line.bank_charges_gl_account_id || Number(line.bank_charges) > 0) && <p><span className="text-slate-500">Bank charges: </span>{account(line.bank_charges_gl_account_id)}</p>}</td>
        <td className="px-3 py-3 align-top">{line.quantity ?? 1}</td>
        {[Number(line.amount), Number(line.vat_amount || 0), Number(line.bank_charges || 0), Number(line.amount) + Number(line.vat_amount || 0) + Number(line.bank_charges || 0)].map((amount, index) => <td key={index} className="whitespace-nowrap px-3 py-3 text-right align-top">{money.format(amount)}</td>)}
      </tr>)}</tbody>
    </table></div>}
  </div>;
}
