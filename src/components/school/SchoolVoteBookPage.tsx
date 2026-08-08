import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, BookOpen, Check, Settings2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { BudgetingPage } from "@/components/accounting/BudgetingPage";
import { BudgetVarianceReportPage } from "@/components/accounting/BudgetVarianceReportPage";

type RequestRow = { id:string; budget_line_id:string; description:string; quantity:number; unit_rate:number; amount:number; reason:string; status:string; created_at:string; budget_lines?:{line_label?:string}|null };
type VoteLine = { id:string; line_label:string; amount:number };
type TransferRow = { id:string; source_line_id:string; destination_line_id:string; amount:number; reason:string; status:string; created_at:string };
type Props = { readOnly?: boolean };
type Tab = "vote"|"formulation"|"approvals"|"transfers"|"controls";

const money = (value:number) => Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});

export function SchoolVoteBookPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [tab,setTab] = useState<Tab>("vote");
  const [requests,setRequests] = useState<RequestRow[]>([]);
  const [voteLines,setVoteLines] = useState<VoteLine[]>([]);
  const [transfers,setTransfers] = useState<TransferRow[]>([]);
  const [thresholds,setThresholds] = useState({ amber:"80",headteacher:"100",board:"120" });
  const [message,setMessage] = useState<string|null>(null);
  const [request,setRequest] = useState({budget_line_id:"",description:"",quantity:"1",unit_rate:"",reason:""});
  const [transfer,setTransfer] = useState({source_line_id:"",destination_line_id:"",amount:"",reason:""});

  const load = useCallback(async()=>{
    if(!orgId) return;
    const [r,o,b,t] = await Promise.all([
      supabase.from("school_expense_budget_requests").select("id,budget_line_id,description,quantity,unit_rate,amount,reason,status,created_at,budget_lines(line_label)").eq("organization_id",orgId).order("created_at",{ascending:false}),
      supabase.from("organizations").select("school_budget_amber_percent,school_headteacher_approval_percent,school_board_approval_percent").eq("id",orgId).maybeSingle(),
      supabase.from("budget_lines").select("id,line_label,amount,budgets!inner(organization_id,is_active)").eq("budgets.organization_id",orgId).eq("budgets.is_active",true),
      supabase.from("budget_transfers").select("id,source_line_id,destination_line_id,amount,reason,status,created_at").eq("organization_id",orgId).order("created_at",{ascending:false}),
    ]);
    setRequests((r.data as unknown as RequestRow[])||[]);
    setVoteLines((b.data as unknown as VoteLine[])||[]);
    setTransfers((t.data as TransferRow[])||[]);
    const x=o.data as {school_budget_amber_percent?:number;school_headteacher_approval_percent?:number;school_board_approval_percent?:number}|null;
    if(x) setThresholds({amber:String(x.school_budget_amber_percent??80),headteacher:String(x.school_headteacher_approval_percent??100),board:String(x.school_board_approval_percent??120)});
  },[orgId]);
  useEffect(()=>{void load()},[load]);

  const transferNet = useMemo(()=>{
    const map=new Map<string,number>();
    for(const t of transfers.filter(row=>row.status==="approved")){
      map.set(t.source_line_id,(map.get(t.source_line_id)||0)-Number(t.amount));
      map.set(t.destination_line_id,(map.get(t.destination_line_id)||0)+Number(t.amount));
    }
    return map;
  },[transfers]);
  const commitments = useMemo(()=>{
    const map=new Map<string,number>();
    for(const r of requests.filter(row=>row.status==="approved")) map.set(r.budget_line_id,(map.get(r.budget_line_id)||0)+Number(r.amount));
    return map;
  },[requests]);
  const currentBudget=(id:string)=>Number(voteLines.find(v=>v.id===id)?.amount||0)+(transferNet.get(id)||0);
  const available=(id:string)=>currentBudget(id)-(commitments.get(id)||0);

  const decide=async(id:string,decision:"approved"|"rejected")=>{
    const reason=decision==="rejected" ? window.prompt("Reason for rejection")||"Rejected" : null;
    const {error}=await supabase.rpc("decide_school_expense_budget_request",{p_request_id:id,p_decision:decision,p_reason:reason});
    setMessage(error?.message||`Request ${decision}.`); if(!error) void load();
  };
  const releaseCommitment=async(id:string)=>{
    const {error}=await supabase.rpc("complete_school_budget_commitment",{p_request_id:id});
    setMessage(error?.message||"Commitment released; the posted actual now carries the spend."); if(!error) void load();
  };
  const saveControls=async()=>{
    const {error}=await supabase.rpc("save_school_budget_controls",{p_amber_percent:Number(thresholds.amber),p_headteacher_percent:Number(thresholds.headteacher),p_board_percent:Number(thresholds.board)});
    setMessage(error?.message||"Budget controls saved.");
  };
  const submitRequest=async()=>{
    const line=voteLines.find(v=>v.id===request.budget_line_id); const quantity=Number(request.quantity); const rate=Number(request.unit_rate); const amount=quantity*rate;
    if(!line||!(quantity>0)||!(rate>=0)||!request.description.trim()||!request.reason.trim()) return setMessage("Complete the vote, description, quantity, rate and reason.");
    const projected=currentBudget(line.id)>0?(((commitments.get(line.id)||0)+amount)/currentBudget(line.id))*100:100;
    const {error}=await supabase.from("school_expense_budget_requests").insert({organization_id:orgId,budget_line_id:line.id,description:request.description.trim(),quantity,unit_rate:rate,amount,reason:request.reason.trim(),projected_percent:projected,status:"pending_headteacher",requested_by:user?.id||null});
    setMessage(error?.message||"Commitment submitted for approval."); if(!error){setRequest({budget_line_id:"",description:"",quantity:"1",unit_rate:"",reason:""});void load();}
  };
  const submitTransfer=async()=>{
    const amount=Number(transfer.amount);
    if(!transfer.source_line_id||!transfer.destination_line_id||!(amount>0)||!transfer.reason.trim()) return setMessage("Complete the source, destination, amount and reason.");
    const {error}=await supabase.rpc("create_budget_transfer",{p_source_line_id:transfer.source_line_id,p_destination_line_id:transfer.destination_line_id,p_amount:amount,p_reason:transfer.reason.trim()});
    setMessage(error?.message||"Budget transfer approved and recorded."); if(!error){setTransfer({source_line_id:"",destination_line_id:"",amount:"",reason:""});void load();}
  };

  const tabs: Array<[Tab,string]> = [["vote","Vote book report"],["formulation","Budget formulation"],["approvals","Commitments & approvals"],["transfers","Budget transfers"],["controls","Spending controls"]];
  return <div className="space-y-5">
    <div className="px-6 pt-6 lg:px-8">
      <div className="flex items-center gap-2"><BookOpen className="h-6 w-6 text-indigo-700"/><h1 className="text-2xl font-bold">Vote book & budget movement</h1></div>
      <div className="mt-4 flex flex-wrap gap-2">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab===id?"bg-indigo-700 text-white":"border bg-white text-slate-700"}`}>{label}</button>)}</div>
      {message&&<p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm">{message}</p>}
    </div>
    {tab==="vote"&&<BudgetVarianceReportPage/>}
    {tab==="formulation"&&<BudgetingPage readOnly={readOnly}/>}
    {tab==="approvals"&&<CommitmentsPanel readOnly={readOnly} lines={voteLines} requests={requests} request={request} setRequest={setRequest} submit={submitRequest} decide={decide} release={releaseCommitment} currentBudget={currentBudget} commitments={commitments}/>}
    {tab==="transfers"&&<TransfersPanel readOnly={readOnly} lines={voteLines} transfers={transfers} transfer={transfer} setTransfer={setTransfer} submit={submitTransfer} currentBudget={currentBudget} available={available}/>}
    {tab==="controls"&&<ControlsPanel readOnly={readOnly} thresholds={thresholds} setThresholds={setThresholds} save={saveControls}/>}
  </div>;
}

function CommitmentsPanel({readOnly,lines,requests,request,setRequest,submit,decide,release,currentBudget,commitments}:any){return <div className="mx-6 space-y-4 lg:mx-8"><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Reserve budget for planned spending</h2><div className="mt-3 grid gap-3 md:grid-cols-2"><select value={request.budget_line_id} onChange={e=>setRequest((r:any)=>({...r,budget_line_id:e.target.value}))} className="rounded-lg border px-3 py-2"><option value="">Budget line</option>{lines.map((v:VoteLine)=><option key={v.id} value={v.id}>{v.line_label} — Current {money(currentBudget(v.id))} — Committed {money(commitments.get(v.id)||0)}</option>)}</select><input value={request.description} onChange={e=>setRequest((r:any)=>({...r,description:e.target.value}))} placeholder="Expense description" className="rounded-lg border px-3 py-2"/><input type="number" min="0.01" value={request.quantity} onChange={e=>setRequest((r:any)=>({...r,quantity:e.target.value}))} placeholder="Quantity" className="rounded-lg border px-3 py-2"/><input type="number" min="0" value={request.unit_rate} onChange={e=>setRequest((r:any)=>({...r,unit_rate:e.target.value}))} placeholder="Rate / unit price" className="rounded-lg border px-3 py-2"/><textarea value={request.reason} onChange={e=>setRequest((r:any)=>({...r,reason:e.target.value}))} placeholder="Reason / procurement reference" className="rounded-lg border px-3 py-2 md:col-span-2"/><p className="text-sm font-semibold">Amount: {money(Number(request.quantity||0)*Number(request.unit_rate||0))}</p><button disabled={readOnly} onClick={()=>void submit()} className="w-fit rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit commitment</button></div></div><div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50"><tr>{["Vote / expense","Amount","Reason","Status","Action"].map(h=><th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{requests.map((r:RequestRow)=><tr key={r.id} className="border-t"><td className="p-3"><b>{r.budget_lines?.line_label||"Budget line"}</b><div className="text-xs text-slate-500">{r.description} · {r.quantity} × {money(r.unit_rate)}</div></td><td className="p-3 font-semibold">{money(r.amount)}</td><td className="p-3">{r.reason}</td><td className="p-3 capitalize">{r.status.replace("_"," ")}</td><td className="p-3"><div className="flex gap-3">{r.status==="pending_headteacher"&&<><button onClick={()=>void decide(r.id,"approved")} className="text-emerald-700"><Check className="h-5 w-5"/></button><button onClick={()=>void decide(r.id,"rejected")} className="text-red-700"><X className="h-5 w-5"/></button></>}{r.status==="approved"&&<button onClick={()=>void release(r.id)} className="text-xs font-semibold text-indigo-700">Post actual / release</button>}</div></td></tr>)}{!requests.length&&<tr><td colSpan={5} className="p-6 text-slate-500">No commitments or approval requests.</td></tr>}</tbody></table></div></div>}

function TransfersPanel({readOnly,lines,transfers,transfer,setTransfer,submit,currentBudget,available}:any){return <div className="mx-6 grid gap-5 lg:mx-8 lg:grid-cols-2"><div className="rounded-xl border bg-white p-5"><div className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-indigo-700"/><h2 className="font-semibold">Transfer approved budget</h2></div><p className="mt-1 text-sm text-slate-500">Moves current allocation without changing the original approved budget.</p><div className="mt-4 grid gap-3"><select value={transfer.source_line_id} onChange={e=>setTransfer((t:any)=>({...t,source_line_id:e.target.value}))} className="rounded-lg border px-3 py-2"><option value="">Source vote</option>{lines.map((v:VoteLine)=><option key={v.id} value={v.id}>{v.line_label} — Available {money(available(v.id))}</option>)}</select><select value={transfer.destination_line_id} onChange={e=>setTransfer((t:any)=>({...t,destination_line_id:e.target.value}))} className="rounded-lg border px-3 py-2"><option value="">Destination vote</option>{lines.filter((v:VoteLine)=>v.id!==transfer.source_line_id).map((v:VoteLine)=><option key={v.id} value={v.id}>{v.line_label} — Current {money(currentBudget(v.id))}</option>)}</select><input type="number" min="0.01" step="0.01" value={transfer.amount} onChange={e=>setTransfer((t:any)=>({...t,amount:e.target.value}))} placeholder="Transfer amount" className="rounded-lg border px-3 py-2"/><textarea value={transfer.reason} onChange={e=>setTransfer((t:any)=>({...t,reason:e.target.value}))} placeholder="Reason for transfer" className="rounded-lg border px-3 py-2"/><button disabled={readOnly} onClick={()=>void submit()} className="w-fit rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve transfer</button></div></div><div className="overflow-hidden rounded-xl border bg-white"><div className="border-b bg-slate-50 px-4 py-3 font-semibold">Transfer history</div><div className="divide-y">{transfers.map((t:TransferRow)=><div key={t.id} className="p-4 text-sm"><div className="flex justify-between gap-3"><b>{lines.find((v:VoteLine)=>v.id===t.source_line_id)?.line_label||"Source"} → {lines.find((v:VoteLine)=>v.id===t.destination_line_id)?.line_label||"Destination"}</b><span className="font-semibold">{money(t.amount)}</span></div><p className="mt-1 text-slate-600">{t.reason}</p><p className="mt-1 text-xs text-slate-400">{new Date(t.created_at).toLocaleString()} · {t.status}</p></div>)}{!transfers.length&&<p className="p-5 text-sm text-slate-500">No budget transfers recorded.</p>}</div></div></div>}

function ControlsPanel({readOnly,thresholds,setThresholds,save}:any){return <div className="mx-6 max-w-2xl space-y-4 rounded-xl border bg-white p-5 lg:mx-8"><div className="flex items-center gap-2"><Settings2 className="h-5 w-5"/><h2 className="font-semibold">Maximum acceptable spend</h2></div><p className="text-sm text-slate-600">Percentages compare actual expenditure plus commitments against the current vote budget.</p>{([['amber','Amber warning starts at %'],['headteacher','Headteacher approval required at %'],['board','Board approval required at %']] as const).map(([key,label])=><label key={key} className="block"><span className="text-sm font-medium">{label}</span><input type="number" value={thresholds[key]} onChange={e=>setThresholds((t:any)=>({...t,[key]:e.target.value}))} className={`mt-1 w-full rounded-lg border px-3 py-2 ${key==='amber'?'border-amber-400 bg-amber-50':key==='board'?'border-red-400 bg-red-50':'border-slate-300'}`}/></label>)}<button disabled={readOnly} onClick={()=>void save()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save controls</button></div>}
