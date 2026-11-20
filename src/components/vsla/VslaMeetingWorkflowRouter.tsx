import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { VslaMeetingsPage as LegacyVslaMeetingsPage } from "./VslaMeetingsPage";
import { VslaV12MeetingWorkspace } from "./VslaV12MeetingWorkspace";

type Props = { readOnly?: boolean; initialTab?: "attendance" | "savings" | "loans" | "repayments" | "cash"; onNavigate?: (page: string, state?: Record<string, unknown>) => void };

export function VslaMeetingWorkflowRouter(props: Props) {
  const { user } = useAuth();
  const [v12, setV12] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"v1_2" | "earlier">("v1_2");
  useEffect(() => { let live = true; void (async () => {
    if (!user?.organization_id) { if (live) setLoaded(true); return; }
    const { data } = await (supabase as any).from("vsla_workflow_settings").select("workflow_version").eq("organization_id", user.organization_id).maybeSingle();
    if (live) { setV12(data?.workflow_version === "v1_2"); setLoaded(true); }
  })(); return () => { live = false; }; }, [user?.organization_id]);
  if (!loaded) return <div className="p-6 text-sm text-slate-600">Loading meeting workspace…</div>;
  if (!v12) return <LegacyVslaMeetingsPage {...props} />;
  if (view === "earlier") return <><div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8"><div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-semibold text-slate-900">Earlier meeting history</h1><p className="mt-1 text-sm text-slate-700">Earlier meeting attendance, share purchases, cash records, and minutes are available below as read-only history. They are not combined with the v1.2 controlled ledger.</p></div><button type="button" onClick={() => setView("v1_2")} className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-900">Return to v1.2 meeting workspace</button></div></div></div><LegacyVslaMeetingsPage {...props} readOnly /></>;
  return <><VslaV12MeetingWorkspace readOnly={props.readOnly} /><div className="mx-auto max-w-7xl px-4 pb-6 sm:px-6 lg:px-8"><button type="button" onClick={() => setView("earlier")} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800">View earlier meeting history</button></div></>;
}
