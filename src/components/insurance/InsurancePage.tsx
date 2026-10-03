import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Plus, RefreshCw, Shield, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Tab = "dashboard" | "customers" | "quotes" | "policies" | "renewals" | "claims" | "commissions" | "setup";
type Policy = { id: string; policy_number: string; customer_name: string; product_name: string; insurer_name: string; premium_amount: number; expiry_date: string; status: string };
const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" }, { id: "customers", label: "Customers" }, { id: "quotes", label: "Quotations" },
  { id: "policies", label: "Policies" }, { id: "renewals", label: "Renewals" }, { id: "claims", label: "Claims" },
  { id: "commissions", label: "Commissions" }, { id: "setup", label: "Setup" },
];
const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);
const date = (value?: string) => value ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)) : "—";

export function InsurancePage({ readOnly = false, initialTab = "dashboard" }: { readOnly?: boolean; initialTab?: Tab }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showQuote, setShowQuote] = useState(false);
  const [quote, setQuote] = useState({ customer_name: "", product_category: "Motor", sum_insured: "" });

  const load = useCallback(async () => {
    if (!user?.organization_id) return;
    setLoading(true); setError(null);
    const { data, error: queryError } = await supabase.from("insurance_policies")
      .select("id,policy_number,customer_name,product_name,insurer_name,premium_amount,expiry_date,status")
      .eq("organization_id", user.organization_id).order("expiry_date", { ascending: true });
    if (queryError) setError("Insurance data is not available yet. Apply the Insurance migration to activate shared records.");
    else setPolicies((data ?? []) as Policy[]);
    setLoading(false);
  }, [user?.organization_id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (tabs.some((item) => item.id === initialTab)) setTab(initialTab); }, [initialTab]);

  const expiring = useMemo(() => policies.filter((p) => {
    const days = (new Date(`${p.expiry_date}T00:00:00`).getTime() - Date.now()) / 86400000;
    return days <= 30 && days >= -1;
  }), [policies]);
  const totalPremium = policies.reduce((sum, p) => sum + Number(p.premium_amount || 0), 0);
  const startQuote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.organization_id) return;
    const { error: insertError } = await supabase.from("insurance_quotes").insert({
      organization_id: user.organization_id, customer_name: quote.customer_name, product_category: quote.product_category,
      sum_insured: Number(quote.sum_insured || 0), status: "requested",
    });
    if (insertError) { setError("Could not save the quotation request. Confirm the Insurance migration has been applied."); return; }
    setShowQuote(false); setQuote({ customer_name: "", product_category: "Motor", sum_insured: "" }); setTab("quotes");
  };
  const title = tabs.find((item) => item.id === tab)?.label;
  return <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-blue-700">BOAT Insurance</p><h1 className="text-2xl font-bold text-slate-900">{title}</h1><p className="mt-1 text-sm text-slate-600">Manage cover, renewals, claims and commission from one shared workspace.</p></div>
      <button type="button" disabled={readOnly} onClick={() => setShowQuote(true)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:opacity-50"><Plus size={18} /> Get insurance quote</button></div>
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">{tabs.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium ${tab === item.id ? "border-blue-700 text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{item.label}</button>)}</div>
    {error && <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle size={18} />{error}</div>}
    {tab === "dashboard" && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Kpi icon={<Shield />} label="Active policies" value={String(policies.filter((p) => p.status === "active").length)} /><Kpi icon={<FileText />} label="Premiums facilitated" value={money(totalPremium)} /><Kpi icon={<CheckCircle2 />} label="Expected commission" value={money(totalPremium * 0.1)} /><Kpi icon={<AlertTriangle />} label="Expiring in 30 days" value={String(expiring.length)} /></div>
      <section className="rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b p-4"><div><h2 className="font-semibold text-slate-900">Upcoming renewals</h2><p className="text-sm text-slate-500">Prioritise policies that need action.</p></div><button onClick={() => void load()} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><RefreshCw size={18} /></button></div><PolicyTable rows={expiring} empty="No policies are due for renewal in the next 30 days." /></section>
    </>}
    {tab === "policies" && <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Policy register</h2><p className="text-sm text-slate-500">One policy may cover multiple BOAT assets, people or locations.</p></div><PolicyTable rows={policies} empty={loading ? "Loading policies…" : "No policies have been issued yet."} /></section>}
    {tab === "renewals" && <section className="rounded-xl border border-slate-200 bg-white"><div className="border-b p-4"><h2 className="font-semibold">Renewal worklist</h2><p className="text-sm text-slate-500">Expired, 7-day, 30-day, 60-day and 90-day reminders are configured in Setup.</p></div><PolicyTable rows={policies} empty="No renewal records yet." /></section>}
    {tab === "customers" && <Empty icon={<Users />} title="Insurance customers" text="Customer records are shared with BOAT. Add insurance-specific KYC, policies, claims and documents on the customer profile." action="Open customer register" />}
    {tab === "quotes" && <Empty icon={<FileText />} title="Quotation requests" text="Request insurer options, compare actual insurer terms, then accept the selected option into a policy." action="Create quotation" onAction={() => setShowQuote(true)} />}
    {tab === "claims" && <Empty icon={<AlertTriangle />} title="Claims register" text="Track a claim from incident report and evidence through insurer review, settlement and closure." action="Report claim" />}
    {tab === "commissions" && <Empty icon={<CheckCircle2 />} title="Commission tracking" text="Commission rates stay configurable by insurer and product. Track earned, received and outstanding revenue separately from premiums." action="View commission setup" />}
    {tab === "setup" && <Empty icon={<Shield />} title="Insurance setup" text="Configure insurers, products, commission structures, required documents, policy numbering, reminder rules and GL mappings." action="Configure insurers" />}
    {showQuote && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><form onSubmit={startQuote} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"><h2 className="text-lg font-bold">Request an insurance quote</h2><p className="mt-1 text-sm text-slate-500">BOAT will request terms; it does not create an insurer recommendation.</p><div className="mt-5 space-y-4"><label className="block text-sm font-medium">Customer name<input required value={quote.customer_name} onChange={(e) => setQuote({ ...quote, customer_name: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label><label className="block text-sm font-medium">Cover type<select value={quote.product_category} onChange={(e) => setQuote({ ...quote, product_category: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">{["Motor", "Property / Fire", "Personal Accident", "Medical", "Agriculture", "Travel", "Other"].map((v) => <option key={v}>{v}</option>)}</select></label><label className="block text-sm font-medium">Sum insured (UGX)<input type="number" min="0" value={quote.sum_insured} onChange={(e) => setQuote({ ...quote, sum_insured: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label></div><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setShowQuote(false)} className="rounded-lg px-4 py-2 text-sm font-semibold">Cancel</button><button className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Save request</button></div></form></div>}
  </div>;
}
function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-blue-700">{icon}<span className="text-sm font-medium text-slate-600">{label}</span></div><p className="mt-3 text-2xl font-bold text-slate-900">{value}</p></div>; }
function Empty({ icon, title, text, action, onAction }: { icon: React.ReactNode; title: string; text: string; action: string; onAction?: () => void }) { return <div className="rounded-xl border border-slate-200 bg-white p-10 text-center"><div className="mx-auto mb-3 w-fit text-blue-700">{icon}</div><h2 className="font-semibold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm text-slate-600">{text}</p><button onClick={onAction} className="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50">{action}</button></div>; }
function PolicyTable({ rows, empty }: { rows: Policy[]; empty: string }) { return rows.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Policy</th><th className="p-3">Customer</th><th className="p-3">Cover</th><th className="p-3">Insurer</th><th className="p-3 text-right">Premium</th><th className="p-3">Expiry</th><th className="p-3">Status</th></tr></thead><tbody>{rows.map((p) => <tr key={p.id} className="border-t border-slate-100"><td className="p-3 font-medium">{p.policy_number}</td><td className="p-3">{p.customer_name}</td><td className="p-3">{p.product_name}</td><td className="p-3">{p.insurer_name}</td><td className="p-3 text-right">{money(Number(p.premium_amount))}</td><td className="p-3">{date(p.expiry_date)}</td><td className="p-3"><span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{p.status}</span></td></tr>)}</tbody></table></div> : <div className="p-10 text-center text-sm text-slate-500">{empty}</div>; }
