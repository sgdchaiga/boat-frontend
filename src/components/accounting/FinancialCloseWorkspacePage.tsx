import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FileBarChart2, LockKeyhole, RefreshCw, RotateCcw, ShieldCheck, UnlockKeyhole } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { businessTodayISO } from "@/lib/timezone";
import { filterGlAccountsForBusinessType } from "@/lib/glAccountBusinessScope";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";

type Props = { readOnly?: boolean; initialMonth?: string; onNavigate: (page: string, state?: Record<string, unknown>) => void };
type CloseRecord = {
  id: string;
  period_start: string;
  period_end: string;
  status: "closed" | "reopened";
  reconciliation_note: string | null;
  closed_at: string;
  reopen_reason: string | null;
};
type ReconciliationSession = {
  control_gl_account_id: string;
  status: string;
  period_start: string;
  period_end: string;
  updated_at: string;
};
type CashAccount = { id: string; account_code: string; account_name: string; account_type: string; category: string | null; is_active: boolean };

const db = supabase as any;
const money = new Intl.NumberFormat("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function previousCompletedMonth(today = businessTodayISO()): string {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return date.toISOString().slice(0, 7);
}

function monthRange(month: string): { start: string; end: string; nextLock: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 0));
  const next = new Date(Date.UTC(year, monthNumber, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), nextLock: next.toISOString().slice(0, 10) };
}

