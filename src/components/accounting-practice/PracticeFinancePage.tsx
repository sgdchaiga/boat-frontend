import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, CircleDollarSign, RefreshCw, TrendingUp } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";
type Client = { id: string; name: string; email: string | null; renewal_date: string | null; subscription_plan: string | null; subscription_status: string };
type Engagement = { id: string; client_id: string; title: string; engagement_number: string | null; contract_value: number };
type Invoice = { id: string; invoice_number: string; practice_engagement_id: string | null; customer_name: string; issue_date: string; due_date: string | null; total: number; status: string };
type Profit = { engagement_id: string; engagement_number: string | null; title: string; service_type: string; contract_value: number; amount_invoiced: number; amount_collected: number; actual_hours: number; actual_staff_cost: number; direct_expenses: number; gross_profit: number; profit_margin: number; unbilled_contract_value: number; client_id: string };
const money = (value: number) => `UGX ${Number(value || 0).toLocaleString("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PracticeFinancePage({ mode, readOnly = false }: { mode: "billing" | "renewals" | "profitability"; readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [clients, setClients] = useState<Client[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [profits, setProfits] = useState<Profit[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ issue_date: new Date().toISOString().slice(0, 10), tax_rate: "0" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [clientResult, engagementResult, invoiceResult, profitResult] = await Promise.all([
      db.from("practice_clients").select("id,name,email,renewal_date,subscription_plan,subscription_status").eq("organization_id", orgId).order("name"),
      db.from("practice_engagements").select("id,client_id,title,engagement_number,contract_value").eq("organization_id", orgId).order("title"),
      db.from("retail_invoices").select("id,invoice_number,practice_engagement_id,customer_name,issue_date,due_date,total,status").eq("organization_id", orgId).not("practice_engagement_id", "is", null).order("issue_date", { ascending: false }),
      db.from("practice_engagement_financial_summary").select("*").eq("organization_id", orgId).order("title"),
    ]);
    const error = clientResult.error || engagementResult.error || invoiceResult.error || profitResult.error;
    if (error) setMessage(error.message); else { setClients(clientResult.data || []); setEngagements(engagementResult.data || []); setInvoices(invoiceResult.data || []); setProfits(profitResult.data || []); }
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const selectedEngagement = engagements.find((item) => item.id === form.engagement_id);
  const selectedClient = clients.find((item) => item.id === selectedEngagement?.client_id);
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name || "Unknown client";
  const totals = useMemo(() => profits.reduce((sum, item) => ({ invoiced: sum.invoiced + Number(item.amount_invoiced || 0), collected: sum.collected + Number(item.amount_collected || 0), profit: sum.profit + Number(item.gross_profit || 0), unbilled: sum.unbilled + Number(item.unbilled_contract_value || 0) }), { invoiced: 0, collected: 0, profit: 0, unbilled: 0 }), [profits]);

  const createInvoice = async () => {
    if (!orgId || !selectedEngagement || !selectedClient || Number(form.amount || 0) <= 0) { setMessage("Select an engagement and enter an amount greater than zero."); return; }
    setSaving(true); setMessage("");
    const subtotal = Number(form.amount); const taxRate = Number(form.tax_rate || 0); const taxAmount = subtotal * taxRate / 100; const total = subtotal + taxAmount;
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const invoiceResult = await db.from("retail_invoices").insert({ organization_id: orgId, invoice_number: invoiceNumber, customer_name: selectedClient.name, customer_email: selectedClient.email, issue_date: form.issue_date, due_date: form.due_date || null, status: "draft", notes: form.notes || `Engagement: ${selectedEngagement.title}`, subtotal, tax_rate: taxRate, tax_amount: taxAmount, total, created_by: user?.id || null, practice_client_id: selectedClient.id, practice_engagement_id: selectedEngagement.id }).select("id").single();
    if (invoiceResult.error) { setMessage(invoiceResult.error.message); setSaving(false); return; }
    const lineResult = await db.from("retail_invoice_lines").insert({ invoice_id: invoiceResult.data.id, line_no: 1, description: form.description || selectedEngagement.title, quantity: 1, unit_price: subtotal, line_total: subtotal });
    if (lineResult.error) setMessage(`Invoice header created, but its line failed: ${lineResult.error.message}`); else setMessage(`${invoiceNumber} created in BOAT's invoice engine.`);
    setSaving(false); setForm({ issue_date: new Date().toISOString().slice(0, 10), tax_rate: "0" }); await load();
  };

  const saveRenewal = async () => {
    if (!form.client_id) return;
    const result = await db.from("practice_clients").update({ subscription_plan: form.subscription_plan || null, subscription_status: form.subscription_status || "active", renewal_date: form.renewal_date || null }).eq("id", form.client_id).eq("organization_id", orgId);
    if (result.error) setMessage(result.error.message); else { setMessage("Subscription renewal details updated."); setForm({}); await load(); }
  };

  const meta = mode === "billing" ? { title: "Engagement Billing", description: "Create invoices in BOAT's existing invoice engine and retain the engagement link.", icon: CircleDollarSign } : mode === "renewals" ? { title: "Subscription Renewals", description: "Monitor client plans, renewal dates and subscription status.", icon: CalendarClock } : { title: "Engagement Profitability", description: "Compare linked invoices, collections, staff cost, direct expenses and unbilled value.", icon: TrendingUp };
  const Icon = meta.icon;
  return <div className="space-y-6 p-4 sm:p-6 md:p-8">{readOnly && <ReadOnlyNotice/>}<div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Icon className="h-7 w-7 text-brand-700"/><h1 className="text-3xl font-bold text-slate-900">{meta.title}</h1></div><p className="mt-1 text-sm text-slate-500">{meta.description}</p></div><button className="app-btn-secondary" onClick={() => void load()}><RefreshCw className="h-4 w-4"/> Refresh</button></div>{message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">{message}</div>}
    {mode === "billing" && <><div className="grid gap-3 sm:grid-cols-3"><Metric label="Amount invoiced" value={money(totals.invoiced)}/><Metric label="Amount collected" value={money(totals.collected)}/><Metric label="Unbilled contract value" value={money(totals.unbilled)}/></div><section className="rounded-xl border bg-white p-4"><h2 className="mb-4 font-semibold">Create engagement invoice</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><select className={input} value={form.engagement_id || ""} onChange={(e) => setForm({ ...form, engagement_id: e.target.value })}><option value="">Select engagement *</option>{engagements.map((item) => <option key={item.id} value={item.id}>{item.engagement_number || "ENG"} · {item.title}</option>)}</select><input className={input} value={selectedClient?.name || "Client selected from engagement"} disabled/><input className={input} type="number" min="0" placeholder="Invoice amount *" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })}/><input className={input} type="number" min="0" max="100" placeholder="Tax rate %" value={form.tax_rate || "0"} onChange={(e) => setForm({ ...form, tax_rate: e.target.value })}/><input className={input} type="date" value={form.issue_date || ""} onChange={(e) => setForm({ ...form, issue_date: e.target.value })}/><input className={input} type="date" value={form.due_date || ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })}/><input className={`${input} md:col-span-2`} placeholder="Invoice line description" value={form.description || ""} onChange={(e) => setForm({ ...form, description: e.target.value })}/></div><button className="app-btn-primary mt-4" disabled={readOnly || saving} onClick={() => void createInvoice()}>{saving ? "Creating…" : "Create draft invoice"}</button></section><InvoiceTable rows={invoices}/></>}
    {mode === "renewals" && <><section className="rounded-xl border bg-white p-4"><h2 className="mb-4 font-semibold">Update client subscription</h2><div className="grid gap-3 md:grid-cols-4"><select className={input} value={form.client_id || ""} onChange={(e) => { const client = clients.find((item) => item.id === e.target.value); setForm({ client_id: e.target.value, subscription_plan: client?.subscription_plan || "", subscription_status: client?.subscription_status || "active", renewal_date: client?.renewal_date || "" }); }}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><input className={input} placeholder="Subscription plan" value={form.subscription_plan || ""} onChange={(e) => setForm({ ...form, subscription_plan: e.target.value })}/><select className={input} value={form.subscription_status || "active"} onChange={(e) => setForm({ ...form, subscription_status: e.target.value })}><option value="active">Active</option><option value="trial">Trial</option><option value="past_due">Past due</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option><option value="not_applicable">Not applicable</option></select><input className={input} type="date" value={form.renewal_date || ""} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })}/></div><button className="app-btn-primary mt-4" disabled={readOnly || !form.client_id} onClick={() => void saveRenewal()}>Save renewal</button></section><RenewalTable rows={clients}/></>}
    {mode === "profitability" && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Invoiced" value={money(totals.invoiced)}/><Metric label="Collected" value={money(totals.collected)}/><Metric label="Gross profit" value={money(totals.profit)}/><Metric label="Unbilled value" value={money(totals.unbilled)}/></div><ProfitTable rows={profits} clientName={clientName}/></>}
  </div>;
}

