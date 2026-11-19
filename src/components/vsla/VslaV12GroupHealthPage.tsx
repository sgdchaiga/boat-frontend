import { useCallback, useEffect, useState } from "react";
import { Activity, Info } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";

type Cycle = { id: string; name: string; starts_on: string; status: string };
type Metric = { value: number | null; formula: string; [key: string]: unknown };
type Health = { cycle_name: string; metrics: Record<string, Metric> };
const label = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const percent = (value: number | null) => value == null ? "—" : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

export function VslaV12GroupHealthPage() {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCycles = useCallback(async () => {
    const { data, error: cycleError } = await filterByOrganizationId(supabase.from("vsla_cycles").select("id,name,starts_on,status").order("starts_on", { ascending: false }), orgId, !!isSuperAdmin);
    const rows = (data ?? []) as Cycle[];
    setCycles(rows); setCycleId((current) => current || rows.find((row) => row.status === "active")?.id || rows[0]?.id || ""); setError(cycleError?.message ?? null);
  }, [isSuperAdmin, orgId]);
  useEffect(() => { void loadCycles(); }, [loadCycles]);
  useEffect(() => { let live = true; void (async () => { if (!cycleId) { if (live) setLoading(false); return; } setLoading(true); const { data, error: healthError } = await supabase.rpc("vsla_v12_group_health", { p_cycle_id: cycleId }); if (live) { setHealth((data as Health | null) ?? null); setError(healthError?.message ?? null); setLoading(false); } })(); return () => { live = false; }; }, [cycleId]);

  const metrics = Object.entries(health?.metrics ?? {});
  return <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5"><div className="flex gap-3"><Activity className="mt-0.5 h-6 w-6 text-indigo-700"/><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-700">VSLA v1.2 · Phase 5</p><h1 className="mt-1 text-2xl font-bold text-slate-900">Group health dashboard</h1><p className="mt-1 text-sm text-slate-700">Cycle-scoped indicators are calculated from controlled records. They inform group decisions; they do not alter financial balances or lending decisions.</p></div></div></div>
    <label className="block max-w-md text-sm font-medium text-slate-700">Savings cycle<select value={cycleId} onChange={(event) => setCycleId(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name} · {cycle.status}</option>)}</select></label>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {loading ? <p className="text-sm text-slate-600">Calculating indicators…</p> : metrics.length === 0 ? <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">No controlled-cycle data is available yet.</p> : <><section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([key, metric]) => <article key={key} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label(key)}</p><p className="mt-2 text-2xl font-bold text-slate-900">{key === "cycle_profitability" ? "Not available" : percent(metric.value)}</p>{typeof metric.settled_amount === "number" && <p className="mt-1 text-xs text-slate-500">Settled: {Number(metric.settled_amount).toLocaleString()} / {Number(metric.scheduled_amount ?? 0).toLocaleString()}</p>}</article>)}</section><section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Info className="h-5 w-5 text-indigo-700"/><h2 className="font-semibold text-slate-900">Indicator formulas</h2></div><div className="mt-4 divide-y divide-slate-100">{metrics.map(([key, metric]) => <div key={key} className="py-3"><p className="font-medium text-slate-900">{label(key)}</p><p className="mt-1 text-sm text-slate-600">{metric.formula}</p></div>)}</div></section></>}
  </main>;
}
