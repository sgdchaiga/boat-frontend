import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { PageNotes } from "../common/PageNotes";

type GLAccount = { id: string; account_code: string; account_name: string; account_type: string };
type LedgerLine = {
  id: string;
  transaction_id: string | null;
  entry_date: string;
  description: string;
  debit: number;
  credit: number;
  line_description: string | null;
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
};

export function GeneralLedgerPage() {
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  useEffect(() => {
    fetchData();
  }, [dateRange, customFrom, customTo]);

  const fetchData = async () => {
    setLoading(true);
    setFetchError(null);
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const { data: entriesData, error: e1 } = await supabase
      .from("journal_entries")
      .select("id, transaction_id, entry_date, description")
      .gte("entry_date", fromStr)
      .lte("entry_date", toStr)
      .order("entry_date");

    if (e1) {
      setFetchError(e1.message);
      setLines([]);
      setLoading(false);
      return;
    }

    if (!entriesData?.length) {
      setLines([]);
      setLoading(false);
      return;
    }

    const entryIds = (entriesData as { id: string }[]).map((e) => e.id);
    const { data: linesData, error: e2 } = await supabase
      .from("journal_entry_lines")
      .select("id, journal_entry_id, gl_account_id, debit, credit, line_description")
      .in("journal_entry_id", entryIds);

    if (e2) {
      setFetchError(e2.message);
      setLines([]);
      setLoading(false);
      return;
    }

    const { data: accData, error: e3 } = await supabase
      .from("gl_accounts")
      .select("id, account_code, account_name, account_type")
      .order("account_code");

    if (e3) {
      setFetchError(e3.message);
      setLines([]);
      setLoading(false);
      return;
    }

    setAccounts((accData || []) as GLAccount[]);

    const entriesMap = Object.fromEntries((entriesData as { id: string; transaction_id: string | null; entry_date: string; description: string }[]).map((e) => [e.id, e]));
    const accMap = Object.fromEntries(((accData || []) as GLAccount[]).map((a) => [a.id, a]));

    const ledger: LedgerLine[] = (linesData || []).map((l: { id: string; journal_entry_id: string; gl_account_id: string; debit: number; credit: number; line_description: string | null }) => {
      const ent = entriesMap[l.journal_entry_id];
      const acc = accMap[l.gl_account_id];
      return {
        id: l.id,
        transaction_id: ent?.transaction_id ?? null,
        entry_date: ent?.entry_date || "",
        description: ent?.description || "",
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
        line_description: l.line_description,
        account_id: l.gl_account_id,
        account_code: acc?.account_code || "",
        account_name: acc?.account_name || "",
        account_type: acc?.account_type || "",
      };
    });

    setLines(ledger.sort((a, b) => a.account_code.localeCompare(b.account_code) || a.entry_date.localeCompare(b.entry_date)));
    setLoading(false);
  };

  const filtered = selectedAccountId ? lines.filter((l) => l.account_id === selectedAccountId) : lines;

  const byAccount = filtered.reduce((acc, line) => {
    if (!acc[line.account_id]) acc[line.account_id] = { ...line, running: 0, rows: [] };
    const bal = acc[line.account_id].running + line.debit - line.credit;
    acc[line.account_id].running = bal;
    acc[line.account_id].rows = [...(acc[line.account_id].rows || []), { ...line, balance: bal }];
    return acc;
  }, {} as Record<string, { account_code: string; account_name: string; account_type: string; running: number; rows: { transaction_id: string | null; entry_date: string; description: string; debit: number; credit: number; balance: number }[] }>);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">General Ledger</h1>
          <PageNotes ariaLabel="General ledger help">
            <p>Ledger by account from journal entries.</p>
          </PageNotes>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {fetchError}
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-6">
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
          className="border rounded-lg px-3 py-2"
        >
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
        <select
          value={selectedAccountId}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="border rounded-lg px-3 py-2 min-w-[200px]"
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.account_code} – {a.account_name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="space-y-8">
          {Object.entries(byAccount).map(([accountId, { account_code, account_name, account_type, running, rows }]) => (
            <div key={accountId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b font-medium">
                {account_code} – {account_name} <span className="text-slate-500 capitalize">({account_type})</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="p-2 text-left">Transaction ID</th>
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-right">Debit</th>
                    <th className="p-2 text-right">Credit</th>
                    <th className="p-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 font-mono text-slate-600">{r.transaction_id ?? "—"}</td>
                      <td className="p-2">{r.entry_date}</td>
                      <td className="p-2">{r.description}</td>
                      <td className="p-2 text-right">{r.debit > 0 ? r.debit.toFixed(2) : ""}</td>
                      <td className="p-2 text-right">{r.credit > 0 ? r.credit.toFixed(2) : ""}</td>
                      <td className="p-2 text-right font-medium">{r.balance.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-medium">
                    <td colSpan={5} className="p-2 text-right">Balance</td>
                    <td className="p-2 text-right">{running.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
          {Object.keys(byAccount).length === 0 && (
            <p className="text-slate-500">No journal entries in the selected period.</p>
          )}
        </div>
      )}
    </div>
  );
}
