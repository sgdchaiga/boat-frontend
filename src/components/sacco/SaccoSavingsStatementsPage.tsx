import React, { useMemo, useState } from "react";
import { useAppContext } from "@/contexts/AppContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { PageNotes } from "@/components/common/PageNotes";
import { BookOpen } from "lucide-react";

type Props = {
  navigate?: (page: string, state?: Record<string, unknown>) => void;
  /** Sidebar label “Savings reports” uses a board-facing title here. */
  heading?: string;
  intro?: string;
};

/** Cashbook-derived view of member-facing savings-oriented lines (no new postings). */
const SaccoSavingsStatementsPage: React.FC<Props> = ({ navigate, heading = "Savings statements", intro }) => {
  const { members, cashbook, formatCurrency } = useAppContext();
  const [memberId, setMemberId] = useState("");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    let list = cashbook.slice().sort((a, b) => b.date.localeCompare(a.date));
    const q = search.trim().toLowerCase();
    if (q)
      list = list.filter((e) => e.description?.toLowerCase().includes(q) || e.reference?.toLowerCase().includes(q));
    if (memberId) list = list.filter((e) => e.memberId === memberId);
    return list;
  }, [cashbook, memberId, search]);

  const lastBalance =
    rows.length > 0
      ? rows.reduce((picked, r) => (r.date >= picked.date ? r : picked), rows[rows.length - 1]).balance
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="text-emerald-600" size={26} />
        <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
        <PageNotes ariaLabel="Statements help">
          <p className="text-sm">
            {intro ??
              "Read-only list from the SACCO workspace cashbook. Deposits and withdrawals are booked through Teller → Receive money / Give money."}
          </p>
        </PageNotes>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => navigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "receive", tellerTask: "deposit" })}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Go to Teller (deposit)
        </button>
        <button
          type="button"
          onClick={() => navigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "give", tellerTask: "withdraw" })}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
        >
          Go to Teller (withdraw)
        </button>
      </div>

      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
        <select
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm min-w-[200px]"
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        >
          <option value="">All members</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.accountNumber})
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Filter description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm flex-1 min-w-[160px]"
        />
        <span className="text-sm text-slate-600 self-center">
          Latest rolling balance hint: <strong className="tabular-nums">{formatCurrency(lastBalance)}</strong>
        </span>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 uppercase border-b border-slate-100">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3 text-right">Debit</th>
                <th className="px-4 py-3 text-right">Credit</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                    No cashbook lines loaded for this filter.
                  </td>
                </tr>
              ) : (
                rows.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">{e.date}</td>
                    <td className="px-4 py-2">{e.memberName ?? "—"}</td>
                    <td className="px-4 py-2 max-w-[320px]">
                      <span className="line-clamp-2">{e.description}</span>
                      {e.reference && (
                        <span className="block text-[11px] text-slate-400">Ref {e.reference}</span>
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
    </div>
  );
};

export default SaccoSavingsStatementsPage;
