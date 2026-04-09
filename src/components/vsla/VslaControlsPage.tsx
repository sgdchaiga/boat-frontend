import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type AuditLog = { id: string; actor_id: string | null; action: string; entity: string; entity_id: string | null; metadata: Record<string, unknown> | null; created_at: string };

export function VslaControlsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await filterByOrganizationId(
      supabase.from("vsla_audit_logs").select("*").order("created_at", { ascending: false }).limit(100),
      orgId,
      superAdmin
    );
    setLogs((data ?? []) as AuditLog[]);
    setError(e?.message ?? null);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <h1 className="text-2xl font-bold text-slate-900">VSLA Controls & Audit Trail</h1>
      <p className="text-sm text-slate-600">User role trust controls, transaction logs, and edit restrictions after meeting close.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3">When</th>
              <th className="text-left p-3">Actor</th>
              <th className="text-left p-3">Action</th>
              <th className="text-left p-3">Entity</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td className="p-4 text-slate-500" colSpan={4}>Loading audit logs...</td></tr> : logs.length === 0 ? <tr><td className="p-4 text-slate-500" colSpan={4}>No audit logs yet.</td></tr> : logs.map((l) => (
              <tr key={l.id} className="border-b border-slate-100">
                <td className="p-3">{new Date(l.created_at).toLocaleString()}</td>
                <td className="p-3">{l.actor_id ? l.actor_id.slice(0, 8) : "-"}</td>
                <td className="p-3">{l.action}</td>
                <td className="p-3">{l.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
