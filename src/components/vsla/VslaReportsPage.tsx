import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { downloadCsv, downloadXlsx, exportAccountingPdf } from "@/lib/accountingReportExport";
import { VSLA_PAGE } from "@/lib/vslaPages";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";

type Cycle = { id: string; name: string; starts_on: string; ends_on: string | null; status: string };
type Member = { id: string; full_name: string; member_number: string | null };
type Loan = { id: string; member_id: string; principal_amount: number; outstanding_balance: number; due_date: string | null; status: string };
type Share = { member_id: string; shares_bought: number; total_value: number };
type Meeting = { id: string; meeting_date: string; status: string };
type Attendance = { meeting_id: string; member_id: string; present: boolean };
type Fund = { id: string; fund_type: string; txn_type: string; amount: number; reason: string | null; created_at: string };
type Fine = { id: string; member_id: string; fine_type: string; amount: number; created_at: string };
type ReportTab = "loans" | "savings" | "attendance" | "funds";

export function VslaReportsPage({ readOnly = false, onNavigate }: { readOnly?: boolean; onNavigate?: (page: string, state?: Record<string, unknown>) => void }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [funds, setFunds] = useState<Fund[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [tab, setTab] = useState<ReportTab>("loans");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const cycleRes = await filterByOrganizationId(supabase.from("vsla_cycles").select("id,name,starts_on,ends_on,status").order("starts_on", { ascending: false }), orgId, superAdmin);
    const cycleRows = (cycleRes.data ?? []) as Cycle[];
    setCycles(cycleRows);
    const selectedCycleId = cycleRows.some((cycle) => cycle.id === cycleId) ? cycleId : (cycleRows.find((cycle) => cycle.status === "active")?.id ?? cycleRows[0]?.id ?? "");
    if (selectedCycleId !== cycleId) setCycleId(selectedCycleId);
    const safeCycleId = selectedCycleId || "00000000-0000-0000-0000-000000000000";
    const [membersRes, loansRes, sharesRes, meetingsRes, attendanceRes, fundsRes, finesRes] = await Promise.all([
      filterByOrganizationId(supabase.from("vsla_members").select("id,full_name,member_number").order("full_name"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_loans").select("id,member_id,principal_amount,outstanding_balance,due_date,status").eq("cycle_id", safeCycleId).order("due_date"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_share_transactions").select("member_id,shares_bought,total_value").eq("cycle_id", safeCycleId), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_meetings").select("id,meeting_date,status").eq("cycle_id", safeCycleId).order("meeting_date"), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_meeting_attendance").select("meeting_id,member_id,present").eq("cycle_id", safeCycleId), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_fund_transactions").select("id,fund_type,txn_type,amount,reason,created_at").eq("cycle_id", safeCycleId).order("created_at", { ascending: false }), orgId, superAdmin),
      filterByOrganizationId(supabase.from("vsla_fines").select("id,member_id,fine_type,amount,created_at").eq("cycle_id", safeCycleId).order("created_at", { ascending: false }), orgId, superAdmin),
    ]);
    setMembers((membersRes.data ?? []) as Member[]); setLoans((loansRes.data ?? []) as Loan[]); setShares((sharesRes.data ?? []) as Share[]); setMeetings((meetingsRes.data ?? []) as Meeting[]); setAttendance((attendanceRes.data ?? []) as Attendance[]); setFunds((fundsRes.data ?? []) as Fund[]); setFines((finesRes.data ?? []) as Fine[]);
    setError(cycleRes.error?.message ?? membersRes.error?.message ?? loansRes.error?.message ?? sharesRes.error?.message ?? meetingsRes.error?.message ?? attendanceRes.error?.message ?? fundsRes.error?.message ?? finesRes.error?.message ?? null);
    setLoading(false);
  }, [cycleId, orgId, superAdmin]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, tab, cycleId]);

  const today = new Date().toISOString().slice(0, 10);
  const labels = useMemo(() => new Map(members.map((member) => [member.id, formatVslaMemberLabel(member)])), [members]);
  const selectedCycle = cycles.find((cycle) => cycle.id === cycleId) ?? null;
  const activeLoans = loans.filter((loan) => loan.status === "disbursed" && Number(loan.outstanding_balance) > 0);
  const overdueLoans = activeLoans.filter((loan) => !!loan.due_date && loan.due_date < today);
  const savingsValue = shares.reduce((sum, row) => sum + Number(row.total_value || 0), 0);
  const portfolio = activeLoans.reduce((sum, loan) => sum + Number(loan.outstanding_balance || 0), 0);
  const savingsRows = useMemo(() => Array.from(shares.reduce((map, row) => { const current = map.get(row.member_id) ?? { member_id: row.member_id, shares: 0, value: 0 }; current.shares += Number(row.shares_bought || 0); current.value += Number(row.total_value || 0); map.set(row.member_id, current); return map; }, new Map<string, { member_id: string; shares: number; value: number }>()).values()).sort((a, b) => b.value - a.value), [shares]);
  const attendanceRows = meetings.map((meeting) => { const marked = attendance.filter((row) => row.meeting_id === meeting.id); return { ...meeting, marked: marked.length, present: marked.filter((row) => row.present).length, absent: marked.filter((row) => !row.present).length }; });
  const fundBalance = funds.reduce((sum, row) => sum + (row.txn_type === "contribution" ? Number(row.amount) : -Number(row.amount)), 0);
  const fineTotal = fines.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const query = search.trim().toLowerCase();
  const reportRows = tab === "loans" ? loans.filter((row) => (labels.get(row.member_id) ?? "").toLowerCase().includes(query)) : tab === "savings" ? savingsRows.filter((row) => (labels.get(row.member_id) ?? "").toLowerCase().includes(query)) : tab === "attendance" ? attendanceRows.filter((row) => row.meeting_date.includes(query)) : [...funds, ...fines].filter((row) => JSON.stringify(row).toLowerCase().includes(query));
  const pageCount = Math.max(1, Math.ceil(reportRows.length / pageSize));
  const visibleRows = reportRows.slice((page - 1) * pageSize, page * pageSize);

  const sections = () => [
    { title: "Loan Aging", head: ["Member", "Principal", "Outstanding", "Due", "Status"], body: loans.map((row) => [labels.get(row.member_id) ?? "Unknown", row.principal_amount, row.outstanding_balance, row.due_date ?? "", row.due_date && row.due_date < today && row.outstanding_balance > 0 ? "Overdue" : row.status]) },
    { title: "Savings by Member", head: ["Member", "Shares", "Value"], body: savingsRows.map((row) => [labels.get(row.member_id) ?? "Unknown", row.shares, row.value]) },
    { title: "Attendance", head: ["Meeting", "Present", "Absent", "Marked"], body: attendanceRows.map((row) => [row.meeting_date, row.present, row.absent, row.marked]) },
    { title: "Funds", head: ["Date", "Fund", "Type", "Amount", "Reason"], body: funds.map((row) => [row.created_at.slice(0, 10), row.fund_type, row.txn_type, row.amount, row.reason ?? ""]) },
  ];
  const exportRows = () => sections().flatMap((section) => [[section.title], section.head, ...section.body, []]);
  const fileTag = (selectedCycle?.name ?? "cycle").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  return <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
    {readOnly && <ReadOnlyNotice />}
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">VSLA Reports</h1><p className="text-sm text-slate-600 mt-1">Loans, savings, attendance, fines and fund activity by cycle.</p></div><label className="text-xs text-slate-600">Reporting Cycle<select value={cycleId} onChange={(event) => setCycleId(event.target.value)} className="mt-1 block w-full sm:min-w-60 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm"><option value="">No cycles available</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>{cycle.name} ({cycle.status})</option>)}</select></label></div>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[["Members", members.length], ["Meetings", meetings.length], ["Savings", savingsValue.toLocaleString()], ["Portfolio", portfolio.toLocaleString()], ["Overdue", overdueLoans.length], ["Fund Balance", fundBalance.toLocaleString()]].map(([label, value]) => <div key={label} className="bg-white border border-slate-200 rounded-xl p-3 sm:p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-lg sm:text-xl font-bold text-slate-900 mt-1">{loading ? "—" : value}</p></div>)}</div>
    <div className="flex flex-wrap gap-2"><button onClick={() => downloadCsv(`vsla-${fileTag}.csv`, exportRows())} disabled={!cycleId || loading} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm text-white disabled:opacity-50"><Download className="w-4 h-4" />CSV</button><button onClick={() => downloadXlsx(`vsla-${fileTag}.xlsx`, exportRows(), { sheetName: "VSLA Reports" })} disabled={!cycleId || loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"><Download className="w-4 h-4" />Excel</button><button onClick={() => exportAccountingPdf({ title: `VSLA Cycle Report - ${selectedCycle?.name ?? ""}`, subtitle: `${selectedCycle?.starts_on ?? ""} to ${selectedCycle?.ends_on ?? "Active"}`, filename: `vsla-${fileTag}.pdf`, sections: sections() })} disabled={!cycleId || loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50"><FileText className="w-4 h-4" />PDF</button><button onClick={() => onNavigate?.(VSLA_PAGE.memberStatement)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><ExternalLink className="w-4 h-4" />Member Statements</button></div>
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden"><div className="p-3 border-b border-slate-200 flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between"><div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="VSLA report type">{(["loans", "savings", "attendance", "funds"] as ReportTab[]).map((item) => <button key={item} role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm capitalize ${tab === item ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-700"}`}>{item}</button>)}</div><label className="relative"><span className="sr-only">Search report</span><Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full lg:w-72 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-base sm:text-sm" placeholder="Search this report..." /></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm"><thead className="bg-slate-50">{tab === "loans" ? <tr><th className="text-left p-3">Member</th><th className="text-right p-3">Principal</th><th className="text-right p-3">Outstanding</th><th className="text-left p-3">Due</th><th className="text-left p-3">Status</th></tr> : tab === "savings" ? <tr><th className="text-left p-3">Member</th><th className="text-right p-3">Shares</th><th className="text-right p-3">Savings Value</th></tr> : tab === "attendance" ? <tr><th className="text-left p-3">Meeting</th><th className="text-right p-3">Present</th><th className="text-right p-3">Absent</th><th className="text-right p-3">Marked</th></tr> : <tr><th className="text-left p-3">Date</th><th className="text-left p-3">Category</th><th className="text-left p-3">Type</th><th className="text-right p-3">Amount</th><th className="text-left p-3">Details</th></tr>}</thead><tbody>{visibleRows.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-500">No matching records.</td></tr> : tab === "loans" ? (visibleRows as Loan[]).map((row) => { const overdue = !!row.due_date && row.due_date < today && row.outstanding_balance > 0; return <tr key={row.id} className={`border-t ${overdue ? "bg-rose-50" : ""}`}><td className="p-3">{labels.get(row.member_id)}</td><td className="p-3 text-right">{row.principal_amount.toLocaleString()}</td><td className="p-3 text-right">{row.outstanding_balance.toLocaleString()}</td><td className="p-3">{row.due_date ?? "—"}</td><td className={`p-3 ${overdue ? "text-rose-700 font-medium" : ""}`}>{overdue ? "Overdue" : row.status}</td></tr> }) : tab === "savings" ? (visibleRows as typeof savingsRows).map((row) => <tr key={row.member_id} className="border-t"><td className="p-3">{labels.get(row.member_id)}</td><td className="p-3 text-right">{row.shares}</td><td className="p-3 text-right">{row.value.toLocaleString()}</td></tr>) : tab === "attendance" ? (visibleRows as typeof attendanceRows).map((row) => <tr key={row.id} className="border-t"><td className="p-3">{row.meeting_date}</td><td className="p-3 text-right">{row.present}</td><td className="p-3 text-right">{row.absent}</td><td className="p-3 text-right">{row.marked}</td></tr>) : (visibleRows as Array<Fund | Fine>).map((row) => "fund_type" in row ? <tr key={`fund-${row.id}`} className="border-t"><td className="p-3">{row.created_at.slice(0, 10)}</td><td className="p-3">{row.fund_type}</td><td className="p-3">{row.txn_type}</td><td className="p-3 text-right">{row.amount.toLocaleString()}</td><td className="p-3">{row.reason ?? "—"}</td></tr> : <tr key={`fine-${row.id}`} className="border-t"><td className="p-3">{row.created_at.slice(0, 10)}</td><td className="p-3">Fine</td><td className="p-3">{row.fine_type}</td><td className="p-3 text-right">{row.amount.toLocaleString()}</td><td className="p-3">{labels.get(row.member_id) ?? "Unknown"}</td></tr>)}</tbody></table></div>
      <div className="border-t border-slate-200 p-3 flex items-center justify-between text-sm"><span className="text-slate-500">{reportRows.length} records · Fines {fineTotal.toLocaleString()}</span><div className="flex items-center gap-2"><button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="rounded border px-3 py-1.5 disabled:opacity-40">Previous</button><span>{page}/{pageCount}</span><button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount} className="rounded border px-3 py-1.5 disabled:opacity-40">Next</button></div></div>
    </div>
  </div>;
}
