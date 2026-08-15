import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";

type ShareAgg = { member_id: string; shares: number; value: number };
type Member = { id: string; full_name: string; member_number: string | null };
type Cycle = { id: string; name: string; starts_on: string; status: "active" | "closed" };

export function VslaShareOutPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<ShareAgg[]>([]);
  const [fundTotal, setFundTotal] = useState(0);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [cycleName, setCycleName] = useState(`Cycle ${new Date().getFullYear()}`);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cycleRes = await filterByOrganizationId(
      supabase.from("vsla_cycles").select("id,name,starts_on,status").eq("status", "active").maybeSingle(),
      orgId,
      superAdmin,
    );
    const activeCycle = (cycleRes.data as Cycle | null) ?? null;
    setCycle(activeCycle);
    const [mRes, sRes] = await Promise.all([
      filterByOrganizationId(
        supabase.from("vsla_members").select("id,full_name,member_number").eq("status", "active"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_share_transactions")
          .select("member_id,shares_bought,total_value")
          .eq("cycle_id", activeCycle?.id ?? "00000000-0000-0000-0000-000000000000"),
        orgId,
        superAdmin,
      ),
    ]);
    setMembers((mRes.data ?? []) as Member[]);
    const aggregate = new Map<string, ShareAgg>();
    for (const row of (sRes.data ?? []) as Array<{ member_id: string; shares_bought: number; total_value: number }>) {
      const current = aggregate.get(row.member_id) ?? { member_id: row.member_id, shares: 0, value: 0 };
      current.shares += Number(row.shares_bought || 0);
      current.value += Number(row.total_value || 0);
      aggregate.set(row.member_id, current);
    }
    setShares(Array.from(aggregate.values()));
    setError(cycleRes.error?.message ?? mRes.error?.message ?? sRes.error?.message ?? null);
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalShares = useMemo(() => shares.reduce((sum, row) => sum + row.shares, 0), [shares]);
  const valuePerShare = totalShares > 0 ? fundTotal / totalShares : 0;
  const memberName = useMemo(
    () => new Map(members.map((member) => [member.id, formatVslaMemberLabel(member)])),
    [members],
  );

  const runShareOut = async () => {
    if (readOnly || !cycle) return;
    if (!Number.isFinite(fundTotal) || fundTotal <= 0 || totalShares <= 0) {
      setError("Provide a positive fund total and ensure the cycle has shares.");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    const { error: postingError } = await supabase.rpc("vsla_finalize_shareout", {
      p_cycle_id: cycle.id,
      p_fund_total: fundTotal,
    });
    if (postingError) {
      setError(postingError.message);
      setSaving(false);
      return;
    }
    setConfirming(false);
    setSuccess(`${cycle.name} finalized. Its transactions are now locked.`);
    setFundTotal(0);
    setSaving(false);
    await load();
  };

  const startCycle = async () => {
    if (readOnly || !cycleName.trim()) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const { error: postingError } = await supabase.rpc("vsla_start_cycle", {
      p_name: cycleName.trim(),
      p_starts_on: new Date().toISOString().slice(0, 10),
    });
    if (postingError) setError(postingError.message);
    else setSuccess(`${cycleName.trim()} started.`);
    setSaving(false);
    await load();
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VSLA Share-Out</h1>
        <p className="text-sm text-slate-600 mt-1">Preview member payouts, finalize the active cycle, and lock its records.</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-700">{success}</p>}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading active cycle...</div>
      ) : !cycle ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div>
            <p className="font-semibold text-amber-950">No active cycle</p>
            <p className="text-sm text-amber-800">Start a cycle before recording new meetings and transactions.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={cycleName} onChange={(event) => setCycleName(event.target.value)} className="border border-amber-300 rounded-lg px-3 py-2 text-sm bg-white" aria-label="New cycle name" />
            <button type="button" onClick={() => void startCycle()} disabled={readOnly || saving || !cycleName.trim()} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50">{saving ? "Starting..." : "Start New Cycle"}</button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          Active cycle: <strong>{cycle.name}</strong> · Started {cycle.starts_on}
        </div>
      )}

      {cycle && <>
        <div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600 md:col-span-2">
            Distributable Fund Total
            <input type="number" min="0" step="0.01" value={fundTotal} onChange={(event) => { setFundTotal(Number(event.target.value || 0)); setConfirming(false); }} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="text-sm p-3 rounded-lg bg-slate-100">Total Shares: <strong>{totalShares}</strong></div>
          <div className="text-sm p-3 rounded-lg bg-slate-100">Value/Share: <strong>{valuePerShare.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
          <div className="md:col-span-4">
            {!confirming ? (
              <button type="button" onClick={() => setConfirming(true)} disabled={readOnly || saving || fundTotal <= 0 || totalShares <= 0} className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm disabled:opacity-50">Preview Finalization</button>
            ) : (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
                <p className="font-semibold text-rose-900">Finalize {cycle.name}?</p>
                <p className="text-xs text-rose-800">This creates the payout sheet and permanently locks this cycle. Outstanding loans must be resolved first.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void runShareOut()} disabled={saving} className="px-4 py-2 rounded-lg bg-rose-700 text-white text-sm disabled:opacity-50">{saving ? "Finalizing..." : "Finalize Share-Out"}</button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={saving} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-slate-50 border-b border-slate-200"><tr><th className="text-left p-3">Member</th><th className="text-right p-3">Shares</th><th className="text-right p-3">Contributed</th><th className="text-right p-3">Projected Payout</th></tr></thead>
            <tbody>
              {shares.length === 0 ? <tr><td colSpan={4} className="p-6 text-center text-slate-500">No shares recorded in this cycle.</td></tr> : shares.map((row) => (
                <tr key={row.member_id} className="border-b border-slate-100">
                  <td className="p-3">{memberName.get(row.member_id) ?? "Unknown"}</td>
                  <td className="p-3 text-right">{row.shares}</td>
                  <td className="p-3 text-right">{row.value.toLocaleString()}</td>
                  <td className="p-3 text-right font-medium">{(row.shares * valuePerShare).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
