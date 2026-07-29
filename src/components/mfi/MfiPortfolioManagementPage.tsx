import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export type MfiPortfolioSection = "followups" | "servicing" | "provisioning" | "restructures" | "writeoffs";
type Row = Record<string, any>;

const titles: Record<MfiPortfolioSection, string> = {
  followups: "Collection follow-ups",
  servicing: "Penalties, waivers & interest suspension",
  provisioning: "Classification & provisioning",
  restructures: "Loan restructuring",
  writeoffs: "Write-offs & recoveries",
};
const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";
const actionClass = "inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50";
const money = (value: unknown) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MfiPortfolioManagementPage({ section, readOnly = false }: { section: MfiPortfolioSection; readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [loans, setLoans] = useState<Row[]>([]);
  const [followups, setFollowups] = useState<Row[]>([]);
  const [penalties, setPenalties] = useState<Row[]>([]);
  const [suspensions, setSuspensions] = useState<Row[]>([]);
  const [provisions, setProvisions] = useState<Row[]>([]);
  const [restructures, setRestructures] = useState<Row[]>([]);
  const [writeoffs, setWriteoffs] = useState<Row[]>([]);
  const [recoveries, setRecoveries] = useState<Row[]>([]);
  const [rules, setRules] = useState<Row[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setBusy(true);
    const query = (table: string, select = "*") =>
      supabase.from(table).select(select).eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300);
    const [l, f, p, s, pr, rr, w, rec, cr] = await Promise.all([
      query("mf_loans", "*,mf_borrowers(full_name,borrower_number)"),
      query("mf_collection_followups", "*,mf_loans(loan_number),mf_borrowers(full_name)"),
      query("mf_penalties"),
      query("mf_interest_suspensions"),
      query("mf_provisions"),
      query("mf_restructures"),
      query("mf_writeoffs", "*,mf_loans(loan_number)"),
      query("mf_recoveries"),
      query("mf_classification_rules"),
    ]);
    const error = [l, f, p, s, pr, rr, w, rec, cr].find((r) => r.error)?.error;
    setMessage(error ? `Apply the Phase 2 migration: ${error.message}` : "");
    setLoans(l.data || []); setFollowups(f.data || []); setPenalties(p.data || []);
    setSuspensions(s.data || []); setProvisions(pr.data || []); setRestructures(rr.data || []);
    setWriteoffs(w.data || []); setRecoveries(rec.data || []); setRules(cr.data || []);
    setBusy(false);
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const insert = async (table: string, values: Row, form: HTMLFormElement) => {
    if (!orgId || readOnly) return;
    setBusy(true);
    const { error } = await supabase.from(table).insert({ organization_id: orgId, created_by: user?.id, ...values });
    setMessage(error?.message || "Saved successfully.");
    if (!error) form.reset();
    await refresh();
  };

  const rpc = async (name: string, args: Row, form?: HTMLFormElement) => {
    if (readOnly) return;
    setBusy(true);
    const { error } = await supabase.rpc(name, args);
    setMessage(error?.message || "Action completed successfully.");
    if (!error) form?.reset();
    await refresh();
  };
  const update = async (table: string, id: string, values: Row) => {
    if (!orgId || readOnly) return;
    setBusy(true);
    const { error } = await supabase.from(table).update({ ...values, updated_at: new Date().toISOString(), updated_by: user?.id }).eq("id", id).eq("organization_id", orgId);
    setMessage(error?.message || "Record updated successfully.");
    await refresh();
  };

  const activeLoans = loans.filter((loan) => !["closed", "written_off"].includes(loan.status));
  return <div className="min-h-full bg-slate-50 p-4 sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">BOAT Microfinance · Portfolio Management</p><h1 className="text-2xl font-bold text-slate-900">{titles[section]}</h1></div>
      <button onClick={() => void refresh()} className="rounded-lg border bg-white p-2 text-slate-600"><RefreshCw size={18}/></button>
    </header>
    {message && <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{message}</div>}
    {busy && <div className="h-1 animate-pulse rounded bg-emerald-500"/>}
    {section === "followups" && <Followups loans={activeLoans} rows={followups} disabled={readOnly||busy} onSave={insert} onUpdate={update} onRefresh={() => rpc("mf_refresh_arrears",{p_organization_id:orgId,p_as_of_date:new Date().toISOString().slice(0,10)})}/>}
    {section === "servicing" && <Servicing loans={activeLoans} penalties={penalties} suspensions={suspensions} disabled={readOnly||busy} onSave={insert} onRpc={rpc}/>}
    {section === "provisioning" && <Provisioning orgId={orgId} loans={activeLoans} provisions={provisions} rules={rules} disabled={readOnly||busy} onSave={insert} onUpdate={update} onRpc={rpc}/>}
    {section === "restructures" && <Restructures loans={activeLoans} rows={restructures} disabled={readOnly||busy} onRpc={rpc}/>}
    {section === "writeoffs" && <Writeoffs loans={activeLoans} writeoffs={writeoffs} recoveries={recoveries} disabled={readOnly||busy} onRpc={rpc}/>}
  </div></div>;
}

function Followups({ loans, rows, disabled, onSave, onUpdate, onRefresh }: any) {
  const edit=(r:Row)=>{const response=prompt("Borrower response",r.borrower_response||"");if(response===null)return;const next=prompt("Next action",r.next_action||"");if(next===null)return;const date=prompt("Next follow-up date",r.followup_date||"");if(date===null)return;void onUpdate("mf_collection_followups",r.id,{borrower_response:response,next_action:next,followup_date:date||null});};
  return <div className="space-y-5"><div className="flex justify-end"><button className={actionClass} disabled={disabled} onClick={onRefresh}>Refresh arrears</button></div>
    <div className="grid gap-5 xl:grid-cols-[390px_1fr]"><Panel title="Log borrower contact"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f),loan=loans.find((x:Row)=>x.id===d.get("loan"));void onSave("mf_collection_followups",{loan_id:loan.id,borrower_id:loan.borrower_id,amount_overdue:Number(loan.outstanding_interest||0)+Number(loan.outstanding_fees||0)+Number(loan.outstanding_penalties||0),days_overdue:Number(loan.days_past_due||0),contact_date:d.get("date"),contact_method:d.get("method"),borrower_response:d.get("response"),promise_to_pay_amount:Number(d.get("promiseAmount")||0)||null,promise_date:d.get("promiseDate")||null,followup_date:d.get("followupDate")||null,next_action:d.get("nextAction"),status:d.get("promiseDate")?"promise_pending":"open"},f)}}><LoanSelect loans={loans}/><Input name="date" label="Contact date" type="date" required/><Select name="method" label="Contact method" options={["phone","sms","email","field_visit","other"]}/><Input name="response" label="Borrower response" required/><Input name="promiseAmount" label="Promise amount" type="number"/><Input name="promiseDate" label="Promise date" type="date"/><Input name="followupDate" label="Next follow-up" type="date"/><Input name="nextAction" label="Next action"/><Submit disabled={disabled}>Save follow-up</Submit></form></Panel><Table headers={["Loan","Borrower","Contact","Promise","Follow-up","Status","Action"]} rows={rows.map((r:Row)=>[r.mf_loans?.loan_number,r.mf_borrowers?.full_name,r.contact_date,r.promise_date?`${money(r.promise_to_pay_amount)} by ${r.promise_date}`:"—",r.followup_date,r.status,<Action key={r.id} disabled={disabled} onClick={()=>edit(r)}>Edit</Action>])}/></div></div>;
}

