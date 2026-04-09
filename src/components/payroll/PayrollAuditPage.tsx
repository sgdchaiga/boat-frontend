import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  details: Record<string, unknown>;
  payroll_run_id: string | null;
  actor_staff_id: string | null;
};

type Props = { readOnly?: boolean };

export function PayrollAuditPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from("payroll_audit_log")
      .select("id,created_at,action,details,payroll_run_id,actor_staff_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      const msg = error.message || "";
      const missingTable =
        /payroll_audit_log|schema cache|does not exist/i.test(msg) || (error as { code?: string }).code === "PGRST205";
      setErr(
        missingTable
          ? "Payroll audit table is missing on the server. Apply Supabase migrations (e.g. 20260427180000_payroll_controls.sql or 20260427210000_ensure_payroll_audit_log.sql), then reload."
          : msg
      );
    } else {
      setErr(null);
    }
    setRows((data as AuditRow[]) || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!orgId) return <p className="p-6 text-slate-600">No organization.</p>;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Payroll audit trail</h1>
        <PayrollGuide guideId="audit" />
      </div>
      {readOnly && <ReadOnlyNotice />}
      <p className="text-sm text-slate-600">
        Append-only log of payroll actions (prepare, calculate, approve, post). Configure who may prepare, approve, and
        post under <strong>Admin → Approval rights</strong>.
      </p>
      {err && <p className="text-red-600 text-sm whitespace-pre-wrap">{err}</p>}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3 font-semibold text-slate-700">Time</th>
                <th className="text-left p-3 font-semibold text-slate-700">Action</th>
                <th className="text-left p-3 font-semibold text-slate-700">Run</th>
                <th className="text-left p-3 font-semibold text-slate-700">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-slate-500">
                    No payroll audit rows yet. Actions appear after you use Process payroll.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="p-3 whitespace-nowrap text-slate-600">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 font-medium text-slate-800">{r.action}</td>
                    <td className="p-3 font-mono text-xs text-slate-600">{r.payroll_run_id ?? "—"}</td>
                    <td className="p-3 text-slate-600 max-w-md break-words">
                      {Object.keys(r.details || {}).length ? JSON.stringify(r.details) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
