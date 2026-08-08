import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, Settings2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { BudgetingPage } from "@/components/accounting/BudgetingPage";
import { BudgetVarianceReportPage } from "@/components/accounting/BudgetVarianceReportPage";

type RequestRow = { id:string; description:string; quantity:number; unit_rate:number; amount:number; reason:string; status:string; created_at:string; budget_line_id:string; budget_lines?:{line_label?:string}|null };
type VoteLine = { id:string; line_label:string; amount:number };
type TransferRow = {id:string;source_line_id:string;destination_line_id:string;amount:number;reason:string;status:string;created_at:string};
type Props = { readOnly?: boolean };

export function SchoolVoteBookPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [tab,setTab]=useState<"vote"|"formulation"|"approvals"|"controls">("vote");
  const [requests,setRequests]=useState<RequestRow[]>([]);
  const [thresholds,setThresholds]=useState({ amber:"80", headteacher:"100", board:"120" });
  const [message,setMessage]=useState<string|null>(null);
  const [voteLines,setVoteLines]=useState<VoteLine[]>([]);
  const [request,setRequest]=useState({budget_line_id:"",description:"",quantity:"1",unit_rate:"",reason:""});
  const [transfers,setTransfers]=useState<TransferRow[]>([]);
  const [transfer,setTransfer]=useState({source_line_id:"",destination_line_id:"",amount:"",reason:""});

  const load = useCallback(async()=>{
    if(!orgId)return;
    const [r,o,b,t]=await Promise.all([
      supabase.from("school_expense_budget_requests").select("id,budget_line_id,description,quantity,unit_rate,amount,reason,status,created_at,budget_lines(line_label)").eq("organization_id",orgId).order("created_at",{ascending:false}),
      supabase.from("organizations").select("school_budget_amber_percent,school_headteacher_approval_percent,school_board_approval_percent").eq("id",orgId).maybeSingle(),
      supabase.from("budget_lines").select("id,line_label,amount,budgets!inner(organization_id,is_active)").eq("budgets.organization_id",orgId).eq("budgets.is_active",true),
      supabase.from("budget_transfers").select("id,source_line_id,destination_line_id,amount,reason,status,created_at").eq("organization_id",orgId).order("created_at",{ascending:false})
    ]);
    setRequests((r.data as unknown as RequestRow[])||[]);
    const x=o.data as {school_budget_amber_percent?:number;school_headteacher_approval_percent?:number;school_board_approval_percent?:number}|null;
    if(x)setThresholds({amber:String(x.school_budget_amber_percent??80),headteacher:String(x.school_headteacher_approval_percent??100),board:String(x.school_board_approval_percent??120)});
    setVoteLines((b.data as unknown as VoteLine[])||[]);
    setTransfers((t.data as TransferRow[])||[]);
  },[orgId]);
  useEffect(()=>{void load()},[load]);

  const decide=async(id:string,decision:"approved"|"rejected")=>{
    const reason=decision==="rejected" ? window.prompt("Reason for rejection")||"Rejected" : null;
    const {error}=await supabase.rpc("decide_school_expense_budget_request",{p_request_id:id,p_decision:decision,p_reason:reason});
    setMessage(error?.message||`Request ${decision}.`); if(!error)void load();
  };
  const saveControls=async()=>{
    const {error}=await supabase.rpc("save_school_budget_controls",{p_amber_percent:Number(thresholds.amber),p_headteacher_percent:Number(thresholds.headteacher),p_board_percent:Number(thresholds.board)});
    setMessage(error?.message||"Budget controls saved.");
  };
  const submitRequest=async()=>{
    const line=voteLines.find(v=>v.id===request.budget_line_id); const quantity=Number(request.quantity); const rate=Number(request.unit_rate); const amount=quantity*rate;
    if(!line||!(quantity>0)||!(rate>=0)||!request.description.trim()||!request.reason.trim())return void setMessage("Complete the vote, description, quantity, rate and reason.");
    const projected=line.amount>0?amount/Number(line.amount)*100:100;
    const status=projected>=Number(thresholds.board)?"pending_headteacher":"pending_headteacher";
    const {error}=await supabase.from("school_expense_budget_requests").insert({organization_id:orgId,budget_line_id:line.id,description:request.description.trim(),quantity,unit_rate:rate,amount,reason:request.reason.trim(),projected_percent:projected,status,requested_by:user?.id||null});
    setMessage(error?.message||"Exception submitted for headteacher approval."); if(!error){setRequest({budget_line_id:"",description:"",quantity:"1",unit_rate:"",reason:""});void load();}
  };
  const currentBudget=(lineId:string)=>{const line=voteLines.find(v=>v.id===lineId);return Number(line?.amount||0)+transfers.filter(t=>t.status==='approved').reduce((s,t)=>s+(t.destination_line_id===lineId?Number(t.amount):t.source_line_id===lineId?-Number(t.amount):0),0)};
  const commitment=(lineId:string)=>requests.filter(r=>r.budget_line_id===lineId&&r.status==='approved').reduce((s,r)=>s+Number(r.amount),0);
  const submitTransfer=async()=>{const amount=Number(transfer.amount);if(!transfer.source_line_id||!transfer.destination_line_id||!(amount>0)||!transfer.reason.trim())return setMessage("Complete the source, destination, amount and reason.");const{error}=await supabase.rpc("create_budget_transfer",{p_source_line_id:transfer.source_line_id,p_destination_line_id:transfer.destination_line_id,p_amount:amount,p_reason:transfer.reason.trim()});setMessage(error?.message||"Budget transfer approved and recorded.");if(!error){setTransfer({source_line_id:"",destination_line_id:"",amount:"",reason:""});void load();}};
  const releaseCommitment=async(id:string)=>{const{error}=await supabase.rpc("complete_school_budget_commitment",{p_request_id:id});setMessage(error?.message||"Commitment released to actual expenditure.");if(!error)void load();};
  return <div className="space-y-5">
    <div className="px-6 pt-6 lg:px-8"><div className="flex items-center gap-2"><BookOpen className="h-6 w-6 text-indigo-700"/><h1 className="text-2xl font-bold">Vote book & budget movement</h1></div>
      <div className="mt-4 flex flex-wrap gap-2">{([['vote','Vote book report'],['formulation','Budget formulation'],['approvals','Commitments & approvals'],['controls','Spending controls']] as const).map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab===id?'bg-indigo-700 text-white':'border bg-white text-slate-700'}`}>{label}</button>)}</div>
      {message&&<p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm">{message}</p>}</div>
    {tab==="vote"&&<BudgetVarianceReportPage/>}
    {tab==="formulation"&&<BudgetingPage readOnly={readOnly}/>} 
    {tab==="approvals"&&<div className="mx-6 lg:mx-8 space-y-4"><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Submit above-budget expense</h2><div className="mt-3 grid gap-3 md:grid-cols-2"><select value={request.budget_line_id} onChange={e=>setRequest(r=>({...r,budget_line_id:e.target.value}))} className="rounded-lg border px-3 py-2"><option value="">Budget line</option>{voteLines.map(v=><option key={v.id} value={v.id}>{v.line_label} — {Number(v.amount).toLocaleString()}</option>)}</select><input value={request.description} onChange={e=>setRequest(r=>({...r,description:e.target.value}))} placeholder="Expense description" className="rounded-lg border px-3 py-2"/><input type="number" min="0.01" value={request.quantity} onChange={e=>setRequest(r=>({...r,quantity:e.target.value}))} placeholder="Quantity" className="rounded-lg border px-3 py-2"/><input type="number" min="0" value={request.unit_rate} onChange={e=>setRequest(r=>({...r,unit_rate:e.target.value}))} placeholder="Rate / unit price" className="rounded-lg border px-3 py-2"/><textarea value={request.reason} onChange={e=>setRequest(r=>({...r,reason:e.target.value}))} placeholder="Why is the variance necessary?" className="rounded-lg border px-3 py-2 md:col-span-2"/><p className="text-sm font-semibold">Amount: {(Number(request.quantity||0)*Number(request.unit_rate||0)).toLocaleString()}</p><button disabled={readOnly} onClick={()=>void submitRequest()} className="w-fit rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Submit for approval</button></div></div><div className="rounded-xl border bg-white overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Vote / expense</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Rate</th><th className="p-3 text-right">Amount</th><th className="p-3 text-left">Reason</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Decision</th></tr></thead><tbody>{requests.map(r=><tr key={r.id} className="border-t"><td className="p-3"><b>{r.budget_lines?.line_label||'Budget line'}</b><div className="text-xs text-slate-500">{r.description}</div></td><td className="p-3 text-right">{r.quantity}</td><td className="p-3 text-right">{Number(r.unit_rate).toLocaleString()}</td><td className="p-3 text-right font-semibold">{Number(r.amount).toLocaleString()}</td><td className="p-3">{r.reason}</td><td className="p-3 capitalize">{r.status.replace('_',' ')}</td><td className="p-3"><div className="flex justify-end gap-2">{r.status==='pending_headteacher'&&<><button onClick={()=>void decide(r.id,'approved')} className="text-emerald-700"><Check className="h-5 w-5"/></button><button onClick={()=>void decide(r.id,'rejected')} className="text-red-700"><X className="h-5 w-5"/></button></>}</div></td></tr>)}{!requests.length&&<tr><td colSpan={7} className="p-6 text-slate-500">No approval requests.</td></tr>}</tbody></table></div></div>}
    {tab==="controls"&&<div className="mx-6 lg:mx-8 max-w-2xl rounded-xl border bg-white p-5 space-y-4"><div className="flex items-center gap-2"><Settings2 className="h-5 w-5"/><h2 className="font-semibold">Maximum acceptable spend</h2></div><p className="text-sm text-slate-600">Percentages compare total spent plus the proposed expense against the vote budget.</p>{([['amber','Amber warning starts at %'],['headteacher','Headteacher approval required at %'],['board','Board approval required at %']] as const).map(([key,label])=><label key={key} className="block"><span className="text-sm font-medium">{label}</span><input type="number" value={thresholds[key]} onChange={e=>setThresholds(t=>({...t,[key]:e.target.value}))} className={`mt-1 w-full rounded-lg border px-3 py-2 ${key==='amber'?'border-amber-400 bg-amber-50':key==='board'?'border-red-400 bg-red-50':'border-slate-300'}`}/></label>)}<button disabled={readOnly} onClick={()=>void saveControls()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save controls</button></div>}
  </div>;
}
