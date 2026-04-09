import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type ShareAgg = { member_id: string; shares: number; value: number };
type Member = { id: string; full_name: string };

export function VslaShareOutPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<ShareAgg[]>([]);
  const [fundTotal, setFundTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [mRes, sRes, fRes] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_share_transactions").select("member_id,shares_bought,total_value"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_cycle_shareout").select("fund_total").order("created_at", { ascending: false }).limit(1), orgId, superAdmin),
    ]);
    setMembers((mRes.data ?? []) as Member[]);
    const agg = new Map<string, ShareAgg>();
    for (const r of (sRes.data ?? []) as Array<{ member_id: string; shares_bought: number; total_value: number }>) {
      const cur = agg.get(r.member_id) ?? { member_id: r.member_id, shares: 0, value: 0 };
      cur.shares += Number(r.shares_bought || 0);
      cur.value += Number(r.total_value || 0);
      agg.set(r.member_id, cur);
    }
    setShares(Array.from(agg.values()));
    setFundTotal(Number((fRes.data?.[0] as { fund_total?: number } | undefined)?.fund_total ?? 0));
    setError(mRes.error?.message ?? sRes.error?.message ?? fRes.error?.message ?? null);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalShares = useMemo(() => shares.reduce((s, x) => s + x.shares, 0), [shares]);
  const valuePerShare = totalShares > 0 ? fundTotal / totalShares : 0;
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.full_name])), [members]);

  const runShareOut = async () => {
    if (readOnly) return;
    if (fundTotal <= 0 || totalShares <= 0) {
      setError("Provide fund total and ensure there are shares before share-out.");
      return;
    }
    const payouts = shares.map((s) => ({
      member_id: s.member_id,
      shares: s.shares,
      payout_amount: s.shares * valuePerShare,
    }));
    const { error: e } = await supabase.from("vsla_cycle_shareout").insert({
      organization_id: orgId,
      fund_total: fundTotal,
      total_shares: totalShares,
      value_per_share: valuePerShare,
      payout_sheet: payouts,
    });
    if (e) setError(e.message);
    await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <h1 className="text-2xl font-bold text-slate-900">VSLA Share-Out (Cycle Closure)</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="bg-white border border-slate-200 rounded-xl p-4 grid md:grid-cols-4 gap-3">
        <label className="text-xs text-slate-600 md:col-span-2">Total Fund (Savings + Interest + Fines)
          <input type="number" value={fundTotal} onChange={(e) => setFundTotal(Number(e.target.value || 0))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </label>
        <div className="text-sm p-3 rounded-lg bg-slate-100">Total Shares: <strong>{totalShares}</strong></div>
        <div className="text-sm p-3 rounded-lg bg-slate-100">Value/Share: <strong>{valuePerShare.toFixed(2)}</strong></div>
        <div className="md:col-span-4">
          <button type="button" onClick={() => void runShareOut()} disabled={readOnly} className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm">Run Share-Out</button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr><th className="text-left p-3">Member</th><th className="text-left p-3">Shares</th><th className="text-left p-3">Projected Payout</th></tr>
          </thead>
          <tbody>
            {shares.map((s) => (
              <tr key={s.member_id} className="border-b border-slate-100">
                <td className="p-3">{memberName.get(s.member_id) ?? "Unknown"}</td>
                <td className="p-3">{s.shares}</td>
                <td className="p-3">{(s.shares * valuePerShare).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
