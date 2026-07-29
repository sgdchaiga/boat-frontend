import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, Save, Send, Landmark } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { downloadMfiConnectWorkbook } from "@/lib/mfiIntegration";

type Row = Record<string, any>;
const mappingFields = [
  ["loan_principal_receivable_id","Loan principal receivable"],
  ["interest_receivable_id","Interest receivable"],
  ["interest_income_id","Interest income"],
  ["processing_fee_income_id","Processing-fee income"],
  ["loan_form_income_id","Loan-form income"],
  ["insurance_account_id","Insurance payable / income"],
  ["penalty_income_id","Penalty income"],
  ["cash_account_id","Cash"],
  ["bank_account_id","Bank"],
  ["mobile_money_account_id","Mobile money"],
  ["loan_loss_provision_id","Loan-loss provision"],
  ["provision_expense_id","Provision expense"],
  ["writeoff_expense_id","Write-off expense"],
  ["written_off_recovery_income_id","Written-off recovery income"],
  ["suspended_interest_account_id","Suspended interest"],
] as const;
const selectClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const buttonClass = "inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const mfiChart = [
  ["1000","Assets","asset","other"],["1110","Cash on hand","asset","cash"],
  ["1120","Bank account","asset","cash"],["1130","Mobile money account","asset","cash"],
  ["1210","Loan principal receivable","asset","receivable"],["1220","Interest receivable","asset","receivable"],
  ["1240","Suspended interest memorandum","asset","receivable"],["1290","Allowance for loan losses","asset","receivable"],
  ["2000","Liabilities","liability","other"],["2110","Accounts payable","liability","payable"],
  ["2120","Insurance payable","liability","payable"],["2140","Borrower overpayments","liability","payable"],
  ["3000","Equity","equity","other"],["3100","Owner capital","equity","other"],
  ["3200","Retained earnings","equity","other"],["4000","Income","income","revenue"],
  ["4100","Interest income on loans","income","revenue"],["4110","Processing fee income","income","revenue"],
  ["4120","Loan form fee income","income","revenue"],["4140","Penalty income","income","revenue"],
  ["4160","Written-off loan recovery income","income","revenue"],["5000","Operating expenses","expense","expense"],
  ["5100","Salaries and wages","expense","expense"],["5110","Rent expense","expense","expense"],
  ["5120","Utilities","expense","expense"],["5130","Transport and field visits","expense","expense"],
  ["5140","Communication expense","expense","expense"],["5150","Bank and mobile-money charges","expense","expense"],
  ["5200","Loan-loss provision expense","expense","expense"],["5210","Loan write-off expense","expense","expense"],
] as const;
const mfiAccountCodes: ReadonlySet<string> = new Set<string>(mfiChart.map(([code]) => code));