function Servicing({ loans, penalties, suspensions, disabled, onSave, onRpc }: any) {
  return <div className="space-y-5"><div className="grid gap-5 xl:grid-cols-3">
    <Panel title="Post penalty"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f),loan=loans.find((x:Row)=>x.id===d.get("loan"));void onSave("mf_penalties",{loan_id:loan.id,penalty_date:d.get("date"),calculation_basis:"fixed",amount:Number(d.get("amount")),reason:d.get("reason")},f)}}><LoanSelect loans={loans}/><Input name="date" label="Penalty date" type="date" required/><Input name="amount" label="Amount" type="number" required/><Input name="reason" label="Reason" required/><Submit disabled={disabled}>Post penalty</Submit></form></Panel>
    <Panel title="Approve waiver"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onRpc("mf_apply_waiver",{p_loan_id:d.get("loan"),p_component:d.get("component"),p_amount:Number(d.get("amount")),p_reason:d.get("reason"),p_source_record_id:null},f)}}><LoanSelect loans={loans}/><Select name="component" label="Component" options={["penalty","fee","interest"]}/><Input name="amount" label="Amount" type="number" required/><Input name="reason" label="Reason" required/><Submit disabled={disabled}>Approve waiver</Submit></form></Panel>
    <Panel title="Interest control"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onRpc(d.get("action")==="suspend"?"mf_suspend_interest":"mf_resume_interest",d.get("action")==="suspend"?{p_loan_id:d.get("loan"),p_reason:d.get("reason"),p_automatic:false}:{p_loan_id:d.get("loan"),p_reason:d.get("reason")},f)}}><LoanSelect loans={loans}/><Select name="action" label="Action" options={["suspend","resume"]}/><Input name="reason" label="Reason" required/><Submit disabled={disabled}>Apply control</Submit></form></Panel>
  </div><div className="grid gap-5 xl:grid-cols-2"><Table headers={["Loan","Date","Penalty","Paid","Waived","Status"]} rows={penalties.map((r:Row)=>[shortLoan(loans,r.loan_id),r.penalty_date,money(r.amount),money(r.amount_paid),money(r.amount_waived),r.status])}/><Table headers={["Loan","Action","Effective","Outstanding","Reason"]} rows={suspensions.map((r:Row)=>[shortLoan(loans,r.loan_id),r.action,r.effective_date,money(r.interest_outstanding),r.reason])}/></div></div>;
}

