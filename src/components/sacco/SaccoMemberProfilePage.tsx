import React, { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { PageNotes } from "@/components/common/PageNotes";
import { ArrowDownLeft, ClipboardList, CreditCard, Landmark, PiggyBank, Wallet } from "lucide-react";

type Props = {
  memberIdFromNav?: string;
  /** Navigate within SACCO SPA (passed from App). */
  navigate?: (page: string, state?: Record<string, unknown>) => void;
};

function looksSavingsLine(e: { description?: string; category?: string }): boolean {
  const t = `${e.description ?? ""} ${e.category ?? ""}`.toLowerCase();
  return (
    /\bsavings|deposit|withdraw|member|ordinary|account\b/i.test(t) &&
    !/\bloan\s*repayment|loan\s*payment|repayment.*loan\b/i.test(t)
  );
}

function looksLoanLine(e: { description?: string; category?: string }): boolean {
  const t = `${e.description ?? ""} ${e.category ?? ""}`.toLowerCase();
  return /\bloan|repayment|disburs|credit\b/i.test(t);
}

const SaccoMemberProfilePage: React.FC<Props> = ({ memberIdFromNav, navigate }) => {
  const { members, loans, cashbook, formatCurrency } = useAppContext();
  const { user } = useAuth();
  const readOnly = user?.role === "viewer";

  const [internalId, setInternalId] = useState(memberIdFromNav ?? "");
  const memberId = memberIdFromNav ?? internalId;
  const member = members.find((m) => m.id === memberId);

  const memberLoans = useMemo(
    () => (memberId ? loans.filter((l) => l.memberId === memberId) : []),
    [loans, memberId]
  );

  const memberCashbook = useMemo(() => {
    if (!memberId) return [];
    return cashbook
      .filter((e) => e.memberId === memberId)
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [cashbook, memberId]);

  const savingsLines = useMemo(() => memberCashbook.filter(looksSavingsLine), [memberCashbook]);
  const loanLines = useMemo(() => memberCashbook.filter(looksLoanLine), [memberCashbook]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Landmark className="text-emerald-600" size={26} />
        <h1 className="text-2xl font-bold text-slate-900">Member profile</h1>
        <PageNotes ariaLabel="Member profile help">
          <p className="text-sm">
            One place to see a member&apos;s loans, savings balances, and recent cashbook lines. Use{" "}
            <strong>Teller</strong> for deposits, withdrawals, and loan repayments — money does not post from this screen.
          </p>
        </PageNotes>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 max-w-xl">
        <label className="block text-xs font-semibold text-slate-600 mb-1">Member</label>
        <select
          className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm"
          value={memberId}
          onChange={(e) => setInternalId(e.target.value)}
        >
          <option value="">Choose a member…</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.accountNumber})
            </option>
          ))}
        </select>
      </div>

      {!memberId && (
        <p className="text-sm text-slate-500">Select a member to load loans, savings, and transactions.</p>
      )}

      {member && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] uppercase font-semibold text-slate-400">Shares</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{formatCurrency(member.sharesBalance)}</p>
            </div>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-sm">
              <p className="text-[10px] uppercase font-semibold text-emerald-800">Ordinary savings</p>
              <p className="text-lg font-bold text-emerald-900 tabular-nums">{formatCurrency(member.savingsBalance)}</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 shadow-sm sm:col-span-2">
              <p className="text-[10px] uppercase font-semibold text-violet-800">Loan accounts</p>
              <p className="text-lg font-bold text-violet-900">{memberLoans.length} active facility(ies)</p>
              <button
                type="button"
                disabled={readOnly || !navigate}
                onClick={() => navigate?.(SACCOPRO_PAGE.loanInput)}
                className="mt-2 text-xs font-medium text-violet-700 hover:underline disabled:opacity-40"
              >
                New loan application →
              </button>
            </div>
          </div>

          <section className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/80">
              <CreditCard size={18} className="text-violet-600" />
              <h2 className="text-sm font-bold text-slate-900">Loans</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-100">
                    <th className="px-4 py-2">Product</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                    <th className="px-4 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {memberLoans.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                        No loans for this member.
                      </td>
                    </tr>
                  ) : (
                    memberLoans.map((l) => (
                      <tr key={l.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                        <td className="px-4 py-2 font-medium text-slate-900">{l.loanType}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(l.amount)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(l.balance)}</td>
                        <td className="px-4 py-2 capitalize text-xs">{l.status.replace(/_/g, " ")}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/80">
              <PiggyBank size={18} className="text-emerald-600" />
              <h2 className="text-sm font-bold text-slate-900">Savings (summary)</h2>
            </div>
            <div className="p-4 text-sm text-slate-700">
              <p>
                Rolled-up ordinary savings balance: <strong>{formatCurrency(member.savingsBalance)}</strong>. Detailed
                product accounts appear under <strong>Savings → Accounts</strong>.
              </p>
              <button
                type="button"
                disabled={!navigate}
                onClick={() => navigate?.(SACCOPRO_PAGE.savingsAccountsList)}
                className="mt-2 text-emerald-700 text-xs font-semibold hover:underline disabled:opacity-40"
              >
                View savings accounts →
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
              <div className="flex items-center gap-2">
                <ClipboardList size={18} className="text-slate-700" />
                <h2 className="text-sm font-bold text-slate-900">Transactions (from cashbook)</h2>
              </div>
              <button
                type="button"
                disabled={!navigate || readOnly}
                onClick={() =>
                  navigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "receive", tellerTask: "deposit" })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                <Wallet size={14} /> Post in Teller
              </button>
            </div>
            <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-50">
              Lines linked to this member in the SACCO workspace cashbook — view only. Receipts tagged with savings or loan wording are
              grouped below for convenience.
            </p>
            <div className="grid md:grid-cols-2 gap-4 p-4">
              <div>
                <h3 className="text-xs font-bold text-emerald-800 mb-2 flex items-center gap-1">
                  <ArrowDownLeft size={14} /> Likely savings
                </h3>
                <ul className="max-h-56 overflow-y-auto text-xs space-y-2 divide-y divide-slate-50">
                  {savingsLines.length === 0 && <li className="text-slate-400 py-2">None detected.</li>}
                  {savingsLines.slice(0, 40).map((e) => (
                    <li key={e.id} className="pt-2">
                      <span className="text-slate-400">{e.date}</span> — {e.description}
                      <div className="tabular-nums text-slate-800">
                        DR {formatCurrency(e.debit)} · CR {formatCurrency(e.credit)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-bold text-violet-800 mb-2 flex items-center gap-1">
                  <CreditCard size={14} /> Likely loan
                </h3>
                <ul className="max-h-56 overflow-y-auto text-xs space-y-2 divide-y divide-slate-50">
                  {loanLines.length === 0 && <li className="text-slate-400 py-2">None detected.</li>}
                  {loanLines.slice(0, 40).map((e) => (
                    <li key={e.id} className="pt-2">
                      <span className="text-slate-400">{e.date}</span> — {e.description}
                      <div className="tabular-nums text-slate-800">
                        DR {formatCurrency(e.debit)} · CR {formatCurrency(e.credit)}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default SaccoMemberProfilePage;
