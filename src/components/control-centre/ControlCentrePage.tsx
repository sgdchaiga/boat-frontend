import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock3, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type ControlException = {
  id: string;
  exception_reference: string;
  title: string;
  control_area: string;
  severity: "critical" | "high" | "warning" | "low";
  amount_at_risk: number;
  detected_at: string;
  due_date: string | null;
  status: string;
};

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "UGX", maximumFractionDigits: 0 });

export function ControlCentrePage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ControlException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState("all");
  const [showReferral, setShowReferral] = useState(false);
  const [savingReferral, setSavingReferral] = useState(false);
  const [referral, setReferral] = useState({ title: "", description: "", controlArea: "operations", severity: "warning", amountAtRisk: "" });

  const load = useCallback(async () => {
    if (!user?.organization_id) return;
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("control_exceptions" as never)
      .select("id,exception_reference,title,control_area,severity,amount_at_risk,detected_at,due_date,status")
      .eq("organization_id", user.organization_id)
      .order("detected_at", { ascending: false })
      .limit(100);
    if (queryError) setError(queryError.message);
    setRows((data ?? []) as ControlException[]);
    setLoading(false);
  }, [user?.organization_id]);

  useEffect(() => { void load(); }, [load]);

  const submitReferral = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.organization_id || !referral.title.trim()) return;
    setSavingReferral(true); setError(null);
    const { error: rpcError } = await supabase.rpc("create_control_exception", {
      p_organization_id: user.organization_id, p_module_key: "control_centre", p_control_area: referral.controlArea,
      p_title: referral.title.trim(), p_description: referral.description.trim() || null, p_severity: referral.severity,
      p_amount_at_risk: Number(referral.amountAtRisk || 0),
    });
    setSavingReferral(false);
    if (rpcError) { setError(rpcError.message); return; }
    setReferral({ title: "", description: "", controlArea: "operations", severity: "warning", amountAtRisk: "" }); setShowReferral(false); await load();
  };

  const areas = useMemo(() => [...new Set(rows.map((row) => row.control_area))].sort(), [rows]);
  const filtered = area === "all" ? rows : rows.filter((row) => row.control_area === area);
  const now = Date.now();
  const open = filtered.filter((row) => row.status !== "resolved");
  const overdue = open.filter((row) => row.due_date && new Date(row.due_date).getTime() < now);
  const critical = open.filter((row) => row.severity === "critical");
  const valueAtRisk = open.reduce((sum, row) => sum + Number(row.amount_at_risk || 0), 0);

  return <div className="space-y-6 p-6 md:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-semibold text-brand-700">BOAT Control Centre</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Priority exceptions</h1><p className="mt-2 text-sm text-slate-600">A shared register for control issues, ownership and resolution. Automated control packs will populate this queue in the next phase.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => setShowReferral(true)} className="app-btn-primary inline-flex items-center gap-2"><Plus className="h-4 w-4"/>Send to Control Centre</button><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary inline-flex items-center gap-2"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}/>Refresh</button></div>
    </div>

    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <label className="text-xs font-semibold text-slate-600">Control area<select value={area} onChange={(event) => setArea(event.target.value)} className="mt-1 block min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="all">All areas</option>{areas.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>

    {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Could not load the Control Centre: {error}</div> : null}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<AlertTriangle className="h-5 w-5"/>} label="Critical exceptions" value={critical.length} tone="rose"/>
      <Metric icon={<ShieldCheck className="h-5 w-5"/>} label="Open exceptions" value={open.length} tone="amber"/>
      <Metric icon={<Clock3 className="h-5 w-5"/>} label="Overdue" value={overdue.length} tone="orange"/>
      <Metric icon={<CircleDollarSign className="h-5 w-5"/>} label="Value at risk" value={money.format(valueAtRisk)} tone="slate"/>
    </section>

    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Today’s priority exceptions</h2><p className="mt-1 text-sm text-slate-500">Sorted by severity, potential exposure and detection time.</p></div>
      {loading ? <p className="p-6 text-sm text-slate-500">Loading exceptions…</p> : filtered.length === 0 ? <div className="p-8 text-center"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600"/><p className="mt-3 font-semibold text-slate-900">No exceptions in this view</p><p className="mt-1 text-sm text-slate-500">The register is ready for manual referrals and the first automated hotel controls.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Exception</th><th className="p-3">Area</th><th className="p-3">Severity</th><th className="p-3 text-right">Value at risk</th><th className="p-3">Detected</th><th className="p-3">Status</th></tr></thead><tbody>{filtered.sort(priorityCompare).map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="p-3"><p className="font-semibold text-slate-900">{row.title}</p><p className="text-xs text-slate-500">{row.exception_reference}</p></td><td className="p-3 capitalize">{row.control_area}</td><td className="p-3"><Severity severity={row.severity}/></td><td className="p-3 text-right font-medium">{money.format(Number(row.amount_at_risk || 0))}</td><td className="p-3 whitespace-nowrap text-slate-600">{new Date(row.detected_at).toLocaleString()}</td><td className="p-3 capitalize">{row.status.replaceAll("_", " ")}</td></tr>)}</tbody></table></div>}
    </section>
    {showReferral ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><form onSubmit={(event) => void submitReferral(event)} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl"><div><h2 className="text-xl font-bold">Send to Control Centre</h2><p className="mt-1 text-sm text-slate-500">Create a manual exception. Transaction-linked referral controls will reuse this workflow.</p></div><label className="block text-sm font-medium">Title<input required value={referral.title} onChange={(event) => setReferral({ ...referral, title: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Control area<select value={referral.controlArea} onChange={(event) => setReferral({ ...referral, controlArea: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="operations">Operations</option><option value="revenue">Revenue assurance</option><option value="cash_treasury">Cash & treasury</option><option value="stock">Stock control</option><option value="user_system">User & system controls</option></select></label><label className="text-sm font-medium">Severity<select value={referral.severity} onChange={(event) => setReferral({ ...referral, severity: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="warning">Warning</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label></div><label className="block text-sm font-medium">Potential value at risk<input type="number" min="0" step="0.01" value={referral.amountAtRisk} onChange={(event) => setReferral({ ...referral, amountAtRisk: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="block text-sm font-medium">Reason and comments<textarea value={referral.description} onChange={(event) => setReferral({ ...referral, description: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2" rows={3}/></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowReferral(false)} className="app-btn-secondary">Cancel</button><button disabled={savingReferral} className="app-btn-primary">{savingReferral ? "Saving…" : "Create exception"}</button></div></form></div> : null}
  </div>;
}

function priorityCompare(a: ControlException, b: ControlException) {
  const ranks = { critical: 0, high: 1, warning: 2, low: 3 };
  return ranks[a.severity] - ranks[b.severity] || Number(b.amount_at_risk) - Number(a.amount_at_risk) || +new Date(a.detected_at) - +new Date(b.detected_at);
}
function Severity({ severity }: { severity: ControlException["severity"] }) { const tone = severity === "critical" ? "bg-rose-100 text-rose-800" : severity === "high" ? "bg-orange-100 text-orange-800" : severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"; return <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${tone}`}>{severity}</span>; }
function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string | number; tone: "rose" | "amber" | "orange" | "slate" }) { const classes = { rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700", orange: "bg-orange-50 text-orange-700", slate: "bg-slate-100 text-slate-700" }; return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className={`inline-flex rounded-lg p-2 ${classes[tone]}`}>{icon}</div><p className="mt-3 text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>; }
