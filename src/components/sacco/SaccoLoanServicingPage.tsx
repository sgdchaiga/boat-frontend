import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAppContext, calculateMonthlyPayment } from "@/contexts/AppContext";
import type { Loan, LoanStatus } from "@/types/saccoWorkspace";
import {
  fetchSaccoLoanModificationsForLoan,
  insertSaccoLoanModification,
  updateLoanRow,
} from "@/lib/saccoDb";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { toast } from "@/components/ui/use-toast";
import { Banknote, Calendar, History, Landmark, Undo2 } from "lucide-react";

const FIELD =
  "w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white text-slate-900";

/** Loans that can carry schedule / WO actions. */
function isServiceable(l: Loan): boolean {
  return l.status === "disbursed" || l.status === "defaulted" || l.status === "written_off";
}

const SaccoLoanServicingPage: React.FC = () => {
  const { loans, formatCurrency, refreshSaccoWorkspace, saccoLoading } = useAppContext();
  const { user } = useAuth();
  const persist = Boolean(user?.organization_id);

  const candidates = useMemo(() => loans.filter(isServiceable), [loans]);
  const [loanId, setLoanId] = useState("");
  const loan = candidates.find((l) => l.id === loanId) ?? loans.find((l) => l.id === loanId);

  const [newTermMonths, setNewTermMonths] = useState("");
  const [newRate, setNewRate] = useState("");
  const [woAmount, setWoAmount] = useState("");
  const [recoveryAmount, setRecoveryAmount] = useState("");
  const [note, setNote] = useState("");
  const [mods, setMods] = useState<
    { id: string; modification_type: string; effective_date: string; notes: string | null; amount_money: number | null; created_at: string }[]
  >([]);
  const [modsLoading, setModsLoading] = useState(false);

  const reloadMods = useCallback(async () => {
    if (!loanId || !persist) {
      setMods([]);
      return;
    }
    setModsLoading(true);
    try {
      const rows = await fetchSaccoLoanModificationsForLoan(loanId);
      setMods(rows);
    } catch (e) {
      console.error(e);
      toast({
        title: "Could not load history",
        description: e instanceof Error ? e.message : "Error",
      });
    } finally {
      setModsLoading(false);
    }
  }, [loanId, persist]);

  useEffect(() => {
    void reloadMods();
  }, [reloadMods]);

  useEffect(() => {
    if (!loan) return;
    setNewTermMonths(String(loan.term));
    setNewRate(String(loan.interestRate));
  }, [loan?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterRefresh = async () => {
    await refreshSaccoWorkspace();
    await reloadMods();
  };

  const onReschedule = async () => {
    if (!loan || !persist) return;
    const n = parseInt(newTermMonths, 10);
    if (!Number.isFinite(n) || n < 1 || n > 600) {
      toast({ title: "Invalid term", description: "Enter months between 1 and 600." });
      return;
    }
    if (loan.balance <= 0 && loan.status !== "written_off") {
      toast({ title: "Nothing to reschedule", description: "Use recovery or restructuring only if applicable." });
      return;
    }
    const principal = Math.max(loan.balance, 0);
    const newPay = calculateMonthlyPayment(principal, loan.interestRate, n, loan.interestBasis);
    const today = new Date().toISOString().slice(0, 10);
    try {
      await insertSaccoLoanModification({
        sacco_loan_id: loan.id,
        modification_type: "reschedule",
        effective_date: today,
        notes: note.trim() || null,
        previous_term_months: loan.term,
        new_term_months: n,
        previous_monthly_payment: loan.monthlyPayment,
        new_monthly_payment: newPay,
        previous_balance: loan.balance,
        new_balance: loan.balance,
      });
      await updateLoanRow(loan.id, {
        term_months: n,
        monthly_payment: newPay,
      });
      toast({ title: "Rescheduled", description: `${n} mo · ${formatCurrency(newPay)} / month.` });
      setNote("");
      await afterRefresh();
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Could not reschedule",
      });
    }
  };

  const onRestructure = async () => {
    if (!loan || !persist) return;
    const n = parseInt(newTermMonths, 10);
    const rate = parseFloat(newRate);
    if (!Number.isFinite(n) || n < 1) {
      toast({ title: "Invalid term", description: "Enter a valid term." });
      return;
    }
    if (!Number.isFinite(rate) || rate < 0 || rate > 80) {
      toast({ title: "Invalid rate", description: "Enter an annual rate between 0 and 80." });
      return;
    }
    const principal = Math.max(loan.balance, 0);
    if (principal <= 0 && loan.writtenOffRemaining && loan.writtenOffRemaining <= 0) {
      toast({ title: "No principal", description: "Nothing to restructure." });
      return;
    }
    const newPay = calculateMonthlyPayment(principal, rate, n, loan.interestBasis);
    const today = new Date().toISOString().slice(0, 10);
    try {
      await insertSaccoLoanModification({
        sacco_loan_id: loan.id,
        modification_type: "restructure",
        effective_date: today,
        notes: note.trim() || null,
        previous_term_months: loan.term,
        new_term_months: n,
        previous_interest_rate: loan.interestRate,
        new_interest_rate: rate,
        previous_monthly_payment: loan.monthlyPayment,
        new_monthly_payment: newPay,
        previous_balance: loan.balance,
        new_balance: loan.balance,
      });
      await updateLoanRow(loan.id, {
        term_months: n,
        interest_rate: rate,
        monthly_payment: newPay,
      });
      toast({ title: "Restructured", description: `${rate}% p.a. · ${n} mo.` });
      setNote("");
      await afterRefresh();
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Could not restructure",
      });
    }
  };

  const onWriteOff = async () => {
    if (!loan || !persist) return;
    const raw = parseFloat(woAmount);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast({ title: "Enter amount", description: "Principal (or recognised balance) written off." });
      return;
    }
    const cap = Math.max(loan.balance, 0);
    const amt = Math.min(raw, cap);
    if (amt <= 0) {
      toast({ title: "No balance", description: "Nothing left to capitalise into write-off." });
      return;
    }
    const newBal = Math.max(loan.balance - amt, 0);
    const wot = (loan.writtenOffTotal ?? 0) + amt;
    const wor = (loan.writtenOffRemaining ?? 0) + amt;
    const today = new Date().toISOString().slice(0, 10);
    let status: LoanStatus = loan.status;
    if (newBal <= 0) status = "written_off";

    try {
      await insertSaccoLoanModification({
        sacco_loan_id: loan.id,
        modification_type: "write_off",
        effective_date: today,
        notes: note.trim() || null,
        previous_balance: loan.balance,
        new_balance: newBal,
        amount_money: amt,
      });
      await updateLoanRow(loan.id, {
        balance: newBal,
        written_off_total: wot,
        written_off_remaining: wor,
        written_off_at: today,
        status,
      });
      toast({
        title: "Write-off posted",
        description: `${formatCurrency(amt)} · Remaining recoverable WO: ${formatCurrency(wor)}`,
      });
      setWoAmount("");
      setNote("");
      await afterRefresh();
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Could not write off",
      });
    }
  };

  const onRecovery = async () => {
    if (!loan || !persist) return;
    const raw = parseFloat(recoveryAmount);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast({ title: "Enter recovery", description: "Amount credited against written-off remainder." });
      return;
    }
    const maxR = loan.writtenOffRemaining ?? 0;
    const amt = Math.min(raw, maxR);
    if (amt <= 0 || maxR <= 0) {
      toast({
        title: "No WO remainder",
        description: "Post write-offs first before recovery against bad debt remainder.",
      });
      return;
    }
    const newWor = Math.max(maxR - amt, 0);
    const paid = loan.paidAmount + amt;
    const today = new Date().toISOString().slice(0, 10);
    let status: LoanStatus = loan.status;
    if (newWor <= 0 && loan.balance <= 0) status = "closed";

    try {
      await insertSaccoLoanModification({
        sacco_loan_id: loan.id,
        modification_type: "recovery_writeoff",
        effective_date: today,
        notes: note.trim() || null,
        amount_money: amt,
        previous_balance: loan.balance,
        new_balance: loan.balance,
      });
      await updateLoanRow(loan.id, {
        written_off_remaining: newWor,
        paid_amount: paid,
        last_payment_date: today,
        status,
      });
      toast({
        title: "Recovery posted",
        description: `${formatCurrency(amt)} · WO remainder now ${formatCurrency(newWor)}`,
      });
      setRecoveryAmount("");
      setNote("");
      await afterRefresh();
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Could not post recovery",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Landmark className="text-emerald-600" size={26} />
        <h1 className="text-2xl font-bold text-slate-900">Loan servicing</h1>
        <PageNotes ariaLabel="Loan servicing help">
          <p className="text-sm">
            Reschedule (same rate, new term from current principal), full restructure, formal write-offs, and WO recoveries. Each step
            is logged in <code className="text-xs">sacco_loan_modifications</code> when Supabase migrations are applied.
          </p>
        </PageNotes>
      </div>

      {!persist && (
        <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-900">
          Sign in with a SACCO staff account tied to Supabase to persist servicing actions.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
        <label className="block text-xs font-semibold text-slate-700">Loan</label>
        <select
          className={FIELD}
          value={loanId}
          onChange={(e) => setLoanId(e.target.value)}
          disabled={saccoLoading}
        >
          <option value="">Select disbursed / defaulted / written-off loan</option>
          {candidates.map((l) => (
            <option key={l.id} value={l.id}>
              {l.memberName} — {l.loanType} — {formatCurrency(l.balance)} bal · {l.status}
            </option>
          ))}
        </select>

        {loan && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-50 rounded-lg p-2">
              <p className="text-slate-400">Balance</p>
              <p className="font-semibold">{formatCurrency(loan.balance)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2">
              <p className="text-slate-400">WO remainder</p>
              <p className="font-semibold">{formatCurrency(loan.writtenOffRemaining ?? 0)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2">
              <p className="text-slate-400">Term / rate</p>
              <p className="font-semibold">
                {loan.term} mo · {loan.interestRate}%
              </p>
            </div>
            <div className="bg-slate-50 rounded-lg p-2">
              <p className="text-slate-400">Monthly</p>
              <p className="font-semibold">{formatCurrency(loan.monthlyPayment)}</p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Shared note (optional)</label>
          <input
            className={FIELD}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Board minute ref, teller batch, etc."
          />
        </div>
      </div>

      {loan && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Calendar size={16} /> Reschedule
            </h3>
            <p className="text-xs text-slate-600">Keep rate; re-amortise from current balance.</p>
            <input
              type="number"
              className={FIELD}
              min={1}
              value={newTermMonths}
              onChange={(e) => setNewTermMonths(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void onReschedule()}
              disabled={!persist}
              className="w-full py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              Apply reschedule
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Undo2 size={16} /> Restructure
            </h3>
            <p className="text-xs text-slate-600">New declining/flat rate and term from current balance.</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium text-slate-500">% p.a.</label>
                <input type="number" className={FIELD} step="0.25" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500">Months</label>
                <input
                  type="number"
                  className={FIELD}
                  min={1}
                  value={newTermMonths}
                  onChange={(e) => setNewTermMonths(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onRestructure()}
              disabled={!persist}
              className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              Apply restructure
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-5 space-y-3">
            <h3 className="text-sm font-bold text-red-900 flex items-center gap-2">
              <Landmark size={16} /> Write-off
            </h3>
            <p className="text-xs text-slate-600">Caps at principal balance left on the facility.</p>
            <input type="number" className={FIELD} value={woAmount} onChange={(e) => setWoAmount(e.target.value)} />
            <button
              type="button"
              onClick={() => void onWriteOff()}
              disabled={!persist}
              className="w-full py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
            >
              Post write-off
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-100 p-5 space-y-3">
            <h3 className="text-sm font-bold text-emerald-900 flex items-center gap-2">
              <Banknote size={16} /> Recovery (WO remainder)
            </h3>
            <p className="text-xs text-slate-600">Reduces `written_off_remaining` and increases repayments totals.</p>
            <input
              type="number"
              className={FIELD}
              value={recoveryAmount}
              onChange={(e) => setRecoveryAmount(e.target.value)}
            />
            <button
              type="button"
              onClick={() => void onRecovery()}
              disabled={!persist}
              className="w-full py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
            >
              Post recovery
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-100 p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <History size={16} /> Audit trail ({loan?.memberName ?? "—"})
        </h3>
        {modsLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : mods.length === 0 ? (
          <p className="text-sm text-slate-500">No modifications logged for this loan yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {mods.map((m) => (
              <li key={m.id} className="py-2 flex flex-wrap justify-between gap-2">
                <span className="font-medium capitalize">{m.modification_type.replace(/_/g, " ")}</span>
                <span className="text-slate-500 text-xs">
                  {m.effective_date}{" "}
                  {m.amount_money != null && m.amount_money > 0 ? `· ${formatCurrency(Number(m.amount_money))}` : ""}
                </span>
                {m.notes && <span className="w-full text-xs text-slate-600">{m.notes}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SaccoLoanServicingPage;
