import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Landmark, RefreshCw, ShieldAlert, WalletCards } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { businessTodayISO } from "@/lib/timezone";
import { filterGlAccountsForBusinessType } from "@/lib/glAccountBusinessScope";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";

type Props = { onNavigate: (page: string, state?: Record<string, unknown>) => void; initialMonth?: string };
type ControlAccount = { id: string; account_code: string; account_name: string; account_type: string; category: string | null; is_active: boolean };
type ReconciliationSession = { control_gl_account_id: string; status: string; period_start: string; period_end: string; updated_at: string };
type JournalLine = { gl_account_id: string; debit: number | string; credit: number | string; journal_entries: { entry_date: string } | null };

const db = supabase as any;
const money = new Intl.NumberFormat("en-UG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function currentMonth(today = businessTodayISO()): string { return today.slice(0, 7); }
function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10),
  };
}
function controlType(account: Pick<ControlAccount, "account_name" | "category">): "Bank" | "Cash" | "Mobile money" | "Wallet" | "Other" {
  const text = `${account.account_name} ${account.category || ""}`.toLowerCase();
  if (/bank/.test(text)) return "Bank";
  if (/mobile/.test(text)) return "Mobile money";
  if (/wallet/.test(text)) return "Wallet";
  if (/cash|petty|till|float|vault/.test(text) || account.category === "cash") return "Cash";
  return "Other";
}
function isControlAccount(account: ControlAccount): boolean { return account.account_type === "asset" && controlType(account) !== "Other"; }
function statusStyle(status: "ready" | "in_progress" | "needs_review" | "no_activity") { return status === "ready" ? "bg-emerald-100 text-emerald-800" : status === "in_progress" ? "bg-indigo-100 text-indigo-800" : status === "no_activity" ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-800"; }

export function CashControlCenterPage({ onNavigate, initialMonth }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [month, setMonth] = useState(initialMonth || currentMonth());
  const [accounts, setAccounts] = useState<ControlAccount[]>([]);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [sessions, setSessions] = useState<ReconciliationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const range = useMemo(() => monthRange(month), [month]);

  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  const load = useCallback(async () => {
    if (!orgId) { setError("Your account is not linked to an organization."); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const accountRes = await db.from("gl_accounts").select("id,account_code,account_name,account_type,category,is_active").eq("organization_id", orgId).eq("is_active", true).order("account_code");
      if (accountRes.error) throw accountRes.error;
      const controlAccounts = filterGlAccountsForBusinessType(normalizeGlAccountRows((accountRes.data || []) as unknown[]), user?.business_type).filter(isControlAccount) as ControlAccount[];
      const ids = controlAccounts.map((account) => account.id);
      const sessionPromise = db.from("reconciliation_sessions").select("control_gl_account_id,status,period_start,period_end,updated_at").eq("organization_id", orgId).order("updated_at", { ascending: false });
      const journalLines: JournalLine[] = [];
      if (ids.length) {
        for (let from = 0; ; from += 1000) {
          const lineRes = await db.from("journal_entry_lines")
            .select("gl_account_id,debit,credit,journal_entries!inner(entry_date,organization_id,is_posted,is_deleted)")
            .in("gl_account_id", ids)
            .eq("journal_entries.organization_id", orgId)
            .lte("journal_entries.entry_date", range.end)
            .eq("journal_entries.is_posted", true)
            .eq("journal_entries.is_deleted", false)
            .order("entry_date", { ascending: false, referencedTable: "journal_entries" })
            .range(from, from + 999);
          if (lineRes.error) throw lineRes.error;
          journalLines.push(...((lineRes.data || []) as JournalLine[]));
          if ((lineRes.data || []).length < 1000) break;
        }
      }
      const sessionRes = await sessionPromise;
      if (sessionRes.error) throw sessionRes.error;
      setAccounts(controlAccounts);
      setLines(journalLines);
      setSessions((sessionRes.data || []) as ReconciliationSession[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setAccounts([]); setLines([]); setSessions([]);
    } finally { setLoading(false); }
  }, [orgId, range.end, user?.business_type]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => accounts.map((account) => {
    const accountLines = lines.filter((line) => line.gl_account_id === account.id);
    const balance = accountLines.reduce((total, line) => total + Number(line.debit || 0) - Number(line.credit || 0), 0);
    const lastActivity = accountLines.reduce<string | null>((latest, line) => !latest || (line.journal_entries?.entry_date || "") > latest ? line.journal_entries?.entry_date || null : latest, null);
    const periodSession = sessions.find((session) => session.control_gl_account_id === account.id && session.period_start <= range.start && session.period_end >= range.end);
    const status = periodSession?.status === "approved" ? "ready" as const : periodSession ? "in_progress" as const : accountLines.length === 0 ? "no_activity" as const : "needs_review" as const;
    return { account, balance, lastActivity, session: periodSession || null, status };
  }), [accounts, lines, range.end, range.start, sessions]);
  const needsReview = rows.filter((row) => row.status === "needs_review").length;
  const inProgress = rows.filter((row) => row.status === "in_progress").length;
  const ready = rows.filter((row) => row.status === "ready").length;
  const totalBalance = rows.reduce((total, row) => total + row.balance, 0);

  const openReconciliation = (accountId: string) => onNavigate("accounting_bank_reconciliation", { reconciliationAccountId: accountId, reconciliationPeriodStart: range.start, reconciliationPeriodEnd: range.end });

  return <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-indigo-600">Treasury control</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Cash & bank control centre</h1><p className="mt-1 max-w-3xl text-sm text-slate-600">One control view for every bank, cash, mobile-money and wallet account in the chart of accounts.</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button><label className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Review month <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="ml-2 bg-transparent outline-none" /></label></div></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Available balance" value={money.format(totalBalance)} detail="Posted ledger balance" tone="indigo" /><Metric label="Ready" value={String(ready)} detail="Approved reconciliations" tone="emerald" /><Metric label="In progress" value={String(inProgress)} detail="Reconciliations started" tone={inProgress ? "indigo" : "emerald"} /><Metric label="Needs review" value={String(needsReview)} detail="Account activity not reconciled" tone={needsReview ? "amber" : "emerald"} /></section>
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4"><div><h2 className="font-bold text-slate-900">Control-account readiness</h2><p className="mt-1 text-sm text-slate-500">Balances are posted-ledger values through {range.end}. A reconciliation is ready only when it has been approved.</p></div><button type="button" onClick={() => onNavigate("financial_close_workspace", { closeMonth: month })} className="app-btn-secondary">Open month-end close <ArrowRight className="h-4 w-4" /></button></div>
      {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading control accounts…</p> : rows.length === 0 ? <div className="p-8 text-center"><WalletCards className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-700">No cash, bank, mobile-money or wallet accounts were found.</p><p className="mt-1 text-xs text-slate-500">Add or correctly categorise the accounts in the chart of accounts to include them here.</p><button type="button" onClick={() => onNavigate("gl_accounts")} className="mt-4 text-sm font-semibold text-indigo-700">Open chart of accounts</button></div> : <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Account</th><th className="px-5 py-3">Type</th><th className="px-5 py-3 text-right">Ledger balance</th><th className="px-5 py-3">Last activity</th><th className="px-5 py-3">Reconciliation</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.account.id} className="align-middle"><td className="px-5 py-4"><strong className="block text-slate-900">{row.account.account_code} — {row.account.account_name}</strong><span className="text-xs text-slate-500">Chart of accounts control account</span></td><td className="px-5 py-4 text-slate-600">{controlType(row.account)}</td><td className={`px-5 py-4 text-right font-semibold ${row.balance < 0 ? "text-rose-700" : "text-slate-900"}`}>{money.format(row.balance)}</td><td className="px-5 py-4 text-slate-600">{row.lastActivity || "No posted activity"}</td><td className="px-5 py-4"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle(row.status)}`}>{row.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{row.status === "ready" ? "Approved" : row.status === "in_progress" ? "In progress" : row.status === "no_activity" ? "No activity" : "Needs review"}</span>{row.session && <p className="mt-1 text-xs text-slate-500">Updated {new Date(row.session.updated_at).toLocaleDateString("en-UG")}</p>}</td><td className="px-5 py-4 text-right"><button type="button" onClick={() => openReconciliation(row.account.id)} className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 hover:text-indigo-900">{row.status === "ready" ? "View" : row.status === "in_progress" ? "Continue" : "Reconcile"}<ArrowRight className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>}
    </section>
    <section className="grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><div className="flex gap-3"><Landmark className="mt-0.5 h-5 w-5 text-indigo-700" /><div><h2 className="font-semibold text-indigo-950">How this control works</h2><p className="mt-1 text-sm text-indigo-900">Bank, cash, mobile-money and wallet accounts are read directly from your chart of accounts. They are not separate manually-maintained lists.</p></div></div></div><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><div className="flex gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 text-amber-700" /><div><h2 className="font-semibold text-amber-950">Close-period safeguard</h2><p className="mt-1 text-sm text-amber-900">Unreconciled activity is visible to the financial-close workspace. Any exceptional close needs an explicit review confirmation and close note.</p></div></div></div></section>
  </main>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "emerald" | "indigo" | "amber" }) {
  const tones = { emerald: "border-emerald-200 bg-emerald-50", indigo: "border-indigo-200 bg-indigo-50", amber: "border-amber-200 bg-amber-50" };
  return <div className={`rounded-2xl border p-4 ${tones[tone]}`}><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p><p className="mt-2 text-xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-600">{detail}</p></div>;
}
