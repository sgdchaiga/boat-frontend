import { useMemo } from "react";
import { BookMarked, Scale } from "lucide-react";
import { PageNotes } from "@/components/common/PageNotes";
import { useAppContext } from "@/contexts/AppContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";

export type CashbookSacView = "journal" | "reconciliation";

export function SaccoCashbookPage({
  cashbookView = "journal",
  navigate,
}: {
  cashbookView?: CashbookSacView;
  navigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { cashbook, formatCurrency, saccoLoading } = useAppContext();

  const sorted = useMemo(
    () => cashbook.slice().sort((a, b) => a.date.localeCompare(b.date)),
    [cashbook]
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <BookMarked className="text-violet-500" size={28} />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Cashbook <span className="text-base font-normal text-slate-500">(system only)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {cashbookView === "journal"
              ? "Sequential journal-style lines sourced from workspace data."
              : "Spot checks and reconciliation notes — operational teller work stays in Teller."}
          </p>
        </div>
        <PageNotes ariaLabel="Cashbook help">
          <p>
            Intended for accountants and auditors. SACCO clerks and tellers post through <strong>Teller</strong>; this cashbook mirrors
            what has been synced into the workspace.
          </p>
        </PageNotes>
      </header>

      <div role="tablist" className="flex flex-wrap gap-2 text-sm border-b border-slate-100 pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={cashbookView === "journal"}
          onClick={() => navigate?.(SACCOPRO_PAGE.cashbook, { cashbookView: "journal" })}
          className={`px-3 py-1.5 rounded-lg font-medium ${
            cashbookView === "journal" ? "bg-violet-100 text-violet-900" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Journal view
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={cashbookView === "reconciliation"}
          onClick={() => navigate?.(SACCOPRO_PAGE.cashbook, { cashbookView: "reconciliation" })}
          className={`px-3 py-1.5 rounded-lg font-medium ${
            cashbookView === "reconciliation"
              ? "bg-violet-100 text-violet-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Reconciliation
        </button>
      </div>

      {cashbookView === "journal" && (
        <>
          {saccoLoading && <p className="text-sm text-slate-500 animate-pulse">Loading lines…</p>}
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <BookMarked className="w-4 h-4 text-violet-500" />
              <span className="text-sm font-medium text-slate-800">{sorted.length} line(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 border-b border-slate-100">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Member</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 text-right">Debit</th>
                    <th className="px-4 py-2 text-right">Credit</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        No cashbook lines synced yet.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2 whitespace-nowrap text-slate-600">{e.date}</td>
                        <td className="px-4 py-2">{e.memberName ?? "—"}</td>
                        <td className="px-4 py-2 max-w-[280px]">
                          <div className="line-clamp-2">{e.description}</div>
                          {e.reference && (
                            <span className="text-[11px] text-slate-400">Ref {e.reference}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(e.debit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(e.credit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(e.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {cashbookView === "reconciliation" && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-6 flex gap-4">
          <Scale className="text-amber-700 shrink-0" size={24} />
          <div className="text-sm text-amber-950 space-y-2">
            <p className="font-semibold">Reconciliation workspace</p>
            <p>
              Use this area for scheduled bank-vs-book checks and investigator notes. Drill into <strong>Journal view</strong> for detail
              lines; compare against your bank statements and vault counts.
            </p>
            <p className="text-xs text-amber-900/80">
              Automated bank reconciliation and GL stamping can be layered on when treasury feeds are connected.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
