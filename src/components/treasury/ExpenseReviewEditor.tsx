import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isCashEquivalentAccount } from "@/lib/cashFlowStatement";
import { validateExpenseReviewLines, type ExpenseReviewLine } from "@/lib/expenseReview";

type Account = { id: string; account_code: string; account_name: string; account_type: string; category: string | null; is_active: boolean };
type Vendor = { id: string; name: string };
type Expense = { description: string; expense_date: string; vendor_id: string | null };
const inputClass = "w-full min-w-32 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

export function ExpenseReviewEditor({ organizationId, requestId, updatedAt, expense, lines, payee, bankChargesAccountId, onCancel, onSaved }: {
  organizationId: string; requestId: string; updatedAt: string; expense: Expense; lines: ExpenseReviewLine[];
  payee: string | null; bankChargesAccountId: string | null; onCancel: () => void; onSaved: () => Promise<void>;
}) {
  const [draftExpense, setDraftExpense] = useState({ ...expense, payee_name: payee || "" });
  const [draftLines, setDraftLines] = useState<ExpenseReviewLine[]>(lines.map(line => ({ ...line, quantity: line.quantity ?? 1, bank_charges_gl_account_id: line.bank_charges_gl_account_id || bankChargesAccountId })));
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const accountRows: Account[] = []; const vendorRows: Vendor[] = [];
      await Promise.all([
        (async () => { for (let offset=0; ;offset+=1000) {
          const result=await supabase.from("gl_accounts").select("id,account_code,account_name,account_type,category,is_active").eq("organization_id",organizationId).order("id").range(offset,offset+999);
          if(result.error) throw result.error; accountRows.push(...result.data as Account[]); if(result.data.length<1000) break;
        } })(),
        (async () => { for (let offset=0; ;offset+=1000) {
          const result=await supabase.from("vendors").select("id,name").eq("organization_id",organizationId).order("id").range(offset,offset+999);
          if(result.error) throw result.error; vendorRows.push(...result.data as Vendor[]); if(result.data.length<1000) break;
        } })(),
      ]);
      if(!cancelled) { setAccounts(accountRows.sort((a,b)=>a.account_code.localeCompare(b.account_code))); setVendors(vendorRows.sort((a,b)=>a.name.localeCompare(b.name))); }
    }
    void load().catch(cause=>{if(!cancelled)setError(cause?.message||"Unable to load editing options.");}).finally(()=>{if(!cancelled)setLoading(false);});
    return ()=>{cancelled=true;};
  },[organizationId]);
  const updateLine = (id: string, patch: Partial<ExpenseReviewLine>) => setDraftLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line));
  const accountSelect = (value: string | null, update: (value: string) => void, label: string, funding=false) => <select aria-label={label} className={inputClass} value={value || ""} onChange={event=>update(event.target.value)}><option value="">Choose account</option>{accounts.filter(account=>account.id===value || (account.is_active && (!funding||isCashEquivalentAccount(account)))).map(account=><option key={account.id} value={account.id} disabled={!account.is_active}>{account.account_code} — {account.account_name}{account.is_active ? "" : " (inactive)"}</option>)}</select>;
  const vendorSelect = (value: string | null, update: (value: string | null) => void, label: string) => <select aria-label={label} className={inputClass} value={value || ""} onChange={event=>update(event.target.value || null)}><option value="">Use transaction payee</option>{vendors.map(vendor=><option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select>;
  const numberInput = (line: ExpenseReviewLine, key: "amount" | "quantity" | "vat_amount" | "bank_charges", label: string) => <input aria-label={label} className={inputClass} type="number" min={key==="quantity" ? "0.001" : "0"} step={key==="quantity" ? "any" : "0.01"} value={Number.isFinite(Number(line[key])) ? line[key] ?? "" : ""} onChange={event=>updateLine(line.id,{[key]:event.target.value==="" ? NaN : Number(event.target.value)})} />;
  const save = async () => {
    setError("");
    try {
      validateExpenseReviewLines(draftLines);
      if(!draftExpense.expense_date || !draftExpense.description.trim()) throw new Error("Date and transaction particulars are required.");
      setSaving(true);
      const result=await supabase.rpc("review_treasury_expense",{p_request_id:requestId,p_expected_updated_at:updatedAt,p_changes:{...draftExpense,lines:draftLines},p_approve:false,p_bank_charges_account_id:bankChargesAccountId});
      if(result.error) throw result.error;
      await onSaved();
    } catch(cause) { setError(String((cause as {message?:string})?.message || "Unable to save changes.")); }
    finally { setSaving(false); }
  };
  return <div className="space-y-3">
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    {loading && <p role="status">Loading editing options...</p>}
    <fieldset disabled={loading||saving} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><label>Date<input type="date" className={inputClass} value={draftExpense.expense_date} onChange={event=>setDraftExpense({...draftExpense,expense_date:event.target.value})} /></label><label>Payee{vendorSelect(draftExpense.vendor_id,vendor_id=>setDraftExpense({...draftExpense,vendor_id}),"Transaction payee")}</label>
        {!draftExpense.vendor_id && <label>Payee name<input className={inputClass} value={draftExpense.payee_name} onChange={event=>setDraftExpense({...draftExpense,payee_name:event.target.value})} /></label>}
        <label className="sm:col-span-2">Transaction particulars<textarea className={inputClass} value={draftExpense.description} onChange={event=>setDraftExpense({...draftExpense,description:event.target.value})} /></label></div>
      <p className="text-xs text-slate-600">Net amount is the whole entry amount, including its quantity. Saving keeps this expense pending approval.</p>
      <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr>{["Entry","Payee","Particulars","Expense GL account","Net amount","Source of funds","Quantity"].map(label=><th key={label} className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{draftLines.map((line,index)=><tr key={line.id} className="border-t border-slate-200">
        <td className="px-2 py-3 align-top">{index+1}</td><td className="px-2 py-3 align-top">{vendorSelect(line.vendor_id,vendor_id=>updateLine(line.id,{vendor_id}),`Entry ${index+1} payee`)}</td><td className="px-2 py-3 align-top"><textarea aria-label={`Entry ${index+1} particulars`} className={`${inputClass} min-w-48`} value={line.comment || ""} onChange={event=>updateLine(line.id,{comment:event.target.value})} /></td>
        <td className="min-w-64 px-2 py-3 align-top">{accountSelect(line.expense_gl_account_id,expense_gl_account_id=>updateLine(line.id,{expense_gl_account_id}),`Entry ${index+1} GL account`)}</td><td className="px-2 py-3 align-top">{numberInput(line,"amount",`Entry ${index+1} net amount`)}</td><td className="min-w-64 px-2 py-3 align-top">{accountSelect(line.source_cash_gl_account_id,source_cash_gl_account_id=>updateLine(line.id,{source_cash_gl_account_id}),`Entry ${index+1} funding account`,true)}</td><td className="px-2 py-3 align-top">{numberInput(line,"quantity",`Entry ${index+1} quantity`)}</td>
      </tr>)}</tbody></table></div>
      <details className="rounded border border-slate-200 p-3" open={draftLines.some(line=>Number(line.vat_amount)>0||Number(line.bank_charges)>0)}><summary className="cursor-pointer font-medium">VAT and bank charges</summary><div className="mt-3 space-y-3">{draftLines.map((line,index)=><div key={line.id} className="grid gap-2 sm:grid-cols-4"><label>Entry {index+1} VAT{numberInput(line,"vat_amount",`Entry ${index+1} VAT`)}</label><label>VAT GL{accountSelect(line.vat_gl_account_id||line.expense_gl_account_id,vat_gl_account_id=>updateLine(line.id,{vat_gl_account_id}),`Entry ${index+1} VAT account`)}</label><label>Bank charges{numberInput(line,"bank_charges",`Entry ${index+1} bank charges`)}</label><label>Bank charges GL{accountSelect(line.bank_charges_gl_account_id,bank_charges_gl_account_id=>updateLine(line.id,{bank_charges_gl_account_id}),`Entry ${index+1} bank charges account`)}</label></div>)}</div></details>
      <p className="font-semibold">Revised expense total: {new Intl.NumberFormat("en-UG",{style:"currency",currency:"UGX",maximumFractionDigits:2}).format(draftLines.reduce((sum,line)=>sum+[line.amount,line.vat_amount,line.bank_charges].reduce((subtotal,value)=>subtotal+(Number.isFinite(Number(value)) ? Math.round(Number(value)*100)/100 : 0),0),0))}</p>
      <button type="button" onClick={()=>void save()} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white">{saving ? "Saving..." : "Save changes"}</button>
    </fieldset>
    <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-slate-300 px-4 py-2">Cancel editing</button>
  </div>;
}
