import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, HandCoins, LogOut, PiggyBank, ReceiptText, ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type ShareRow = { id: string; shares_bought: number; total_value: number; created_at: string };
type LoanRow = { id: string; principal_amount: number; outstanding_balance: number; status: string; due_date: string | null; disbursed_on: string | null };
type FineRow = { id: string; fine_type: string; amount: number; created_at: string };
type MeetingRow = { id: string; meeting_date: string; status: string };

const money = (value: number) => new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(value || 0);
const date = (value: string) => new Intl.DateTimeFormat("en-UG", { dateStyle: "medium" }).format(new Date(value));

export default function VslaMemberDashboard() {
  const { user, signOut } = useAuth();
  const memberId = user?.vsla_member_id;
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [fines, setFines] = useState<FineRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!memberId) return;
    setLoading(true); setError(null);
    const [shareResult, loanResult, fineResult, meetingResult] = await Promise.all([
      supabase.from("vsla_share_transactions").select("id,shares_bought,total_value,created_at").eq("member_id", memberId).order("created_at", { ascending: false }),
      supabase.from("vsla_loans").select("id,principal_amount,outstanding_balance,status,due_date,disbursed_on").eq("member_id", memberId).order("disbursed_on", { ascending: false }),
      supabase.from("vsla_fines").select("id,fine_type,amount,created_at").eq("member_id", memberId).order("created_at", { ascending: false }),
      supabase.from("vsla_meetings").select("id,meeting_date,status").gte("meeting_date", new Date().toISOString().slice(0, 10)).order("meeting_date").limit(5),
    ]);
    const firstError = shareResult.error || loanResult.error || fineResult.error || meetingResult.error;
    if (firstError) setError(firstError.message);
    setShares((shareResult.data || []) as ShareRow[]);
    setLoans((loanResult.data || []) as LoanRow[]);
    setFines((fineResult.data || []) as FineRow[]);
    setMeetings((meetingResult.data || []) as MeetingRow[]);
    setLoading(false);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => ({
    shares: shares.reduce((sum, row) => sum + Number(row.shares_bought || 0), 0),
    savings: shares.reduce((sum, row) => sum + Number(row.total_value || 0), 0),
    outstanding: loans.filter((row) => !["closed", "applied"].includes(row.status)).reduce((sum, row) => sum + Number(row.outstanding_balance || 0), 0),
    fines: fines.reduce((sum, row) => sum + Number(row.amount || 0), 0),
  }), [shares, loans, fines]);

  return <main className="min-h-screen bg-slate-100">
    <header className="bg-emerald-800 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-200">VSLA member app</p><h1 className="mt-1 text-xl font-bold">Welcome, {user?.full_name || "Member"}</h1></div>
        <button type="button" onClick={() => void signOut()} className="flex min-h-11 items-center gap-2 rounded-xl border border-white/30 px-4 text-sm font-semibold hover:bg-white/10"><LogOut className="h-4 w-4"/>Sign out</button>
      </div>
    </header>
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><ShieldCheck className="h-5 w-5 shrink-0"/>Only records linked to your membership are shown.</div>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error} <button onClick={() => void load()} className="ml-2 font-bold underline">Retry</button></div>}
      <section aria-label="Member summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[[PiggyBank, "Savings", money(totals.savings)], [ReceiptText, "Shares", totals.shares.toLocaleString()], [HandCoins, "Loan balance", money(totals.outstanding)], [ReceiptText, "Fines recorded", money(totals.fines)]].map(([Icon, label, value]) => <article key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Icon className="h-5 w-5 text-emerald-700"/><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{String(label)}</p><p className="mt-1 text-lg font-bold text-slate-900">{loading ? "…" : String(value)}</p></article>)}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><HandCoins className="h-5 w-5 text-emerald-700"/>My loans</h2><div className="mt-4 space-y-3">{loans.length ? loans.map(row => <div key={row.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><div><p className="font-semibold capitalize">{row.status}</p><p className="text-xs text-slate-500">{row.disbursed_on ? `Disbursed ${date(row.disbursed_on)}` : "Disbursement date unavailable"}{row.due_date ? ` · Due ${date(row.due_date)}` : ""}</p></div><div className="text-right"><p className="font-bold">{money(row.outstanding_balance)}</p><p className="text-xs text-slate-500">of {money(row.principal_amount)}</p></div></div>) : <p className="py-6 text-center text-sm text-slate-500">No loans recorded.</p>}</div></section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="flex items-center gap-2 font-bold text-slate-900"><CalendarDays className="h-5 w-5 text-emerald-700"/>Upcoming meetings</h2><div className="mt-4 space-y-3">{meetings.length ? meetings.map(row => <div key={row.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><span className="font-semibold">{date(row.meeting_date)}</span><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold capitalize text-emerald-800">{row.status}</span></div>) : <p className="py-6 text-center text-sm text-slate-500">No upcoming meetings.</p>}</div></section>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-bold text-slate-900">Recent savings</h2><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="pb-2">Date</th><th className="pb-2">Shares</th><th className="pb-2 text-right">Value</th></tr></thead><tbody>{shares.slice(0, 10).map(row => <tr key={row.id} className="border-b border-slate-100"><td className="py-3">{date(row.created_at)}</td><td>{row.shares_bought}</td><td className="text-right font-semibold">{money(row.total_value)}</td></tr>)}</tbody></table>{!shares.length && <p className="py-6 text-center text-slate-500">No savings recorded yet.</p>}</div></section>
    </div>
  </main>;
}
