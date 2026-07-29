import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, Briefcase, Plus, RefreshCw, UsersRound } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { generateMfiSchedule, portfolioAtRisk } from "@/lib/mfiFinance";
import { downloadCsv, downloadXlsx, exportAccountingPdf } from "@/lib/accountingReportExport";

type Section = "dashboard" | "borrowers" | "products" | "applications" | "approvals" | "collections" | "risk" | "reports";
type Row = Record<string, any>;

const sectionTitle: Record<Section, string> = {
  dashboard: "Microfinance dashboard",
  borrowers: "Borrowers",
  products: "Loan products",
  applications: "Loan applications",
  approvals: "Loan approval & disbursement",
  collections: "Collections",
  risk: "Portfolio risk",
  reports: "Microfinance reports",
};

const inputClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50";
const money = (value: unknown) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function MfiWorkspacePage({ section, readOnly = false }: { section: Section; readOnly?: boolean }) {
  const { user } = useAuth();
  const organizationId = user?.organization_id;
  const [borrowers, setBorrowers] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [productCharges, setProductCharges] = useState<Row[]>([]);
  const [applications, setApplications] = useState<Row[]>([]);
  const [loans, setLoans] = useState<Row[]>([]);
  const [disbursements, setDisbursements] = useState<Row[]>([]);
  const [repayments, setRepayments] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    const [b, p, pc, a, l, r, d] = await Promise.all([
      supabase.from("mf_borrowers").select("*").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(250),
      supabase.from("mf_loan_products").select("*").eq("organization_id", organizationId).order("name").limit(100),
      supabase.from("mf_product_charges").select("*").eq("organization_id", organizationId).order("created_at").limit(250),
      supabase.from("mf_loan_applications").select("*,mf_borrowers(full_name,borrower_number),mf_loan_products(*)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(250),
      supabase.from("mf_loans").select("*,mf_borrowers(full_name,borrower_number),mf_loan_applications(indicative_fees,indicative_net_disbursement)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(250),
      supabase.from("mf_repayments").select("*").eq("organization_id", organizationId).order("payment_date", { ascending: false }).limit(250),
      supabase.from("mf_disbursements").select("*").eq("organization_id", organizationId).order("disbursed_at", { ascending: false }).limit(250),
    ]);
    const firstError = [b, p, pc, a, l, r, d].find((result) => result.error)?.error;
    setMessage(firstError ? `Database setup required: ${firstError.message}` : "");
    setBorrowers(b.data || []);
    setProducts(p.data || []);
    setProductCharges(pc.data || []);
    setApplications(a.data || []);
    setLoans(l.data || []);
    setRepayments(r.data || []);
    setDisbursements(d.data || []);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (table: string, values: Row, form: HTMLFormElement) => {
    if (!organizationId || readOnly) return;
    setMessage("");
    const { error } = await supabase.from(table).insert({ ...values, organization_id: organizationId, created_by: user?.id });
    if (error) setMessage(error.message);
    else {
      setMessage("Saved successfully.");
      form.reset();
      await refresh();
    }
  };

  const updateBorrower = async (borrowerId: string, values: Row) => {
    if (!organizationId || readOnly) return false;
    setMessage("");
    const { error } = await supabase
      .from("mf_borrowers")
      .update({
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", borrowerId)
      .eq("organization_id", organizationId);
    if (error) {
      setMessage(error.message);
      return false;
    }
    setMessage("Borrower details updated successfully.");
    await refresh();
    return true;
  };

  const updateRecord = async (table: string, id: string, values: Row) => {
    if (!organizationId || readOnly) return false;
    setMessage("");
    const { error } = await supabase
      .from(table)
      .update({ ...values, updated_by: user?.id, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", organizationId);
    if (error) {
      setMessage(error.message);
      return false;
    }
    setMessage("Record updated successfully.");
    await refresh();
    return true;
  };

  const runRpc = async (name: string, args: Row) => {
    if (readOnly) return false;
    setMessage("");
    const { error } = await supabase.rpc(name, args);
    if (error) {
      setMessage(error.message);
      return false;
    }
    setMessage("Action completed successfully.");
    await refresh();
    return true;
  };

  const decideApplication = async (application: Row, decision: "approved" | "rejected", values: Row) => {
    if (!organizationId || !user?.id || readOnly) return false;
    setMessage("");
    const approval = {
      organization_id: organizationId,
      application_id: application.id,
      decision,
      approved_by: user.id,
      amount_approved: decision === "approved" ? values.amount : null,
      approved_rate: decision === "approved" ? values.rate : null,
      approved_term: decision === "approved" ? values.term : null,
      approval_conditions: values.conditions || null,
      remarks: values.remarks || null,
      rejection_reason: decision === "rejected" ? values.reason : null,
    };
    const { error: approvalError } = await supabase.from("mf_loan_approvals").insert(approval);
    if (approvalError) { setMessage(approvalError.message); return false; }
    if (decision === "rejected") {
      const { error } = await supabase.from("mf_loan_applications").update({ status: "rejected", updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", application.id).eq("organization_id", organizationId);
      if (error) { setMessage(error.message); return false; }
    } else {
      const product = products.find((p) => p.id === application.loan_product_id);
      const amount = Number(values.amount);
      const charges = productCharges.filter((c) => c.loan_product_id === application.loan_product_id && c.is_active !== false);
      const chargeAmount = (c: Row) => c.charge_type === "percentage" ? amount * Number(c.amount || 0) / 100 : Number(c.amount || 0);
      const financedCharges = charges.filter((c) => c.treatment === "financed").reduce((sum, c) => sum + chargeAmount(c), 0);
      const { error: loanError } = await supabase.from("mf_loans").insert({
        organization_id: organizationId, application_id: application.id, borrower_id: application.borrower_id,
        loan_product_id: application.loan_product_id, principal: amount, financed_charges: financedCharges, gross_balance: amount + financedCharges,
        outstanding_principal: amount, interest_method: product?.interest_method || "flat",
        interest_rate: Number(values.rate), rate_basis: product?.rate_basis || "annual",
        installment_method: product?.installment_method || "equal_total", term: Number(values.term),
        repayment_frequency: application.repayment_frequency, first_repayment_date: application.proposed_first_repayment_date,
        status: "approved", created_by: user.id,
      });
      if (loanError) { setMessage(`Approval recorded, but loan creation failed: ${loanError.message}`); return false; }
      const { error } = await supabase.from("mf_loan_applications").update({ status: "approved", updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", application.id).eq("organization_id", organizationId);
      if (error) { setMessage(error.message); return false; }
    }
    setMessage(`Application ${decision} successfully.`);
    await refresh();
    return true;
  };

  const createDisbursement = async (loan: Row, values: Row) => {
    if (!organizationId || !user?.id || readOnly) return false;
    setMessage("");
    const amount = Number(values.amount);
    const charges = Number(values.charges || 0);
    const { data, error } = await supabase.from("mf_disbursements").insert({
      organization_id: organizationId, loan_id: loan.id,
      disbursement_reference: values.reference, amount, charges_deducted: charges,
      net_amount: amount - charges, method: values.method, transaction_reference: values.transactionReference || null,
      disbursed_by: user.id,
    }).select("id").single();
    if (error) { setMessage(error.message); return false; }
    const posted = await runRpc("mf_post_disbursement", { p_disbursement_id: data.id });
    if (posted) {
      await supabase.from("mf_loan_applications").update({ status: "disbursed", updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", loan.application_id).eq("organization_id", organizationId);
      setMessage("Loan disbursed and posted successfully.");
      await refresh();
    }
    return posted;
  };

  const loanRisk = useMemo(
    () => loans.map((loan) => ({
      outstandingPrincipal: Number(loan.outstanding_principal || loan.principal || 0),
      daysPastDue: Number(loan.days_past_due || 0),
    })),
    [loans]
  );
  const par30 = portfolioAtRisk(loanRisk, 30);
  const totalCollected = repayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <div className="min-h-full bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">BOAT Microfinance</p>
            <h1 className="text-2xl font-bold text-slate-900">{sectionTitle[section]}</h1>
            <p className="text-sm text-slate-500">Separate lending subledger for borrowers, loans, collections and portfolio risk.</p>
          </div>
          <button className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600" onClick={() => void refresh()} title="Refresh"><RefreshCw size={18} /></button>
        </div>
        {message && <div className={`rounded-lg border px-4 py-3 text-sm ${message.includes("success") ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{message}</div>}
        {loading ? <div className="rounded-xl border bg-white p-10 text-center text-slate-500">Loading microfinance workspace…</div> : null}

        {!loading && section === "dashboard" && <Dashboard borrowers={borrowers} loans={loans} applications={applications} collected={totalCollected} par30={par30} />}
        {!loading && section === "borrowers" && <Borrowers rows={borrowers} disabled={readOnly} onSubmit={(v, f) => submit("mf_borrowers", v, f)} onUpdate={updateBorrower} />}
        {!loading && section === "products" && <div className="space-y-5"><Products rows={products} disabled={readOnly} onSubmit={(v:Row, f:HTMLFormElement) => submit("mf_loan_products", v, f)} onUpdate={(id:string,v:Row)=>updateRecord("mf_loan_products",id,v)} /><ProductFees products={products} rows={productCharges} disabled={readOnly} onSubmit={(v:Row,f:HTMLFormElement)=>submit("mf_product_charges",v,f)} onUpdate={(id:string,v:Row)=>updateRecord("mf_product_charges",id,v)} /></div>}
        {!loading && section === "applications" && <Applications rows={applications} borrowers={borrowers} products={products} charges={productCharges} disabled={readOnly} onSubmit={(v, f) => submit("mf_loan_applications", v, f)} onUpdate={(id:string,v:Row)=>updateRecord("mf_loan_applications",id,v)} />}
        {!loading && section === "approvals" && <Approvals applications={applications} loans={loans} disbursements={disbursements} disabled={readOnly} onDecision={decideApplication} onReferBack={(id:string,reason:string)=>updateRecord("mf_loan_applications",id,{status:"draft",notes:reason})} onDisburse={createDisbursement} />}
        {!loading && section === "collections" && <Collections loans={loans} repayments={repayments} disabled={readOnly} onSubmit={(v, f) => submit("mf_repayments", v, f)} onUpdate={(id:string,v:Row)=>updateRecord("mf_repayments",id,v)} onReverse={(id:string,reason:string)=>runRpc("mf_reverse_repayment",{p_repayment_id:id,p_reason:reason})} />}
        {!loading && section === "risk" && <Risk loans={loans} risk={loanRisk} />}
        {!loading && section === "reports" && <Reports borrowers={borrowers} applications={applications} loans={loans} repayments={repayments} />}
      </div>
    </div>
  );
}

function Cards({ items }: { items: Array<{ label: string; value: string | number; icon: any }> }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><p className="text-sm text-slate-500">{label}</p><Icon size={18} className="text-emerald-600" /></div><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div>)}</div>;
}

function Dashboard({ borrowers, loans, applications, collected, par30 }: any) {
  const active = loans.filter((l: Row) => ["active", "in_arrears", "non_performing"].includes(l.status)).length;
  return <div className="space-y-5"><Cards items={[
    { label: "Active borrowers", value: borrowers.filter((b: Row) => b.status === "active").length, icon: UsersRound },
    { label: "Active loans", value: active, icon: Briefcase },
    { label: "Gross portfolio", value: money(par30.gross), icon: Banknote },
    { label: "PAR 30", value: `${money(par30.ratio)}%`, icon: AlertTriangle },
  ]} /><div className="grid gap-4 lg:grid-cols-2"><Panel title="Pending work"><Metric label="Applications awaiting decision" value={applications.filter((a: Row) => ["submitted", "under_appraisal", "recommended"].includes(a.status)).length} /><Metric label="Loans in arrears" value={loans.filter((l: Row) => Number(l.days_past_due) > 0).length} /></Panel><Panel title="Collections"><Metric label="Recorded collections" value={money(collected)} /><Metric label="Principal at risk (30+ days)" value={money(par30.atRisk)} /></Panel></div></div>;
}

function Borrowers({ rows, disabled, onSubmit, onUpdate }: any) {
  const [editing, setEditing] = useState<Row | null>(null);
  const valuesFrom = (d: FormData) => ({
    borrower_type: d.get("type"),
    full_name: d.get("name"),
    gender: d.get("gender") || null,
    date_of_birth: d.get("dateOfBirth") || null,
    national_id: d.get("nin") || null,
    registration_number: d.get("registrationNumber") || null,
    phone: d.get("phone"),
    alternative_phone: d.get("alternativePhone") || null,
    email: d.get("email") || null,
    physical_address: d.get("address") || null,
    occupation: d.get("occupation") || null,
    employer: d.get("employer") || null,
    estimated_income: Number(d.get("income") || 0),
    risk_rating: d.get("riskRating") || null,
    status: d.get("status") || "active",
    notes: d.get("notes") || null,
  });
  const title = editing ? `Edit borrower · ${editing.borrower_number || editing.full_name}` : "Register borrower";
  return (
    <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
      <FormPanel title={title}>
        <form
          key={editing?.id || "new"}
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = valuesFrom(new FormData(form));
            if (editing) {
              void onUpdate(editing.id, values).then((saved: boolean) => {
                if (saved) setEditing(null);
              });
            } else {
              void onSubmit(values, form);
            }
          }}
        >
          <Select name="type" label="Borrower type" defaultValue={editing?.borrower_type || "individual"} options={["individual","group","business","payroll"]}/>
          <Select name="status" label="Status" defaultValue={editing?.status || "active"} options={["prospect","active","inactive","blacklisted","deceased"]}/>
          <div className="col-span-2"><Input name="name" label="Full name / business name" defaultValue={editing?.full_name || ""} required/></div>
          <Select name="gender" label="Gender" defaultValue={editing?.gender || ""} options={["","female","male","other"]}/>
          <Input name="dateOfBirth" label="Date of birth" type="date" defaultValue={editing?.date_of_birth || ""}/>
          <Input name="nin" label="National ID / NIN" defaultValue={editing?.national_id || ""}/>
          <Input name="registrationNumber" label="Registration number" defaultValue={editing?.registration_number || ""}/>
          <Input name="phone" label="Telephone" defaultValue={editing?.phone || ""} required/>
          <Input name="alternativePhone" label="Alternative telephone" defaultValue={editing?.alternative_phone || ""}/>
          <div className="col-span-2"><Input name="email" label="Email" type="email" defaultValue={editing?.email || ""}/></div>
          <div className="col-span-2"><Input name="address" label="Physical address" defaultValue={editing?.physical_address || ""}/></div>
          <Input name="occupation" label="Occupation / business" defaultValue={editing?.occupation || editing?.business_activity || ""}/>
          <Input name="employer" label="Employer" defaultValue={editing?.employer || ""}/>
          <Input name="income" label="Estimated monthly income" type="number" min="0" step="0.01" defaultValue={editing?.estimated_income || 0}/>
          <Select name="riskRating" label="Risk rating" defaultValue={editing?.risk_rating || ""} options={["","low","medium","high","very_high"]}/>
          <div className="col-span-2"><label className="block text-sm font-medium text-slate-700">Notes<textarea name="notes" rows={3} defaultValue={editing?.notes || ""} className={`${inputClass} mt-1`}/></label></div>
          <div className="col-span-2 flex flex-wrap gap-2">
            <Submit disabled={disabled}>{editing ? "Save borrower changes" : "Register borrower"}</Submit>
            {editing && <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => setEditing(null)}>Cancel</button>}
          </div>
        </form>
      </FormPanel>
      <Table
        headers={["Number","Borrower","Type","Phone","Status","Action"]}
        rows={rows.map((r:Row)=>[
          r.borrower_number||"Pending",
          r.full_name,
          r.borrower_type,
          r.phone,
          r.status,
          <button key={r.id} type="button" disabled={disabled} onClick={() => setEditing(r)} className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">Edit</button>,
        ])}
      />
    </div>
  );
}

function Products({ rows, disabled, onSubmit, onUpdate }: any) {
  const edit=(r:Row)=>{const name=prompt("Product name",r.name);if(name===null)return;const rate=prompt("Interest rate (%)",String(r.interest_rate));if(rate===null)return;const min=prompt("Minimum principal",String(r.min_principal));if(min===null)return;const max=prompt("Maximum principal",String(r.max_principal));if(max===null)return;void onUpdate(r.id,{name,interest_rate:Number(rate),min_principal:Number(min),max_principal:Number(max)});};
  return <div className="grid gap-5 xl:grid-cols-[380px_1fr]"><FormPanel title="Configure loan product"><form className="grid grid-cols-2 gap-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onSubmit({code:d.get("code"),name:d.get("name"),min_principal:Number(d.get("min")),max_principal:Number(d.get("max")),min_term:Number(d.get("minTerm")),max_term:Number(d.get("maxTerm")),term_unit:"months",repayment_frequency:d.get("frequency"),interest_method:d.get("method"),interest_rate:Number(d.get("rate")),rate_basis:d.get("basis"),installment_method:d.get("installment"),is_active:true},f)}}><div className="col-span-2"><Input name="name" label="Product name" required/></div><Input name="code" label="Code" required/><Input name="rate" label="Interest rate (%)" type="number" required/><Input name="min" label="Minimum principal" type="number" required/><Input name="max" label="Maximum principal" type="number" required/><Input name="minTerm" label="Minimum term" type="number" required/><Input name="maxTerm" label="Maximum term" type="number" required/><Select name="frequency" label="Frequency" options={["daily","weekly","fortnightly","monthly","quarterly"]}/><Select name="method" label="Interest method" options={["flat","declining"]}/><Select name="basis" label="Rate basis" options={["annual","monthly","weekly","per_term"]}/><Select name="installment" label="Instalments" options={["equal_total","equal_principal"]}/><div className="col-span-2"><Submit disabled={disabled}>Save product</Submit></div></form></FormPanel><Table headers={["Code","Product","Limits","Rate","Method","Action"]} rows={rows.map((r:Row)=>[r.code,r.name,`${money(r.min_principal)} – ${money(r.max_principal)}`,`${r.interest_rate}% ${r.rate_basis}`,r.interest_method,<ActionButton key={r.id} disabled={disabled} onClick={()=>edit(r)}>Edit</ActionButton>])}/></div>;
}

function ProductFees({ products, rows, disabled, onSubmit, onUpdate }: any) {
  const edit=(r:Row)=>{const amount=prompt(r.charge_type==="percentage"?"Percentage":"Amount",String(r.amount));if(amount===null)return;const treatment=prompt("Treatment: paid_separately, deducted or financed",r.treatment);if(!treatment||!["paid_separately","deducted","financed"].includes(treatment))return;void onUpdate(r.id,{amount:Number(amount),treatment});};
  return <div className="grid gap-5 xl:grid-cols-[380px_1fr]"><FormPanel title="Add product fee"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onSubmit({loan_product_id:d.get("product"),name:d.get("name"),charge_type:d.get("type"),amount:Number(d.get("amount")),treatment:d.get("treatment"),is_active:true},f)}}><SelectRecords name="product" label="Loan product" rows={products} text={(r:Row)=>r.name}/><Input name="name" label="Fee name (application, processing, insurance, loan form…)" required/><Select name="type" label="Calculation" options={["fixed","percentage"]}/><Input name="amount" label="Amount or percentage" type="number" min="0" step="0.01" required/><Select name="treatment" label="When/how charged" options={["paid_separately","deducted","financed"]}/><p className="text-xs text-slate-500">Paid separately means upfront; deducted is withheld from proceeds; financed is added to the loan balance.</p><Submit disabled={disabled}>Add fee</Submit></form></FormPanel><Table headers={["Product","Fee","Calculation","Treatment","Status","Action"]} rows={rows.map((r:Row)=>[products.find((p:Row)=>p.id===r.loan_product_id)?.name,r.name,r.charge_type==="percentage"?`${r.amount}%`:money(r.amount),r.treatment==="paid_separately"?"upfront":r.treatment,r.is_active===false?"inactive":"active",<ActionButton key={r.id} disabled={disabled} onClick={()=>edit(r)}>Edit</ActionButton>])}/></div>;
}

function Applications({ rows, borrowers, products, charges, disabled, onSubmit, onUpdate }: any) {
  const [preview,setPreview]=useState<any[]>([]);
  const edit=(r:Row)=>{if(!["draft","submitted","appraised"].includes(r.status)){alert("Approved or disbursed applications cannot be edited.");return;}const amount=prompt("Amount requested",String(r.amount_requested));if(amount===null)return;const term=prompt("Term (periods)",String(r.proposed_term));if(term===null)return;const purpose=prompt("Loan purpose",r.purpose);if(purpose===null)return;const first=prompt("First repayment date",r.proposed_first_repayment_date);if(first===null)return;void onUpdate(r.id,{amount_requested:Number(amount),proposed_term:Number(term),purpose,proposed_first_repayment_date:first});};
  return <div className="space-y-5"><FormPanel title="New loan application"><form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f),product=products.find((p:Row)=>p.id===d.get("product"));const amount=Number(d.get("amount")),term=Number(d.get("term"));const applicable=charges.filter((c:Row)=>c.loan_product_id===product?.id&&c.is_active!==false);const fee=(c:Row)=>c.charge_type==="percentage"?amount*Number(c.amount||0)/100:Number(c.amount||0);const totalFees=applicable.reduce((s:number,c:Row)=>s+fee(c),0);const deducted=applicable.filter((c:Row)=>["deducted","paid_separately"].includes(c.treatment)).reduce((s:number,c:Row)=>s+fee(c),0);const schedule=generateMfiSchedule({principal:amount+applicable.filter((c:Row)=>c.treatment==="financed").reduce((s:number,c:Row)=>s+fee(c),0),periodicRate:Number(product?.interest_rate||0),periods:term,firstDueDate:String(d.get("firstDue")),frequency:product?.repayment_frequency||"monthly",method:product?.interest_method||"flat",installmentType:product?.installment_method||"equal_total"});setPreview(schedule);void onSubmit({borrower_id:d.get("borrower"),loan_product_id:d.get("product"),amount_requested:amount,proposed_term:term,repayment_frequency:product?.repayment_frequency||"monthly",purpose:d.get("purpose"),proposed_first_repayment_date:d.get("firstDue"),indicative_installment:schedule[0]?.total||0,indicative_interest:schedule.reduce((s,r)=>s+r.interest,0),indicative_fees:totalFees,indicative_net_disbursement:amount-deducted,status:"submitted",application_date:new Date().toISOString().slice(0,10)},f)}}><SelectRecords name="borrower" label="Borrower" rows={borrowers} text={(r:Row)=>`${r.borrower_number||""} ${r.full_name}`}/><SelectRecords name="product" label="Loan product" rows={products} text={(r:Row)=>r.name}/><Input name="amount" label="Amount requested" type="number" required/><Input name="term" label="Number of periods" type="number" required/><Input name="firstDue" label="First repayment date" type="date" required/><div className="lg:col-span-2"><Input name="purpose" label="Loan purpose" required/></div><div className="flex items-end"><Submit disabled={disabled}>Submit application</Submit></div></form></FormPanel>{preview.length>0&&<Panel title="Indicative schedule"><Table headers={["#","Due date","Opening","Principal","Interest","Total","Closing"]} rows={preview.map(r=>[r.installmentNumber,r.dueDate,money(r.openingPrincipal),money(r.principal),money(r.interest),money(r.total),money(r.closingPrincipal)])}/></Panel>}<Table headers={["Application","Borrower","Product","Requested","Fees","Net proceeds","Instalment","Status","Action"]} rows={rows.map((r:Row)=>[r.application_number||"Pending",r.mf_borrowers?.full_name,r.mf_loan_products?.name,money(r.amount_requested),money(r.indicative_fees),money(r.indicative_net_disbursement),money(r.indicative_installment),r.status,<ActionButton key={r.id} disabled={disabled} onClick={()=>edit(r)}>Edit</ActionButton>])}/></div>;
}

function Approvals({ applications, loans, disbursements, disabled, onDecision, onReferBack, onDisburse }: any) {
  const pending = applications.filter((r: Row) => ["submitted", "under_appraisal", "recommended"].includes(r.status));
  const readyLoans = loans.filter((r: Row) => ["approved", "ready_for_disbursement"].includes(r.status));
  const decide = (row: Row, decision: "approved" | "rejected") => {
    if (decision === "rejected") {
      const reason = prompt("Reason for rejection");
      if (reason?.trim()) void onDecision(row, decision, { reason: reason.trim() });
      return;
    }
    const amount = prompt("Approved amount", String(row.amount_requested));
    if (amount === null || Number(amount) <= 0) return;
    const product = row.mf_loan_products;
    const rate = prompt("Approved interest rate (%)", String(product?.interest_rate || 0));
    if (rate === null || Number(rate) < 0) return;
    const term = prompt("Approved term", String(row.proposed_term));
    if (term === null || Number(term) <= 0) return;
    const conditions = prompt("Approval conditions (optional)", "") ?? "";
    void onDecision(row, decision, { amount: Number(amount), rate: Number(rate), term: Number(term), conditions });
  };
  const referBack=(row:Row)=>{const reason=prompt("Reason for referring this application back");if(reason?.trim())void onReferBack(row.id,`Referred back by approver: ${reason.trim()}`);};
  const disburse = (loan: Row) => {
    const amount = prompt("Amount to disburse", String(loan.principal));
    if (amount === null || Number(amount) <= 0) return;
    const expectedNet = Number(loan.mf_loan_applications?.indicative_net_disbursement ?? loan.principal);
    const expectedDeduction = Math.max(0, Number(loan.principal) - expectedNet);
    const charges = prompt("Upfront/deducted charges", String(expectedDeduction));
    if (charges === null || Number(charges) < 0 || Number(charges) >= Number(amount)) return;
    const method = prompt("Method: cash, bank, mobile_money, cheque or transfer", "bank");
    if (!method || !["cash", "bank", "mobile_money", "cheque", "transfer"].includes(method)) return;
    const reference = prompt("Disbursement reference", `DSB-${Date.now()}`);
    if (!reference?.trim()) return;
    const transactionReference = prompt("Bank/mobile/cheque reference (optional)", "") ?? "";
    void onDisburse(loan, { amount: Number(amount), charges: Number(charges), method, reference: reference.trim(), transactionReference });
  };
  return <div className="space-y-5">
    <Cards items={[
      { label: "Awaiting approval", value: pending.length, icon: Briefcase },
      { label: "Ready to disburse", value: readyLoans.length, icon: Banknote },
      { label: "Disbursed transactions", value: disbursements.length, icon: Banknote },
    ]}/>
    <Panel title="Applications awaiting decision">
      <Table headers={["Application","Borrower","Product","Requested","Term","Status","Actions"]} rows={pending.map((r:Row)=>[
        r.application_number || "Pending", r.mf_borrowers?.full_name, r.mf_loan_products?.name,
        money(r.amount_requested), r.proposed_term, r.status,
        <div key={r.id} className="flex gap-2">
          <ActionButton disabled={disabled} onClick={()=>decide(r,"approved")}>Approve</ActionButton>
          <button type="button" disabled={disabled} onClick={()=>referBack(r)} className="rounded-md border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-40">Refer back</button>
          <button type="button" disabled={disabled} onClick={()=>decide(r,"rejected")} className="rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40">Reject</button>
        </div>,
      ])}/>
    </Panel>
    <Panel title="Approved loans awaiting disbursement">
      <Table headers={["Loan","Borrower","Principal","Status","Action"]} rows={readyLoans.map((r:Row)=>[
        r.loan_number || "Pending", r.mf_borrowers?.full_name, money(r.principal), r.status,
        <ActionButton key={r.id} disabled={disabled} onClick={()=>disburse(r)}>Disburse</ActionButton>,
      ])}/>
    </Panel>
    <Panel title="Disbursement history">
      <Table headers={["Reference","Amount","Net amount","Method","Date","Posted"]} rows={disbursements.map((r:Row)=>[
        r.disbursement_reference, money(r.amount), money(r.net_amount), r.method,
        String(r.disbursed_at || "").slice(0,10), r.journal_entry_id ? "Yes" : "No",
      ])}/>
    </Panel>
  </div>;
}

function Collections({ loans, repayments, disabled, onSubmit, onUpdate, onReverse }: any) {
  const act=(r:Row)=>{if(r.status==="posted"){const reason=prompt("Reason for reversing this posted repayment");if(reason?.trim())void onReverse(r.id,reason.trim());return;}const amount=prompt("Amount",String(r.amount));if(amount===null)return;const date=prompt("Payment date",r.payment_date);if(date===null)return;const reference=prompt("External reference",r.external_reference||"");if(reference===null)return;void onUpdate(r.id,{amount:Number(amount),payment_date:date,external_reference:reference});};
  return <div className="grid gap-5 xl:grid-cols-[390px_1fr]"><FormPanel title="Record repayment"><form className="space-y-3" onSubmit={(e)=>{e.preventDefault();const f=e.currentTarget,d=new FormData(f);void onSubmit({loan_id:d.get("loan"),amount:Number(d.get("amount")),payment_date:d.get("date"),payment_method:d.get("method"),external_reference:d.get("reference"),status:"pending_posting"},f)}}><SelectRecords name="loan" label="Loan" rows={loans} text={(r:Row)=>`${r.loan_number||""} ${r.mf_borrowers?.full_name||""}`}/><Input name="amount" label="Amount received" type="number" required/><Input name="date" label="Payment date" type="date" required/><Select name="method" label="Method" options={["cash","bank","mobile_money","cheque"]}/><Input name="reference" label="Receipt / external reference" required/><Submit disabled={disabled}>Record for posting</Submit><p className="text-xs text-slate-500">Pending records can be edited. Posted repayments can only be corrected by reversal.</p></form></FormPanel><Table headers={["Date","Reference","Method","Amount","Status","Action"]} rows={repayments.map((r:Row)=>[r.payment_date,r.receipt_number||r.external_reference,r.payment_method,money(r.amount),r.status,<ActionButton key={r.id} disabled={disabled||r.status==="reversed"} onClick={()=>act(r)}>{r.status==="posted"?"Reverse":"Edit"}</ActionButton>])}/></div>;
}

function Risk({ loans, risk }: any) {
  const bands=[1,7,30,60,90,180,365].map(t=>({t,...portfolioAtRisk(risk,t)}));
  return <div className="space-y-5"><Cards items={bands.slice(2,6).map(b=>({label:`PAR ${b.t}`,value:`${money(b.ratio)}%`,icon:AlertTriangle}))}/><Table headers={["Loan","Borrower","Outstanding principal","Days past due","Classification"]} rows={loans.map((r:Row)=>[r.loan_number,r.mf_borrowers?.full_name,money(r.outstanding_principal),r.days_past_due||0,r.classification||"current"])}/></div>;
}

function Reports({ borrowers, applications, loans, repayments }: any) {
  const loanRows:(string|number)[][]=[["Loan number","Borrower","Status","Principal","Outstanding principal","Outstanding interest","Days past due","Classification"],...loans.map((l:Row)=>[l.loan_number,l.mf_borrowers?.full_name||"",l.status,Number(l.principal||0),Number(l.outstanding_principal||0),Number(l.outstanding_interest||0),Number(l.days_past_due||0),l.classification||"current"])];
  const exportPdf=()=>exportAccountingPdf({title:"Microfinance Portfolio Report",filename:"microfinance-portfolio.pdf",sections:[{title:"Loan portfolio",head:loanRows[0].map(String),body:loanRows.slice(1)}]});
  return <div className="space-y-4"><div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={()=>downloadXlsx("microfinance-portfolio.xlsx",loanRows,{sheetName:"Loan Portfolio"})}>Export Excel</button><button className={buttonClass} onClick={()=>downloadCsv("microfinance-portfolio.csv",loanRows)}>Export CSV</button><button className={buttonClass} onClick={exportPdf}>Export PDF</button></div><div className="grid gap-4 md:grid-cols-2"><Panel title="Operational registers"><Metric label="Borrower register" value={borrowers.length}/><Metric label="Loan applications" value={applications.length}/><Metric label="Active-loan register" value={loans.filter((l:Row)=>l.status==="active").length}/></Panel><Panel title="Financial summaries"><Metric label="Gross loan portfolio" value={money(loans.reduce((s:number,l:Row)=>s+Number(l.outstanding_principal||0),0))}/><Metric label="Actual collections" value={money(repayments.reduce((s:number,r:Row)=>s+Number(r.amount||0),0))}/><Metric label="PAR 30 principal" value={money(loans.filter((l:Row)=>Number(l.days_past_due)>=30).reduce((s:number,l:Row)=>s+Number(l.outstanding_principal||0),0))}/></Panel></div><Table headers={loanRows[0].map(String)} rows={loanRows.slice(1)}/></div>;
}

function Panel({ title, children }: any) { return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 font-bold text-slate-900">{title}</h2>{children}</section>; }
function FormPanel({ title, children }: any) { return <Panel title={title}>{children}</Panel>; }
function Metric({ label, value }: any) { return <div className="flex items-center justify-between border-b border-slate-100 py-3 text-sm"><span className="text-slate-600">{label}</span><strong>{value}</strong></div>; }
function Input({ label, ...props }: any) { return <label className="block text-sm font-medium text-slate-700">{label}<input {...props} className={`${inputClass} mt-1`}/></label>; }
function Select({ label, options, ...props }: any) { return <label className="block text-sm font-medium text-slate-700">{label}<select {...props} className={`${inputClass} mt-1`}>{options.map((o:string)=><option key={o} value={o}>{o.replaceAll("_"," ")}</option>)}</select></label>; }
function SelectRecords({ label, rows, text, ...props }: any) { return <label className="block text-sm font-medium text-slate-700">{label}<select {...props} required className={`${inputClass} mt-1`}><option value="">Select…</option>{rows.map((r:Row)=><option key={r.id} value={r.id}>{text(r)}</option>)}</select></label>; }
function Submit({ children, disabled }: any) { return <button disabled={disabled} className={buttonClass}><Plus size={16}/>{children}</button>; }
function ActionButton({ children, disabled, onClick }: any) { return <button type="button" disabled={disabled} onClick={onClick} className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">{children}</button>; }
function Table({ headers, rows }: {headers:string[];rows:any[][]}) { return <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600"><tr>{headers.map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((row,i)=><tr key={i} className="border-t border-slate-100">{row.map((cell,j)=><td key={j} className="whitespace-nowrap px-4 py-3 text-slate-700">{cell??"—"}</td>)}</tr>):<tr><td colSpan={headers.length} className="p-8 text-center text-slate-500">No records yet.</td></tr>}</tbody></table></div>; }