function isControlAccount(account: CashAccount): boolean {
  const text = `${account.account_name} ${account.category || ""}`.toLowerCase();
  return account.account_type === "asset" && (account.category === "cash" || /bank|cash|mobile money|wallet|till|float|vault/.test(text));
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function FinancialCloseWorkspacePage({ readOnly = false, initialMonth, onNavigate }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [month, setMonth] = useState(() => initialMonth || previousCompletedMonth());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [postedJournalCount, setPostedJournalCount] = useState(0);
  const [draftJournalCount, setDraftJournalCount] = useState(0);
  const [debits, setDebits] = useState(0);
  const [credits, setCredits] = useState(0);
  const [controlAccounts, setControlAccounts] = useState<CashAccount[]>([]);
  const [sessions, setSessions] = useState<ReconciliationSession[]>([]);
  const [records, setRecords] = useState<CloseRecord[]>([]);
  const [lockBefore, setLockBefore] = useState<string | null>(null);
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [confirmedClose, setConfirmedClose] = useState(false);
  const [confirmedOutstandingControls, setConfirmedOutstandingControls] = useState(false);
  const [reopenRecord, setReopenRecord] = useState<CloseRecord | null>(null);
  const [reopenReason, setReopenReason] = useState("");

  const range = useMemo(() => monthRange(month), [month]);
  const role = String(user?.role || "").toLowerCase().replace(/[ -]+/g, "_");
  const canManage = Boolean(user?.isSuperAdmin || ["admin", "super_admin", "manager", "accountant"].includes(role));

  const load = useCallback(async () => {
    if (!orgId) {
      setError("Your account is not linked to an organization.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const [accountRes, lineRes, draftRes, settingsRes, sessionRes, closeRes] = await Promise.all([
        db.from("gl_accounts").select("id,account_code,account_name,account_type,category,is_active").eq("organization_id", orgId).eq("is_active", true).order("account_code"),
        db.from("journal_entry_lines")
          .select("debit,credit,journal_entries!inner(id,entry_date,organization_id,is_posted,is_deleted)")
          .eq("journal_entries.organization_id", orgId)
          .gte("journal_entries.entry_date", range.start)
          .lte("journal_entries.entry_date", range.end)
          .eq("journal_entries.is_posted", true)
          .eq("journal_entries.is_deleted", false),
        db.from("journal_entries").select("id", { count: "exact", head: true })
          .eq("organization_id", orgId).gte("entry_date", range.start).lte("entry_date", range.end).eq("is_deleted", false).eq("is_posted", false),
        db.from("journal_gl_settings").select("period_lock_before_date").eq("organization_id", orgId).maybeSingle(),
        db.from("reconciliation_sessions").select("control_gl_account_id,status,period_start,period_end,updated_at").eq("organization_id", orgId).lte("period_start", range.start).gte("period_end", range.end).order("updated_at", { ascending: false }),
        db.from("accounting_period_closes").select("id,period_start,period_end,status,reconciliation_note,closed_at,reopen_reason").eq("organization_id", orgId).order("period_end", { ascending: false }).limit(12),
      ]);
      if (accountRes.error) throw accountRes.error;
      if (lineRes.error) throw lineRes.error;
      if (draftRes.error) throw draftRes.error;
      if (settingsRes.error) throw settingsRes.error;
      if (sessionRes.error) throw sessionRes.error;
      if (closeRes.error) throw closeRes.error;

      const accounts = filterGlAccountsForBusinessType(normalizeGlAccountRows((accountRes.data || []) as unknown[]), user?.business_type)
        .filter(isControlAccount) as CashAccount[];
      const lines = (lineRes.data || []) as Array<{ debit: number | string; credit: number | string }>;
      setControlAccounts(accounts);
      setSessions((sessionRes.data || []) as ReconciliationSession[]);
      setDebits(lines.reduce((total, line) => total + Number(line.debit || 0), 0));
      setCredits(lines.reduce((total, line) => total + Number(line.credit || 0), 0));
      setPostedJournalCount(new Set((lineRes.data || []).map((line: any) => line.journal_entries?.id).filter(Boolean)).size || lines.length);
      setDraftJournalCount(draftRes.count || 0);
      setLockBefore(settingsRes.data?.period_lock_before_date || null);
      setRecords((closeRes.data || []) as CloseRecord[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setControlAccounts([]);
      setSessions([]);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [orgId, range.end, range.start, user?.business_type]);

  useEffect(() => { void load(); }, [load]);

  const approvedControlIds = useMemo(() => {
    const approved = new Set<string>();
    sessions.filter((session) => session.status === "approved").forEach((session) => approved.add(session.control_gl_account_id));
    return approved;
  }, [sessions]);
  const outstandingControls = controlAccounts.filter((account) => !approvedControlIds.has(account.id));
  const currentRecord = records.find((record) => record.period_end === range.end && record.status === "closed") || null;
  const trialBalanceDifference = debits - credits;
  const trialBalanceReady = Math.abs(trialBalanceDifference) < 0.005;
  const blocked = !trialBalanceReady || draftJournalCount > 0 || !confirmedClose || (outstandingControls.length > 0 && !confirmedOutstandingControls);
  const latestClosedRecord = records.find((record) => record.status === "closed") || null;

  const closePeriod = async () => {
    if (!orgId || blocked || readOnly || !canManage) return;
    if (!window.confirm(`Close ${month} and lock all journal entries dated before ${range.nextLock}? Reopening will require a recorded reason.`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const { error: rpcError } = await db.rpc("close_accounting_period", {
        p_organization_id: orgId,
        p_period_start: range.start,
        p_period_end: range.end,
        p_reconciliation_note: reconciliationNote || null,
        p_checklist_snapshot: {
          reconciliation_reviewed: outstandingControls.length === 0 || confirmedOutstandingControls,
          approved_control_accounts: approvedControlIds.size,
          outstanding_control_accounts: outstandingControls.length,
        },
      });
      if (rpcError) throw rpcError;
      setNotice(`${month} was closed. Entries before ${range.nextLock} are now locked.`);
      setConfirmedClose(false);
      setConfirmedOutstandingControls(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const reopenPeriod = async () => {
    if (!orgId || !reopenRecord || !reopenReason.trim() || readOnly || !canManage) return;
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await db.rpc("reopen_accounting_period", {
        p_organization_id: orgId,
        p_period_end: reopenRecord.period_end,
        p_reason: reopenReason.trim(),
      });
      if (rpcError) throw rpcError;
      setNotice(`${reopenRecord.period_end.slice(0, 7)} was reopened. The reason is recorded in the audit trail.`);
      setReopenRecord(null);
      setReopenReason("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const checklist = [
    { label: "Posted trial balance", detail: trialBalanceReady ? `Balanced · Dr ${money.format(debits)} / Cr ${money.format(credits)}` : `Out of balance by ${money.format(Math.abs(trialBalanceDifference))}`, ready: trialBalanceReady, action: () => onNavigate("accounting_trial") },
    { label: "Draft journals", detail: draftJournalCount ? `${draftJournalCount} draft journal${draftJournalCount === 1 ? "" : "s"} must be resolved` : "No draft journals in this period", ready: draftJournalCount === 0, action: () => onNavigate("accounting_journal") },
    { label: "Cash, bank & wallet reconciliations", detail: controlAccounts.length === 0 ? "No control accounts configured" : outstandingControls.length ? `${outstandingControls.length} of ${controlAccounts.length} control accounts await approval` : `All ${controlAccounts.length} configured control accounts approved`, ready: controlAccounts.length > 0 && outstandingControls.length === 0, action: () => onNavigate("cash_control_center", { cashControlMonth: month }) },
    { label: "Financial statements", detail: "Review the income statement, financial position and cash flow before locking.", ready: true, action: () => onNavigate("accounting_income", { from: range.start, to: range.end }) },
  ];

  return <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Accounting control</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Financial close workspace</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Finish the month with a balanced ledger, reviewed control accounts and an auditable journal lock.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void load()} disabled={loading || saving} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        <label className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Close month <input type="month" value={month} max={previousCompletedMonth()} onChange={(event) => { setMonth(event.target.value); setConfirmedClose(false); setConfirmedOutstandingControls(false); }} className="ml-2 bg-transparent outline-none" /></label>
      </div>
    </header>

    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
    {!canManage && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">You can review close readiness, but an accounting manager, accountant, or administrator must close or reopen a month.</div>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Period" value={month} detail={currentRecord ? "Closed" : lockBefore && lockBefore > range.end ? "Already locked" : "Open"} tone={currentRecord || (lockBefore && lockBefore > range.end) ? "emerald" : "indigo"} />
      <Metric label="Posted journals" value={String(postedJournalCount)} detail={`${draftJournalCount} draft`} tone={draftJournalCount ? "amber" : "emerald"} />
      <Metric label="Trial balance" value={trialBalanceReady ? "Balanced" : "Review needed"} detail={`Difference ${money.format(Math.abs(trialBalanceDifference))}`} tone={trialBalanceReady ? "emerald" : "rose"} />
      <Metric label="Control accounts" value={`${approvedControlIds.size}/${controlAccounts.length}`} detail={outstandingControls.length ? `${outstandingControls.length} awaiting reconciliation` : "All approved"} tone={outstandingControls.length ? "amber" : "emerald"} />
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-900">Close checklist</h2><p className="mt-1 text-sm text-slate-500">Each review point is linked to the underlying records, so close evidence stays traceable.</p></div>
      <div className="divide-y divide-slate-100">
        {checklist.map((item) => <button type="button" key={item.label} onClick={item.action} className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left hover:bg-slate-50">
          {item.ready ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
          <span className="min-w-0 flex-1"><strong className="block text-sm text-slate-900">{item.label}</strong><span className="mt-0.5 block text-xs text-slate-500">{item.detail}</span></span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700">Review <ArrowRight className="h-4 w-4" /></span>
        </button>)}
      </div>
    </section>

    {outstandingControls.length > 0 && <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Control-account review is outstanding</h2><p className="mt-1 text-sm text-amber-900">Reconcile these accounts or explicitly document why they can be closed as outstanding items.</p><p className="mt-2 text-sm font-medium text-amber-950">{outstandingControls.map((account) => `${account.account_code} — ${account.account_name}`).join(" · ")}</p></div></div>
      <label className="mt-4 flex items-start gap-2 text-sm text-amber-950"><input type="checkbox" checked={confirmedOutstandingControls} onChange={(event) => setConfirmedOutstandingControls(event.target.checked)} className="mt-1" />I reviewed the outstanding control accounts and documented any reconciling items in the close note.</label>
    </section>}

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-bold text-slate-900">Lock {month}</h2><p className="mt-1 text-sm text-slate-500">A close prevents edits, reversals and deletions dated before {range.nextLock}. Corrections must use a later adjustment or a controlled reopen.</p></div><LockKeyhole className="h-7 w-7 text-indigo-700" /></div>
      {currentRecord ? <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><strong>{month} is closed.</strong> Closed {dateTime(currentRecord.closed_at)}. {currentRecord.reconciliation_note ? `Note: ${currentRecord.reconciliation_note}` : ""}</div> : <>
        <label className="mt-4 block text-sm font-medium text-slate-700">Close note <textarea value={reconciliationNote} onChange={(event) => setReconciliationNote(event.target.value)} maxLength={1000} placeholder="Record important reconciling items, approvals or report references." className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={confirmedClose} onChange={(event) => setConfirmedClose(event.target.checked)} className="mt-1" />I confirm that reports have been reviewed and this completed month is ready to be locked.</label>
        <button type="button" onClick={() => void closePeriod()} disabled={readOnly || !canManage || loading || saving || blocked} className="app-btn-primary mt-4"><LockKeyhole className="h-4 w-4" />{saving ? "Closing month…" : `Close and lock ${month}`}</button>
        {blocked && <p className="mt-2 text-xs text-slate-500">Resolve the failed checks and confirmations above before closing.</p>}
      </>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><FileBarChart2 className="h-5 w-5 text-slate-600" /><div><h2 className="font-bold text-slate-900">Close history</h2><p className="text-xs text-slate-500">Close and reopen events are retained with their supporting note.</p></div></div>
      {records.length === 0 ? <p className="p-5 text-sm text-slate-500">No accounting periods have been closed yet.</p> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Period</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Closed</th><th className="px-5 py-3">Note / reopen reason</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{records.map((record) => <tr key={record.id}><td className="px-5 py-3 font-medium text-slate-900">{record.period_end.slice(0, 7)}</td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${record.status === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{record.status === "closed" ? "Closed" : "Reopened"}</span></td><td className="px-5 py-3 text-slate-600">{dateTime(record.closed_at)}</td><td className="max-w-lg px-5 py-3 text-slate-600">{record.status === "reopened" ? record.reopen_reason || "—" : record.reconciliation_note || "—"}</td><td className="px-5 py-3 text-right">{record.status === "closed" && latestClosedRecord?.id === record.id && canManage && !readOnly && <button type="button" onClick={() => { setReopenRecord(record); setReopenReason(""); }} className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:text-amber-800"><UnlockKeyhole className="h-4 w-4" />Reopen</button>}</td></tr>)}</tbody></table></div>}
    </section>

    {reopenRecord && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5"><div className="flex gap-3"><RotateCcw className="mt-0.5 h-5 w-5 text-amber-800" /><div className="flex-1"><h2 className="font-bold text-amber-950">Reopen {reopenRecord.period_end.slice(0, 7)}</h2><p className="mt-1 text-sm text-amber-900">This unlocks the latest closed month and records why the exception was needed.</p><label className="mt-3 block text-sm font-medium text-amber-950">Reason <textarea value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} maxLength={1000} className="mt-1 min-h-20 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-800" /></label><div className="mt-3 flex gap-2"><button type="button" onClick={() => void reopenPeriod()} disabled={saving || !reopenReason.trim()} className="app-btn-primary">{saving ? "Reopening…" : "Record reopen"}</button><button type="button" onClick={() => setReopenRecord(null)} disabled={saving} className="app-btn-secondary">Cancel</button></div></div></div></section>}
  </main>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "emerald" | "indigo" | "amber" | "rose" }) {
  const tones = { emerald: "border-emerald-200 bg-emerald-50", indigo: "border-indigo-200 bg-indigo-50", amber: "border-amber-200 bg-amber-50", rose: "border-rose-200 bg-rose-50" };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p><p className="mt-2 text-xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-600">{detail}</p></div>;
}