function InvoiceTable({ rows }: { rows: Invoice[] }) { return <Table heads={["Invoice", "Client", "Date", "Due", "Total", "Status"]} rows={rows.map((row) => [row.invoice_number, row.customer_name, row.issue_date, row.due_date || "—", money(row.total), row.status])}/>; }
function RenewalTable({ rows }: { rows: Client[] }) { const cutoff = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10); return <Table heads={["Client", "Plan", "Renewal date", "Status", "Attention"]} rows={rows.filter((row) => row.subscription_status !== "not_applicable" || row.renewal_date).sort((a,b) => (a.renewal_date || "9999").localeCompare(b.renewal_date || "9999")).map((row) => [row.name, row.subscription_plan || "—", row.renewal_date || "Not set", row.subscription_status.replaceAll("_", " "), row.renewal_date && row.renewal_date <= cutoff ? "Due within 60 days" : "—"])}/>; }
function ProfitTable({ rows, clientName }: { rows: Profit[]; clientName: (id: string) => string }) { return <Table heads={["Engagement", "Client", "Contract", "Invoiced", "Collected", "Hours", "Staff cost", "Expenses", "Profit", "Margin", "Unbilled"]} rows={rows.map((row) => [row.engagement_number || row.title, clientName(row.client_id), money(row.contract_value), money(row.amount_invoiced), money(row.amount_collected), Number(row.actual_hours).toFixed(1), money(row.actual_staff_cost), money(row.direct_expenses), money(row.gross_profit), `${Number(row.profit_margin).toFixed(1)}%`, money(row.unbilled_contract_value)])}/>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></div>; }
function Table({ heads, rows }: { heads: string[]; rows: Array<Array<string>> }) { return <section className="overflow-hidden rounded-xl border bg-white"><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{heads.map((head) => <th key={head} className="p-3">{head}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t">{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap p-3">{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="p-8 text-center text-sm text-slate-500">No records yet.</p>}</div></section>; }
