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
  useEffect(() => { let live = true; void (async () => {
    if (!user?.organization_id) { if (live) setLoaded(true); return; }
    const { data } = await (supabase as any).from("vsla_workflow_settings").select("workflow_version").eq("organization_id", user.organization_id).maybeSingle();
    if (live) { setV12(data?.workflow_version === "v1_2"); setLoaded(true); }
  })(); return () => { live = false; }; }, [user?.organization_id]);
  if (!loaded) return <div className="p-6 text-sm text-slate-600">Loading meeting workspace…</div>;
  return v12 ? <VslaV12MeetingWorkspace readOnly={props.readOnly} /> : <LegacyVslaMeetingsPage {...props} />;
}
