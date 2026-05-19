import { AlertTriangle, RefreshCw } from "lucide-react";
import type { TillPositionRow } from "@/lib/saccoTellerDb";

function formatUgx(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

type Props = {
  positions: TillPositionRow[];
  insuredLimitUgx: number | null;
  loading?: boolean;
  onRefresh?: () => void;
  onCloseTill?: (sessionId: string) => void;
  canSupervise?: boolean;
  saving?: boolean;
};

/** Manager view: cash on hand per open till vs insured limit. */
export function SaccoTillOversightPanel({
  positions,
  insuredLimitUgx,
  loading,
  onRefresh,
  onCloseTill,
  canSupervise,
  saving,
}: Props) {
  const overCount = positions.filter((p) => p.overInsuredLimit).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Till oversight</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Live cash on hand per open till
            {insuredLimitUgx != null && insuredLimitUgx > 0
              ? ` · insured limit ${formatUgx(insuredLimitUgx)}`
              : " · set insured limit in Controls"}
          </p>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        ) : null}
      </div>

      {overCount > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" aria-hidden />
          <span>
            <strong>{overCount}</strong> till{overCount === 1 ? "" : "s"} exceed the insured cash limit. Arrange a vault
            transfer or reduce float.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <th className="px-4 py-2 font-medium">Teller</th>
              <th className="px-4 py-2 font-medium">Opened</th>
              <th className="px-4 py-2 font-medium text-right">Opening float</th>
              <th className="px-4 py-2 font-medium text-right">Est. on hand</th>
              <th className="px-4 py-2 font-medium text-right">Receipts</th>
              <th className="px-4 py-2 font-medium text-right">Payments</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canSupervise ? <th className="px-4 py-2 font-medium" /> : null}
            </tr>
          </thead>
          <tbody>
            {loading && positions.length === 0 ? (
              <tr>
                <td colSpan={canSupervise ? 8 : 7} className="px-4 py-8 text-center text-slate-500">
                  Loading till balances…
                </td>
              </tr>
            ) : positions.length === 0 ? (
              <tr>
                <td colSpan={canSupervise ? 8 : 7} className="px-4 py-8 text-center text-slate-500">
                  No open tills in this organization.
                </td>
              </tr>
            ) : (
              positions.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-slate-50 ${p.overInsuredLimit ? "bg-amber-50/60" : ""}`}
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">{p.staff_full_name?.trim() || "Staff"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                    {new Date(p.opened_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatUgx(p.opening_float)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-900">
                    {formatUgx(p.tillEstimated)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {formatUgx(p.sessionReceiptsTotal)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {formatUgx(p.sessionPaymentsTotal)}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.overInsuredLimit ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        <AlertTriangle className="w-3 h-3" />
                        Over limit
                      </span>
                    ) : insuredLimitUgx != null && insuredLimitUgx > 0 ? (
                      <span className="text-xs font-medium text-emerald-700">Within limit</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  {canSupervise && onCloseTill ? (
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onCloseTill(p.id)}
                        className="rounded border border-slate-300 px-2 py-0.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                      >
                        Close till
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
