import { useEffect, useState, type ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export function VslaV12FinancialWorkflowGate({ area, children }: { area: string; children: ReactNode }) {
  const { user } = useAuth();
  const [v12, setV12] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { let live = true; void (async () => {
    if (!user?.organization_id) { if (live) setLoaded(true); return; }
    const { data } = await (supabase as any).from("vsla_workflow_settings").select("workflow_version").eq("organization_id", user.organization_id).maybeSingle();
    if (live) { setV12(data?.workflow_version === "v1_2"); setLoaded(true); }
  })(); return () => { live = false; }; }, [user?.organization_id]);
  if (!loaded) return <div className="p-6 text-sm text-slate-600">Loading workflow…</div>;
  if (!v12) return <>{children}</>;
  return <div className="mx-auto max-w-2xl p-6 lg:p-8"><div className="rounded-xl border border-indigo-200 bg-indigo-50 p-6 text-center"><LockKeyhole className="mx-auto h-8 w-8 text-indigo-700"/><h1 className="mt-3 text-xl font-bold text-slate-900">{area} now uses the v1.2 controlled ledger</h1><p className="mt-2 text-sm text-slate-700">Legacy financial posting is locked for this organization. Use the v1.2 Meeting workspace while the dedicated {area.toLowerCase()} workflow is rolled out.</p></div></div>;
}