export function MfiIntegrationPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [accounts,setAccounts]=useState<Row[]>([]);
  const [settings,setSettings]=useState<Row>({});
  const [repayments,setRepayments]=useState<Row[]>([]);
  const [disbursements,setDisbursements]=useState<Row[]>([]);
  const [imports,setImports]=useState<Row[]>([]);
  const [reconciliation,setReconciliation]=useState<Row|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  const refresh=useCallback(async()=>{
    if(!orgId)return;
    setBusy(true);
    const [a,s,r,d,i,rec]=await Promise.all([
      supabase.from("gl_accounts").select("id,account_code,account_name,account_type").eq("organization_id",orgId).eq("is_active",true).order("account_code"),
      supabase.from("mf_accounting_settings").select("*").eq("organization_id",orgId).maybeSingle(),
      supabase.from("mf_repayments").select("*,mf_loans(loan_number)").eq("organization_id",orgId).eq("status","pending_posting").order("payment_date"),
      supabase.from("mf_disbursements").select("*,mf_loans(loan_number)").eq("organization_id",orgId).is("journal_entry_id",null).order("disbursed_at"),
      supabase.from("mf_sync_imports").select("*").eq("organization_id",orgId).order("started_at",{ascending:false}).limit(50),
      supabase.rpc("mf_loan_subledger_reconciliation",{p_organization_id:orgId,p_as_of:new Date().toISOString().slice(0,10)}),
    ]);
    setAccounts((a.data||[]).filter((account:Row)=>mfiAccountCodes.has(String(account.account_code))));setSettings(s.data||{});setRepayments(r.data||[]);setDisbursements(d.data||[]);setImports(i.data||[]);
    setReconciliation(rec.data?.[0]||null);
    const error=[a,s,r,d,i,rec].find(x=>x.error)?.error;setMessage(error?`Apply the Phase 3 migration: ${error.message}`:"");
    setBusy(false);
  },[orgId]);
  useEffect(()=>{void refresh()},[refresh]);

  const save=async()=>{
    if(!orgId||readOnly)return;
    setBusy(true);
    const payload:Row={organization_id:orgId,updated_by:user?.id,updated_at:new Date().toISOString()};
    mappingFields.forEach(([key])=>payload[key]=settings[key]||null);
    const {error}=await supabase.from("mf_accounting_settings").upsert(payload,{onConflict:"organization_id"});
    setMessage(error?.message||"GL mappings saved.");await refresh();
  };
  const post=async(name:string,id:string)=>{
    if(readOnly)return;setBusy(true);const {error}=await supabase.rpc(name,name==="mf_post_repayment"?{p_repayment_id:id}:{p_disbursement_id:id});
    setMessage(error?.message||"Posted to BOAT general ledger.");await refresh();
  };
  const seedChart=async()=>{
    if(!orgId||readOnly)return;setBusy(true);
    const {data,error}=await supabase.rpc("seed_microfinance_chart_of_accounts",{p_organization_id:orgId});
    if(!error){
      setMessage(`Microfinance chart of accounts ready${Number(data||0)>0?` · ${data} accounts added`:""}.`);
      await refresh();
      return;
    }
    const missingRpc=error.code==="PGRST202"||error.message?.includes("seed_microfinance_chart_of_accounts")||error.message?.includes("404")||error.message?.includes("function max(uuid)");
    if(!missingRpc){setMessage(error.message);setBusy(false);return;}
    const existingCodes=new Set(accounts.map(a=>String(a.account_code)));
    const missing=mfiChart.filter(([code])=>!existingCodes.has(code)).map(([account_code,account_name,account_type,category])=>({
      organization_id:orgId,account_code,account_name,account_type,category,is_active:true,
    }));
    if(missing.length){
      const {error:insertError}=await supabase.from("gl_accounts").insert(missing);
      if(insertError){setMessage(`Chart setup failed: ${insertError.message}. Apply migration 20260724110000.`);setBusy(false);return;}
    }
    const {data:fresh,error:freshError}=await supabase.from("gl_accounts").select("id,account_code").eq("organization_id",orgId).eq("is_active",true);
    if(freshError){setMessage(freshError.message);setBusy(false);return;}
    const byCode=new Map((fresh||[]).map((a:Row)=>[a.account_code,a.id]));
    const mapping:Row={organization_id:orgId,updated_by:user?.id,updated_at:new Date().toISOString()};
    const codes:Record<string,string>={loan_principal_receivable_id:"1210",interest_receivable_id:"1220",interest_income_id:"4100",processing_fee_income_id:"4110",loan_form_income_id:"4120",insurance_account_id:"2120",penalty_income_id:"4140",cash_account_id:"1110",bank_account_id:"1120",mobile_money_account_id:"1130",loan_loss_provision_id:"1290",provision_expense_id:"5200",writeoff_expense_id:"5210",written_off_recovery_income_id:"4160",suspended_interest_account_id:"1240"};
    Object.entries(codes).forEach(([key,code])=>mapping[key]=byCode.get(code)||null);
    const {error:mappingError}=await supabase.from("mf_accounting_settings").upsert(mapping,{onConflict:"organization_id"});
    setMessage(mappingError?.message||`Microfinance chart of accounts ready · ${missing.length} accounts added.`);
    await refresh();
  };
  return <div className="min-h-full bg-slate-50 p-4 sm:p-6"><div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-700">BOAT Microfinance · Phase 3</p><h1 className="text-2xl font-bold">Accounting & BOAT Connect</h1></div><button onClick={()=>void refresh()} className="rounded-lg border bg-white p-2"><RefreshCw size={18}/></button></header>
    {message&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</div>}
    {busy&&<div className="h-1 animate-pulse rounded bg-emerald-500"/>}
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]"><Panel title="General-ledger mappings"><div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div><p className="font-semibold text-emerald-900">Generic Microfinance chart</p><p className="text-xs text-emerald-700">Creates lending, income, cash, provision, write-off and operating accounts without duplicating existing codes.</p></div><button disabled={readOnly||busy} onClick={()=>void seedChart()} className={buttonClass}><Landmark size={16}/>Generate chart of accounts</button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{mappingFields.map(([key,label])=><label key={key} className="text-sm font-medium">{label}<select value={settings[key]||""} onChange={e=>setSettings(x=>({...x,[key]:e.target.value}))} className={selectClass}><option value="">Not mapped</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.account_code} · {a.account_name}</option>)}</select></label>)}</div><button disabled={readOnly||busy} onClick={()=>void save()} className={`${buttonClass} mt-4`}><Save size={16}/>Save mappings</button></Panel>
      <Panel title="Subledger reconciliation"><Metric label="Loan subledger" value={reconciliation?.subledger_principal}/><Metric label="GL control balance" value={reconciliation?.gl_control_balance}/><Metric label="Difference" value={reconciliation?.difference}/><p className="mt-3 text-xs text-slate-500">The loan-control account should reconcile to zero difference.</p></Panel></div>
    <div className="grid gap-5 xl:grid-cols-2"><Queue title="Pending repayments" rows={repayments} onPost={(id:string)=>post("mf_post_repayment",id)}/><Queue title="Unposted disbursements" rows={disbursements} onPost={(id:string)=>post("mf_post_disbursement",id)}/></div>
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]"><Panel title="Controlled templates"><p className="mb-4 text-sm text-slate-600">Excel workbook for borrowers, applications, opening loans, repayments, guarantors, collateral and follow-ups. It is also Google Sheets compatible.</p><button className={buttonClass} onClick={downloadMfiConnectWorkbook}><Download size={16}/>Download workbook</button></Panel><Panel title="Synchronization history"><Table headers={["Started","Type","Source","Rows","Imported","Rejected","Conflicts","Status"]} rows={imports.map(r=>[String(r.started_at).slice(0,16).replace("T"," "),r.import_type,r.source_system,r.total_rows,r.imported_rows,r.rejected_rows,r.conflict_rows,r.status])}/></Panel></div>
  </div></div>;
}
function Queue({title,rows,onPost}:any){return <Panel title={title}><Table headers={["Reference","Loan","Date","Amount","Action"]} rows={rows.map((r:Row)=>[r.external_reference||r.disbursement_reference,r.mf_loans?.loan_number,r.payment_date||String(r.disbursed_at).slice(0,10),Number(r.amount||0).toFixed(2),<button key={r.id} onClick={()=>onPost(r.id)} className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white"><Send size={13} className="mr-1 inline"/>Post</button>])}/></Panel>}
function Panel({title,children}:any){return <section className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="mb-4 font-bold">{title}</h2>{children}</section>}
function Metric({label,value}:any){return <div className="flex justify-between border-b py-3 text-sm"><span className="text-slate-600">{label}</span><strong>{Number(value||0).toFixed(2)}</strong></div>}
function Table({headers,rows}:{headers:string[];rows:any[][]}){return <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-left text-xs uppercase"><tr>{headers.map(h=><th key={h} className="px-3 py-2">{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i} className="border-t">{r.map((c,j)=><td key={j} className="whitespace-nowrap px-3 py-2">{c??"—"}</td>)}</tr>):<tr><td colSpan={headers.length} className="p-8 text-center text-slate-500">No records.</td></tr>}</tbody></table></div>}
