import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { businessTodayISO, computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { downloadCsv, exportAccountingPdf, formatDrCrCell, isNonZeroGlAmount } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";

type AccountBalance = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
  balance: number; // debit - credit; normal debit accounts positive, normal credit negative
};

export function TrialBalancePage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [asOfDate, setAsOfDate] = useState(() => businessTodayISO());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rows, setRows] = useState<AccountBalance[]>([]);
  const [useAsOf, setUseAsOf] = useState(false);
  const [showZeroBalanceAccounts, setShowZeroBalanceAccounts] = useState(true);

  useEffect(() => {
    fetchData();
  }, [dateRange, customFrom, customTo, asOfDate, useAsOf]);

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    const toDate = useAsOf ? asOfDate : computeRangeInTimezone(dateRange, customFrom, customTo).to.toISOString().slice(0, 10);
    const fromDate = useAsOf ? "1970-01-01" : computeRangeInTimezone(dateRange, customFrom, customTo).from.toISOString().slice(0, 10);

    if (!orgId && !superAdmin) {
      setFetchError("Missing organization on your staff profile. Contact admin to link your account.");
      setRows([]);
      setLoading(false);
      return;
    }

    const [linesRes, accRes] = await Promise.all([
      filterJournalLinesByOrganizationId(
        supabase
          .from("journal_entry_lines")
          .select(
            "debit, credit, gl_accounts!inner(id, account_code, account_name, account_type), journal_entries!inner(entry_date)"
          )
          .gte("journal_entries.entry_date", fromDate)
          .lte("journal_entries.entry_date", toDate)
          .eq("journal_entries.is_posted", true)
          .eq("gl_accounts.is_active", true),
        orgId,
        superAdmin
      ),
      filterByOrganizationId(
        supabase
          .from("gl_accounts")
          .select("*")
          .order("account_code"),
        orgId,
        superAdmin
      ),
    ]);
    const linesData = linesRes.data;
    const e2 = linesRes.error;

    if (e2) {
      setFetchError(e2.message);
      setRows([]);
      setLoading(false);
      return;
    }

    if (accRes.error) {
      setFetchError(accRes.error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    const accounts = normalizeGlAccountRows((accRes.data || []) as unknown[])
      .filter((row) => row.is_active)
      .map((row) => ({
        id: row.id,
        account_code: row.account_code,
        account_name: row.account_name,
        account_type: row.account_type,
      }));
    const accMap: Record<string, { id: string; account_code: string; account_name: string; account_type: string }> = Object.fromEntries(
      accounts.map((a) => [a.id, a])
    );
    const sums: Record<string, { debit: number; credit: number }> = {};
    (linesData || []).forEach((l: { debit: number; credit: number; gl_accounts: { id: string; account_code: string; account_name: string; account_type: string } | null }) => {
      const acc = l.gl_accounts;
      if (!acc) return;
      accMap[acc.id] = acc;
      if (!sums[acc.id]) sums[acc.id] = { debit: 0, credit: 0 };
      sums[acc.id].debit += Number(l.debit) || 0;
      sums[acc.id].credit += Number(l.credit) || 0;
    });
    accounts.forEach((acc) => {
      if (!sums[acc.id]) sums[acc.id] = { debit: 0, credit: 0 };
    });

    const result: AccountBalance[] = Object.entries(sums).map(([account_id, s]) => {
      const acc = accMap[account_id];
      const balance = s.debit - s.credit;
      return {
        account_id,
        account_code: acc?.account_code || "",
        account_name: acc?.account_name || "",
        account_type: acc?.account_type || "",
        debit: s.debit,
        credit: s.credit,
        balance,
      };
    }).sort((a, b) => a.account_code.localeCompare(b.account_code));

    setRows(result);
    setLoading(false);
  };

  const totalDebits = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredits = rows.reduce((s, r) => s + r.credit, 0);
  const balanced = Math.abs(totalDebits - totalCredits) < 0.01;

  const rowsDisplayed = useMemo(
    () =>
      showZeroBalanceAccounts
        ? rows
        : rows.filter((r) => isNonZeroGlAmount(r.debit) || isNonZeroGlAmount(r.credit)),
    [rows, showZeroBalanceAccounts]
  );

  const periodLabel = useMemo(() => {
    if (useAsOf) return `As of ${asOfDate}`;
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    return `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  }, [useAsOf, asOfDate, dateRange, customFrom, customTo]);

  const fileStamp = useMemo(() => {
    if (useAsOf) return asOfDate;
    return computeRangeInTimezone(dateRange, customFrom, customTo).to.toISOString().slice(0, 10);
  }, [useAsOf, asOfDate, dateRange, customFrom, customTo]);

  const exportExcel = () => {
    const data: (string | number)[][] = [
      ["Trial Balance", periodLabel],
      [],
      ["Account", "Name", "Debit", "Credit"],
      ...rowsDisplayed.map((r) => [
        r.account_code,
        r.account_name,
        formatDrCrCell(r.debit),
        formatDrCrCell(r.credit),
      ]),
      [],
      ["", "Total", totalDebits.toFixed(2), totalCredits.toFixed(2)],
      ["", "", balanced ? "Balanced" : `Out of balance by ${Math.abs(totalDebits - totalCredits).toFixed(2)}`, ""],
    ];
    downloadCsv(`trial-balance-${fileStamp}.csv`, data);
  };

  const exportPdf = () => {
    exportAccountingPdf({
      title: "Trial Balance",
      subtitle: periodLabel,
      filename: `trial-balance-${fileStamp}.pdf`,
      sections: [
        {
          title: "Accounts",
          head: ["Account", "Name", "Debit", "Credit"],
          body: rowsDisplayed.map((r) => [
            r.account_code,
            r.account_name,
            formatDrCrCell(r.debit),
            formatDrCrCell(r.credit),
          ]),
        },
      ],
      footerLines: [
        `Total debits: ${totalDebits.toFixed(2)}  Total credits: ${totalCredits.toFixed(2)}`,
        balanced ? "Trial balance is balanced." : `Out of balance by ${Math.abs(totalDebits - totalCredits).toFixed(2)}`,
      ],
    });
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Trial Balance</h1>
          <PageNotes ariaLabel="Trial balance help">
            <p>Summary of account balances from journal entries.</p>
          </PageNotes>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {fetchError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={useAsOf} onChange={(e) => setUseAsOf(e.target.checked)} />
            As of date
          </label>
          {useAsOf ? (
            <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="border rounded-lg px-3 py-2" />
          ) : (
            <>
              <select value={dateRange} onChange={(e) => setDateRange(e.target.value as DateRangeKey)} className="border rounded-lg px-3 py-2">
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This week</option>
                <option value="this_month">This month</option>
                <option value="last_month">Last month</option>
                <option value="custom">Custom</option>
              </select>
              {dateRange === "custom" && (
                <>
                  <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="border rounded-lg px-3 py-2" />
                  <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="border rounded-lg px-3 py-2" />
                </>
              )}
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showZeroBalanceAccounts}
              onChange={(e) => setShowZeroBalanceAccounts(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show zero-balance accounts
          </label>
        </div>
        {!loading && !fetchError && <AccountingExportButtons onExcel={exportExcel} onPdf={exportPdf} />}
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3 text-left">Account</th>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-right">Debit</th>
                <th className="p-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {rowsDisplayed.map((r) => (
                <tr key={r.account_id} className="border-t">
                  <td className="p-3 font-mono">{r.account_code}</td>
                  <td className="p-3">{r.account_name}</td>
                  <td className="p-3 text-right">{formatDrCrCell(r.debit)}</td>
                  <td className="p-3 text-right">{formatDrCrCell(r.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-100 font-medium">
              <tr>
                <td colSpan={2} className="p-3 text-right">Total</td>
                <td className="p-3 text-right">{totalDebits.toFixed(2)}</td>
                <td className="p-3 text-right">{totalCredits.toFixed(2)}</td>
              </tr>
              <tr>
                <td colSpan={4} className={`p-3 text-center ${balanced ? "text-emerald-600" : "text-amber-600"}`}>
                  {balanced ? "Trial balance is balanced" : `Out of balance by ${Math.abs(totalDebits - totalCredits).toFixed(2)}`}
                </td>
              </tr>
            </tfoot>
          </table>
          {rows.length === 0 && <p className="p-6 text-center text-slate-500">No journal entries in the selected period.</p>}
          {rows.length > 0 && rowsDisplayed.length === 0 && (
            <p className="p-6 text-center text-slate-500">
              All accounts are zero in this period (turn on &quot;Show zero-balance accounts&quot; to list every account).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