function Provisioning({ orgId, loans, provisions, rules, disabled, onSave, onUpdate, onRpc }: any) {
  const total=provisions.reduce((s:number,r:Row)=>s+Number(r.required_provision||0),0);
  const gross=loans.reduce((s:number,r:Row)=>s+Number(r.outstanding_principal||0),0);
  const editRule=(r:Row)=>{const rate=prompt("Provision rate (%)",String(r.provision_rate));if(rate===null)return;const max=prompt("Maximum days past due (blank for no maximum)",r.max_days_past_due==null?"":String(r.max_days_past_due));if(max===null)return;void onUpdate("mf_classification_rules",r.id,{provision_rate:Number(rate),max_days_past_due:max===""?null:Number(max)});};
  return <div className="space-y-5"><Cards items={[["Gross portfolio",money(gross)],["Required provision",money(total)],["Net portfolio",money(gross-total)],["Provisioned loans",provisions.length]]}/><div className="grid gap-5 xl:grid-cols-[380px_1fr]"><Panel title="Classification rule"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onSave("mf_classification_rules",{name:d.get("name"),min_days_past_due:Number(d.get("min")),max_days_past_due:d.get("max")?Number(d.get("max")):null,provision_rate:Number(d.get("rate")),sort_order:Number(d.get("min")),is_active:true},f)}}><Input name="name" label="Classification" placeholder="Watch" required/><Input name="min" label="Minimum days past due" type="number" required/><Input name="max" label="Maximum days past due" type="number"/><Input name="rate" label="Provision rate (%)" type="number" required/><Submit disabled={disabled}>Save rule</Submit></form><button className={`${actionClass} mt-3 w-full`} disabled={disabled||!rules.length} onClick={()=>onRpc("mf_calculate_provisions",{p_organization_id:orgId,p_calculation_date:new Date().toISOString().slice(0,10)})}>Calculate provisions</button></Panel><div className="space-y-5"><Table headers={["Classification","DPD range","Rate","Action"]} rows={rules.map((r:Row)=>[r.name,`${r.min_days_past_due} – ${r.max_days_past_due??"above"}`,`${r.provision_rate}%`,<Action key={r.id} disabled={disabled} onClick={()=>editRule(r)}>Edit</Action>])}/><Table headers={["Loan","Date","Classification","Principal","Rate","Required"]} rows={provisions.map((r:Row)=>[shortLoan(loans,r.loan_id),r.calculation_date,r.classification,money(r.outstanding_principal),`${r.provision_rate}%`,money(r.required_provision)])}/></div></div></div>;
}

function Restructures({ loans, rows, disabled, onRpc }: any) {
  return <div className="grid gap-5 xl:grid-cols-[420px_1fr]"><Panel title="Restructure loan"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f),terms:Row={};if(d.get("term"))terms.term=Number(d.get("term"));if(d.get("frequency"))terms.frequency=d.get("frequency");if(d.get("rate"))terms.rate=Number(d.get("rate"));if(d.get("firstDue"))terms.first_repayment_date=d.get("firstDue");void onRpc("mf_restructure_loan",{p_loan_id:d.get("loan"),p_type:d.get("type"),p_reason:d.get("reason"),p_new_terms:terms},f)}}><LoanSelect loans={loans}/><Select name="type" label="Restructure type" options={["term_extension","frequency_change","installment_reduction","rate_change","capitalization","refinance","top_up","moratorium"]}/><Input name="term" label="New term" type="number"/><Select name="frequency" label="New frequency" options={["","daily","weekly","fortnightly","monthly","quarterly"]}/><Input name="rate" label="New interest rate (%)" type="number"/><Input name="firstDue" label="New first repayment date" type="date"/><Input name="reason" label="Reason" required/><p className="text-xs text-slate-500">The current schedule is archived. A new schedule version can then be generated from the approved terms.</p><Submit disabled={disabled}>Approve restructuring</Submit></form></Panel><Table headers={["Loan","Type","Principal at restructure","Old version","Status","Date"]} rows={rows.map((r:Row)=>[shortLoan(loans,r.loan_id),r.restructure_type,money(r.outstanding_principal),r.old_schedule_version,r.status,String(r.created_at||"").slice(0,10)])}/></div>;
}

