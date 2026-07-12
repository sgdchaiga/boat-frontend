import { useEffect, useState } from "react";
import { Activity, Save, Smartphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { defaultLiteShortcuts, loadLiteShortcuts, saveLiteShortcuts, type LiteShortcut } from "@/lib/mobileLiteShortcuts";
import { supabase } from "@/lib/supabase";

type TelemetrySummary = { sessions: number; averageStartupMs: number | null; failures: number; offlineEvents: number };

const ROLES = ["admin", "manager", "accountant", "cashier", "receptionist", "storekeeper", "staff"];

export function AdminMobileLitePage() {
  const { user } = useAuth();
  const [role, setRole] = useState("staff");
  const [rows, setRows] = useState<LiteShortcut[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySummary | null>(null);
  const candidates = defaultLiteShortcuts(user?.business_type ?? null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadLiteShortcuts(user?.organization_id ?? null, role, user?.business_type ?? null).then((next) => {
      if (!active) return;
      setRows(next);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.organization_id, user?.business_type, role]);

  useEffect(() => {
    if (!user?.organization_id) return;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    void supabase.from("mobile_performance_events").select("session_id,event_type,duration_ms").eq("organization_id", user.organization_id).gte("created_at", since).limit(5000).then(({ data }) => {
      if (!data) return;
      const starts = data.filter((row) => row.event_type === "startup" && typeof row.duration_ms === "number");
      setTelemetry({
        sessions: new Set(starts.map((row) => row.session_id)).size,
        averageStartupMs: starts.length ? Math.round(starts.reduce((sum, row) => sum + Number(row.duration_ms), 0) / starts.length) : null,
        failures: data.filter((row) => row.event_type === "request_failed" || row.event_type === "app_error" || row.event_type === "sync_failed").length,
        offlineEvents: data.filter((row) => row.event_type === "offline").length,
      });
    });
  }, [user?.organization_id]);

  const toggle = (item: LiteShortcut) => {
    const selected = rows.some((row) => row.page === item.page);
    setRows(selected ? rows.filter((row) => row.page !== item.page) : [...rows, item].slice(0, 6));
  };

  const save = async () => {
    setMessage("Saving…");
    const result = await saveLiteShortcuts(user?.organization_id ?? null, role, rows);
    setMessage(result.error ? `Saved on this device only: ${result.error}` : result.savedRemotely ? "Saved for the organization." : "Saved on this device; cloud sync is unavailable.");
  };

  return (
    <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start gap-3"><Smartphone className="mt-0.5 h-6 w-6 text-brand-700" /><div><h2 className="text-lg font-bold text-slate-900">BOAT Lite policies</h2><p className="text-sm text-slate-500">Choose the phone shortcuts shown to each role. Page permissions still take precedence.</p></div></div>
      <label className="block max-w-sm text-sm font-semibold text-slate-700">Configure role<select value={role} onChange={(event) => { setRole(event.target.value); setMessage(null); }} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal">{ROLES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      {loading ? <p className="text-sm text-slate-500">Loading policy…</p> : <div className="grid gap-2 sm:grid-cols-2">{candidates.map((item) => <label key={item.page} className="flex min-h-16 items-start gap-3 rounded-lg border p-3"><input className="mt-1" type="checkbox" checked={rows.some((row) => row.page === item.page)} onChange={() => toggle(item)} /><span><span className="block text-sm font-semibold text-slate-800">{item.label}</span><span className="text-xs text-slate-500">{item.description}</span></span></label>)}</div>}
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={loading || rows.length === 0} onClick={() => void save()} className="app-btn-primary inline-flex min-h-11 items-center gap-2"><Save className="h-4 w-4" />Save mobile policy</button>{message && <p className="text-xs text-slate-600">{message}</p>}</div>
      <section className="border-t border-slate-200 pt-5">
        <div className="mb-3 flex items-center gap-2"><Activity className="h-5 w-5 text-brand-700" /><div><h3 className="font-bold text-slate-900">Mobile health · last 7 days</h3><p className="text-xs text-slate-500">Privacy-safe operational measurements; no customer or transaction content.</p></div></div>
        {telemetry ? <div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><Metric label="Phone sessions" value={String(telemetry.sessions)} /><Metric label="Average startup" value={telemetry.averageStartupMs ? `${(telemetry.averageStartupMs / 1000).toFixed(1)}s` : "—"} /><Metric label="App/request failures" value={String(telemetry.failures)} warn={telemetry.failures > 0} /><Metric label="Offline transitions" value={String(telemetry.offlineEvents)} /></div> : <p className="text-sm text-slate-500">No mobile measurements are available yet.</p>}
      </section>
    </div>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return <div className={`rounded-lg border p-3 ${warn ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"}`}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-900">{value}</p></div>;
}
