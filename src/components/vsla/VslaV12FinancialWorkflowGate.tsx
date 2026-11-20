import { cloneElement, isValidElement, useEffect, useState, type ReactNode } from "react";
import { History, LockKeyhole } from "lucide-react";
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
  const historicalView = isValidElement<{ readOnly?: boolean; historicalView?: boolean }>(children)
    ? cloneElement(children, { readOnly: true, historicalView: true })
    : children;
  return <><div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8"><div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5"><div className="flex gap-3"><History className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700"/><div><h1 className="font-semibold text-slate-900">Earlier {area} records</h1><p className="mt-1 text-sm text-slate-700">Historic v1.1 records remain available below as read-only history. New financial activity must be recorded in the v1.2 Meeting workspace, so earlier records are never mixed into the controlled ledger.</p></div></div><div className="mt-3 flex items-center gap-2 text-xs text-indigo-900"><LockKeyhole className="h-4 w-4"/><span>Legacy posting, editing, importing, and deletion remain locked.</span></div></div></div>{historicalView}</>;
}