function Writeoffs({ loans, writeoffs, recoveries, disabled, onRpc }: any) {
  return <div className="space-y-5"><div className="grid gap-5 xl:grid-cols-2"><Panel title="Approve write-off"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onRpc("mf_writeoff_loan",{p_loan_id:d.get("loan"),p_writeoff_date:d.get("date"),p_reason:d.get("reason")},f)}}><LoanSelect loans={loans}/><Input name="date" label="Write-off date" type="date" required/><Input name="reason" label="Approval reason" required/><p className="text-xs text-slate-500">The loan and all historical transactions remain intact.</p><Submit disabled={disabled}>Approve write-off</Submit></form></Panel><Panel title="Record recovery"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onRpc("mf_record_recovery",{p_writeoff_id:d.get("writeoff"),p_amount:Number(d.get("amount")),p_recovery_date:d.get("date"),p_payment_method:d.get("method"),p_external_reference:d.get("reference")},f)}}><label className="block text-sm font-medium">Written-off loan<select required name="writeoff" className={inputClass}><option value="">Select…</option>{writeoffs.map((r:Row)=><option key={r.id} value={r.id}>{r.mf_loans?.loan_number} · {money(r.principal_written_off)}</option>)}</select></label><Input name="amount" label="Recovery amount" type="number" required/><Input name="date" label="Recovery date" type="date" required/><Select name="method" label="Payment method" options={["cash","bank","mobile_money","cheque","transfer"]}/><Input name="reference" label="External reference" required/><Submit disabled={disabled}>Record recovery</Submit></form></Panel></div><div className="grid gap-5 xl:grid-cols-2"><Table headers={["Loan","Date","Principal","Interest","Status"]} rows={writeoffs.map((r:Row)=>[r.mf_loans?.loan_number,r.writeoff_date,money(r.principal_written_off),money(r.interest_written_off),r.status])}/><Table headers={["Loan","Date","Amount","Method","Reference"]} rows={recoveries.map((r:Row)=>[shortLoan(loans,r.loan_id),r.recovery_date,money(r.amount),r.payment_method,r.external_reference])}/></div></div>;
}

function shortLoan(loans: Row[], id: string) { return loans.find((x)=>x.id===id)?.loan_number || String(id||"").slice(0,8); }
function LoanSelect({ loans }: { loans: Row[] }) { return <label className="block text-sm font-medium">Loan<select name="loan" required className={inputClass}><option value="">Select…</option>{loans.map(r=><option key={r.id} value={r.id}>{r.loan_number} · {r.mf_borrowers?.full_name}</option>)}</select></label>; }
function Panel({ title, children }: any) { return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-bold text-slate-900">{title}</h2>{children}</section>; }
function Input({ label, ...props }: any) { return <label className="block text-sm font-medium text-slate-700">{label}<input {...props} className={inputClass}/></label>; }
function Select({ label, options, ...props }: any) { return <label className="block text-sm font-medium text-slate-700">{label}<select {...props} className={inputClass}>{options.map((o:string)=><option key={o} value={o}>{o?o.replaceAll("_"," "):"Keep current"}</option>)}</select></label>; }
function Submit({ children, disabled }: any) { return <button disabled={disabled} className={`${actionClass} w-full`}>{children}</button>; }
function Action({children,disabled,onClick}:any){return <button type="button" disabled={disabled} onClick={onClick} className="rounded border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-40">{children}</button>}
function Cards({ items }: {items:any[][]}) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(([label,value])=><div key={label} className="rounded-xl border bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold">{value}</p></div>)}</div>; }
function Table({ headers, rows }: {headers:string[];rows:any[][]}) { return <div className="overflow-x-auto rounded-xl border bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-left text-xs uppercase text-slate-600"><tr>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i} className="border-t">{r.map((c,j)=><td key={j} className="whitespace-nowrap px-4 py-3">{c??"—"}</td>)}</tr>):<tr><td colSpan={headers.length} className="p-8 text-center text-slate-500">No records yet.</td></tr>}</tbody></table></div>; }
