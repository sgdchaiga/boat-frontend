import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { downloadCsv, exportAccountingPdf } from "@/lib/accountingReportExport";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";

type Member = { id: string; full_name: string; member_number: string | null };
type Meeting = { id: string; meeting_date: string };
type ShareTxn = {
  id: string;
  member_id: string;
  meeting_id: string | null;
  total_value: number | null;
  created_at: string;
};
type Loan = {
  id: string;
  member_id: string;
  principal_amount: number | null;
  status: string;
  applied_at: string;
};
type Repayment = {
  id: string;
  loan_id: string;
  principal_paid: number | null;
  interest_paid: number | null;
  penalty_paid: number | null;
  created_at: string;
};
type Fine = {
  id: string;
  member_id: string;
  fine_type: string;
  amount: number | null;
  created_at: string;
};

type StatementRow = {
  id: string;
  date: string;
  type: "savings" | "loan" | "repayment" | "fine";
  amount: number;
  note: string;
};
type SortColumn = "date" | "type" | "amount" | "note";
type SortDirection = "asc" | "desc";

export function VslaMemberStatementPage({
  readOnly = false,
}: {
  readOnly?: boolean;
}) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;

  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [shares, setShares] = useState<ShareTxn[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [repayments, setRepayments] = useState<Repayment[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [vslaName, setVslaName] = useState("VSLA");

  const [memberId, setMemberId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [includeSavings, setIncludeSavings] = useState(true);
  const [includeLoans, setIncludeLoans] = useState(true);
  const [includeRepayments, setIncludeRepayments] = useState(true);
  const [includeFines, setIncludeFines] = useState(true);
  const [sortColumn, setSortColumn] = useState<SortColumn>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const qp = new URLSearchParams(window.location.search);
    const sortCol = qp.get("vslaStatementSort");
    const sortDir = qp.get("vslaStatementDir");
    if (
      sortCol === "date" ||
      sortCol === "type" ||
      sortCol === "amount" ||
      sortCol === "note"
    ) {
      setSortColumn(sortCol);
    }
    if (sortDir === "asc" || sortDir === "desc") {
      setSortDirection(sortDir);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("vslaStatementSort", sortColumn);
    url.searchParams.set("vslaStatementDir", sortDirection);
    window.history.replaceState({}, "", url.toString());
  }, [sortColumn, sortDirection]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const orgPromise = orgId
      ? supabase
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as {
          data: { name?: string | null } | null;
          error: { message?: string } | null;
        });
    const [mRes, mtRes, sRes, lRes, rRes, fRes, orgRes] = await Promise.all([
      filterByOrganizationId(
        supabase
          .from("vsla_members")
          .select("id,full_name,member_number")
          .order("full_name"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase.from("vsla_meetings").select("id,meeting_date"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_share_transactions")
          .select("id,member_id,meeting_id,total_value,created_at"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_loans")
          .select("id,member_id,principal_amount,status,applied_at"),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_loan_repayments")
          .select(
            "id,loan_id,principal_paid,interest_paid,penalty_paid,created_at",
          ),
        orgId,
        superAdmin,
      ),
      filterByOrganizationId(
        supabase
          .from("vsla_fines")
          .select("id,member_id,fine_type,amount,created_at"),
        orgId,
        superAdmin,
      ),
      orgPromise,
    ]);
    const anyError =
      mRes.error ||
      mtRes.error ||
      sRes.error ||
      lRes.error ||
      rRes.error ||
      fRes.error;
    if (anyError) {
      setError(anyError.message || "Failed to load statement data.");
      setMembers([]);
      setMeetings([]);
      setShares([]);
      setLoans([]);
      setRepayments([]);
      setFines([]);
      setLoading(false);
      return;
    }
    const membersData = (mRes.data ?? []) as Member[];
    setMembers(membersData);
    setMeetings((mtRes.data ?? []) as Meeting[]);
    setShares((sRes.data ?? []) as ShareTxn[]);
    setLoans((lRes.data ?? []) as Loan[]);
    setRepayments((rRes.data ?? []) as Repayment[]);
    setFines((fRes.data ?? []) as Fine[]);
    const orgName = (orgRes.data as { name?: string | null } | null)?.name;
    setVslaName(orgName?.trim() ? orgName : "VSLA");
    if (!memberId && membersData[0]?.id) setMemberId(membersData[0].id);
    setLoading(false);
  }, [memberId, orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const meetingDateById = useMemo(() => {
    return new Map(meetings.map((m) => [m.id, m.meeting_date]));
  }, [meetings]);

  const loanMemberByLoanId = useMemo(() => {
    return new Map(loans.map((l) => [l.id, l.member_id]));
  }, [loans]);

  const rows = useMemo(() => {
    if (!memberId) return [] as StatementRow[];
    const out: StatementRow[] = [];
    if (includeSavings) {
      for (const s of shares) {
        if (s.member_id !== memberId) continue;
        const date =
          (s.meeting_id ? meetingDateById.get(s.meeting_id) : null) ??
          String(s.created_at).slice(0, 10);
        out.push({
          id: `s-${s.id}`,
          date,
          type: "savings",
          amount: Number(s.total_value || 0),
          note: "Share purchase",
        });
      }
    }
    if (includeLoans) {
      for (const l of loans) {
        if (l.member_id !== memberId) continue;
        out.push({
          id: `l-${l.id}`,
          date: String(l.applied_at).slice(0, 10),
          type: "loan",
          amount: Number(l.principal_amount || 0),
          note: `Loan ${l.status}`,
        });
      }
    }
    if (includeRepayments) {
      for (const r of repayments) {
        const repaymentMemberId = loanMemberByLoanId.get(r.loan_id);
        if (repaymentMemberId !== memberId) continue;
        const amount =
          Number(r.principal_paid || 0) +
          Number(r.interest_paid || 0) +
          Number(r.penalty_paid || 0);
        out.push({
          id: `r-${r.id}`,
          date: String(r.created_at).slice(0, 10),
          type: "repayment",
          amount,
          note: `Principal ${Number(r.principal_paid || 0).toLocaleString()}, Interest ${Number(r.interest_paid || 0).toLocaleString()}, Penalty ${Number(r.penalty_paid || 0).toLocaleString()}`,
        });
      }
    }
    if (includeFines) {
      for (const f of fines) {
        if (f.member_id !== memberId) continue;
        out.push({
          id: `f-${f.id}`,
          date: String(f.created_at).slice(0, 10),
          type: "fine",
          amount: Number(f.amount || 0),
          note: `Fine: ${f.fine_type}`,
        });
      }
    }
    return out
      .filter((r) => (fromDate ? r.date >= fromDate : true))
      .filter((r) => (toDate ? r.date <= toDate : true));
  }, [
    fines,
    fromDate,
    includeFines,
    includeLoans,
    includeRepayments,
    includeSavings,
    loanMemberByLoanId,
    loans,
    meetingDateById,
    memberId,
    repayments,
    shares,
    toDate,
  ]);

  const sortedRows = useMemo(() => {
    const data = [...rows];
    data.sort((a, b) => {
      let cmp = 0;
      if (sortColumn === "date") cmp = a.date.localeCompare(b.date);
      if (sortColumn === "type") cmp = a.type.localeCompare(b.type);
      if (sortColumn === "amount") cmp = a.amount - b.amount;
      if (sortColumn === "note") cmp = a.note.localeCompare(b.note);
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return data;
  }, [rows, sortColumn, sortDirection]);

  const totals = useMemo(() => {
    let savings = 0;
    let loans = 0;
    let repayments = 0;
    let fines = 0;
    for (const r of sortedRows) {
      if (r.type === "savings") savings += r.amount;
      if (r.type === "loan") loans += r.amount;
      if (r.type === "repayment") repayments += r.amount;
      if (r.type === "fine") fines += r.amount;
    }
    return { savings, loans, repayments, fines };
  }, [sortedRows]);

  const selectedMemberName = useMemo(() => {
    const found = members.find((m) => m.id === memberId);
    return found ? formatVslaMemberLabel(found) : "Member";
  }, [memberId, members]);

  const onSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortColumn(column);
    setSortDirection(column === "date" ? "desc" : "asc");
  };

  const sortMark = (column: SortColumn) => {
    if (sortColumn !== column) return "";
    return sortDirection === "asc" ? " ▲" : " ▼";
  };

  const exportExcel = () => {
    const fileTag = selectedMemberName.replace(/[^\w.-]+/g, "_");
    const filterSummary = [
      `From: ${fromDate || "All"}`,
      `To: ${toDate || "All"}`,
      `Savings: ${includeSavings ? "Yes" : "No"}`,
      `Loans: ${includeLoans ? "Yes" : "No"}`,
      `Repayments: ${includeRepayments ? "Yes" : "No"}`,
      `Fines: ${includeFines ? "Yes" : "No"}`,
    ].join(" | ");
    const data: (string | number)[][] = [
      ["Member Statement", selectedMemberName],
      ["VSLA Name", vslaName],
      ["Generated On", new Date().toISOString().slice(0, 10)],
      ["Filters", filterSummary],
      [],
      ["Date", "Type", "Amount", "Details"],
      ...sortedRows.map((r) => [r.date, r.type, r.amount, r.note]),
      [],
      ["Totals", "", "", ""],
      ["Savings", totals.savings, "", ""],
      ["Loans", totals.loans, "", ""],
      ["Repayments", totals.repayments, "", ""],
      ["Fines", totals.fines, "", ""],
    ];
    downloadCsv(`vsla_member_statement_${fileTag}.csv`, data);
  };

  const exportPdf = () => {
    const fileTag = selectedMemberName.replace(/[^\w.-]+/g, "_");
    const filterSummary = [
      `From: ${fromDate || "All"}`,
      `To: ${toDate || "All"}`,
      `Savings: ${includeSavings ? "Yes" : "No"}`,
      `Loans: ${includeLoans ? "Yes" : "No"}`,
      `Repayments: ${includeRepayments ? "Yes" : "No"}`,
      `Fines: ${includeFines ? "Yes" : "No"}`,
    ].join(" | ");
    exportAccountingPdf({
      title: "VSLA Member Statement",
      subtitle: `${vslaName} | ${selectedMemberName} | ${filterSummary}`,
      filename: `vsla_member_statement_${fileTag}.pdf`,
      sections: [
        {
          title: "Transactions",
          head: ["Date", "Type", "Amount", "Details"],
          body: sortedRows.map((r) => [
            r.date,
            r.type,
            r.amount.toLocaleString(),
            r.note,
          ]),
        },
        {
          title: "Totals",
          head: ["Savings", "Loans", "Repayments", "Fines"],
          body: [
            [
              totals.savings.toLocaleString(),
              totals.loans.toLocaleString(),
              totals.repayments.toLocaleString(),
              totals.fines.toLocaleString(),
            ],
          ],
        },
      ],
    });
  };

  const printStatement = () => {
    const tableRows = sortedRows
      .map(
        (r) =>
          `<tr><td>${r.date}</td><td style="text-transform:capitalize;">${r.type}</td><td>${r.amount.toLocaleString()}</td><td>${r.note}</td></tr>`,
      )
      .join("");
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>VSLA Member Statement - ${vslaName} - ${selectedMemberName}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
      h1 { margin: 0 0 6px 0; font-size: 22px; }
      p { margin: 0 0 10px 0; font-size: 12px; color: #334155; }
      .totals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
      .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; font-size: 12px; background: #f8fafc; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; }
    </style>
  </head>
  <body>
    <h1>VSLA Member Statement</h1>
    <p><strong>VSLA:</strong> ${vslaName}</p>
    <p><strong>Member:</strong> ${selectedMemberName}</p>
    <p><strong>Period:</strong> ${fromDate || "All"} to ${toDate || "All"}</p>
    <p><strong>Filters:</strong> Savings(${includeSavings ? "Y" : "N"}), Loans(${includeLoans ? "Y" : "N"}), Repayments(${includeRepayments ? "Y" : "N"}), Fines(${includeFines ? "Y" : "N"})</p>
    <div class="totals">
      <div class="box">Savings: <strong>${totals.savings.toLocaleString()}</strong></div>
      <div class="box">Loans: <strong>${totals.loans.toLocaleString()}</strong></div>
      <div class="box">Repayments: <strong>${totals.repayments.toLocaleString()}</strong></div>
      <div class="box">Fines: <strong>${totals.fines.toLocaleString()}</strong></div>
    </div>
    <table>
      <thead>
        <tr><th>Date</th><th>Type</th><th>Amount</th><th>Details</th></tr>
      </thead>
      <tbody>
        ${tableRows || '<tr><td colspan="4">No statement entries for selected filters.</td></tr>'}
      </tbody>
    </table>
  </body>
</html>`;
    const w = window.open("", "_blank", "width=960,height=700");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Member Statement</h1>
        <p className="text-sm text-slate-600 mt-1">VSLA: {vslaName}</p>
        <p className="text-sm text-slate-600 mt-1">
          View member history with filters for date, savings, loans, repayments,
          and fines.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportExcel}
            className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-xs"
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={exportPdf}
            className="px-3 py-2 rounded-lg bg-indigo-700 text-white text-xs"
          >
            Export PDF
          </button>
          <button
            type="button"
            onClick={printStatement}
            className="px-3 py-2 rounded-lg bg-slate-700 text-white text-xs"
          >
            Print Statement
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <label className="text-xs text-slate-600 md:col-span-2">
          Member
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select member</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {formatVslaMemberLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-600">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-slate-700 flex items-end gap-2">
          <input
            type="checkbox"
            checked={includeSavings}
            onChange={(e) => setIncludeSavings(e.target.checked)}
          />
          Savings
        </label>
        <label className="text-xs text-slate-700 flex items-end gap-2">
          <input
            type="checkbox"
            checked={includeLoans}
            onChange={(e) => setIncludeLoans(e.target.checked)}
          />
          Loans
        </label>
        <label className="text-xs text-slate-700 flex items-end gap-2">
          <input
            type="checkbox"
            checked={includeRepayments}
            onChange={(e) => setIncludeRepayments(e.target.checked)}
          />
          Repayments
        </label>
        <label className="text-xs text-slate-700 flex items-end gap-2">
          <input
            type="checkbox"
            checked={includeFines}
            onChange={(e) => setIncludeFines(e.target.checked)}
          />
          Fines
        </label>
      </div>

      <div className="grid md:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg bg-slate-100 text-sm">
          Savings: <strong>{totals.savings.toLocaleString()}</strong>
        </div>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">
          Loans: <strong>{totals.loans.toLocaleString()}</strong>
        </div>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">
          Repayments: <strong>{totals.repayments.toLocaleString()}</strong>
        </div>
        <div className="p-3 rounded-lg bg-slate-100 text-sm">
          Fines: <strong>{totals.fines.toLocaleString()}</strong>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => onSort("date")}
                  className="font-semibold text-left"
                >
                  Date{sortMark("date")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => onSort("type")}
                  className="font-semibold text-left"
                >
                  Type{sortMark("type")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => onSort("amount")}
                  className="font-semibold text-left"
                >
                  Amount{sortMark("amount")}
                </button>
              </th>
              <th className="p-3 text-left">
                <button
                  type="button"
                  onClick={() => onSort("note")}
                  className="font-semibold text-left"
                >
                  Details{sortMark("note")}
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={4}>
                  Loading statement...
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={4}>
                  No statement entries for selected filters.
                </td>
              </tr>
            ) : (
              sortedRows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="p-3 text-slate-700">{r.date}</td>
                  <td className="p-3 text-slate-700 capitalize">{r.type}</td>
                  <td className="p-3 text-slate-700">
                    {r.amount.toLocaleString()}
                  </td>
                  <td className="p-3 text-slate-600">{r.note}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
