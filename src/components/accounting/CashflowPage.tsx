import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, type DateRangeKey } from "../../lib/timezone";
import { getDefaultGlAccounts } from "../../lib/journal";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";
import {
  type GlAccountRow,
  type JournalLineRow,
  isCashEquivalentAccount,
  isReceivableAccount,
  isInventoryAccount,
  isPayableAccount,
  cumulativeBalances,
  sumAccountGroup,
  netIncomeFromLines,
  depreciationAddBackForPeriod,
  classifyEntryCashFlow,
  cashNetOnPool,
  splitDirectOperating,
  buildIndirectOperating,
  roundMoney,
} from "../../lib/cashFlowStatement";
import { downloadCsv, exportAccountingPdf, formatDrCrCell, type AccountingPdfSection } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";

type CashMovement = {
  transaction_id: string | null;
  entry_date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
};

type StatementMethod = "direct" | "indirect";

export function CashflowPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [view, setView] = useState<"statement" | "ledger">("statement");
  const [method, setMethod] = useState<StatementMethod>("indirect");
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [compareRange, setCompareRange] = useState<"none" | "previous_period" | "same_period_last_year">("none");
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [cashAccountId, setCashAccountId] = useState<string>("");
  const [accounts, setAccounts] = useState<
    { id: string; account_code: string; account_name: string; category: string | null }[]
  >([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [closingBalance, setClosingBalance] = useState(0);

  const [cashBegin, setCashBegin] = useState(0);
  const [cashEnd, setCashEnd] = useState(0);
  const [netChangeCash, setNetChangeCash] = useState(0);
  const [indirect, setIndirect] = useState<ReturnType<typeof buildIndirectOperating> | null>(null);
  const [directOps, setDirectOps] = useState({ receipts: 0, payments: 0, net: 0 });
  const [investing, setInvesting] = useState(0);
  const [financing, setFinancing] = useState(0);
  const [directOperatingNet, setDirectOperatingNet] = useState(0);
  const [reconcileDiff, setReconcileDiff] = useState(0);
  const [previousLabel, setPreviousLabel] = useState("Previous");
  const [previousCashBegin, setPreviousCashBegin] = useState(0);
  const [previousCashEnd, setPreviousCashEnd] = useState(0);
  const [previousNetChangeCash, setPreviousNetChangeCash] = useState(0);
  const [previousIndirectOperatingNet, setPreviousIndirectOperatingNet] = useState(0);
  const [previousDirectOperatingNet, setPreviousDirectOperatingNet] = useState(0);
  const [previousInvesting, setPreviousInvesting] = useState(0);
  const [previousFinancing, setPreviousFinancing] = useState(0);

  const fetchLedger = useCallback(async () => {
    if (!cashAccountId) return;
    if (!orgId && !superAdmin) {
      setQueryError("Missing organization on your staff profile. Contact admin to link your account.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setQueryError(null);
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const { data: entriesBefore, error: eBefore } = await filterByOrganizationId(
      supabase
        .from("journal_entries")
        .select("id")
        .lt("entry_date", fromStr)
        .eq("is_posted", true),
      orgId,
      superAdmin
    );
    if (eBefore) {
      setQueryError(eBefore.message);
      setLoading(false);
      return;
    }
    const entryIdsBefore = (entriesBefore || []).map((e: { id: string }) => e.id);

    let opening = 0;
    if (entryIdsBefore.length > 0) {
      const { data: linesBefore, error: eOpen } = await supabase
        .from("journal_entry_lines")
        .select("debit, credit")
        .eq("gl_account_id", cashAccountId)
        .in("journal_entry_id", entryIdsBefore);
      if (eOpen) {
        setQueryError(eOpen.message);
        setLoading(false);
        return;
      }
      (linesBefore || []).forEach((l: { debit: number; credit: number }) => {
        opening += Number(l.debit) || 0;
        opening -= Number(l.credit) || 0;
      });
    }

    const { data: entriesData, error: eEnt } = await filterByOrganizationId(
      supabase
        .from("journal_entries")
        .select("id, transaction_id, entry_date, description")
        .gte("entry_date", fromStr)
        .lte("entry_date", toStr)
        .eq("is_posted", true)
        .order("entry_date"),
      orgId,
      superAdmin
    );

    if (eEnt) {
      setQueryError(eEnt.message);
      setLoading(false);
      return;
    }

    const entryIds = (entriesData || []).map((e: { id: string }) => e.id);
    if (entryIds.length === 0) {
      setMovements([]);
      setOpeningBalance(opening);
      setClosingBalance(opening);
      setLoading(false);
      return;
    }

    const { data: linesData, error: eLines } = await supabase
      .from("journal_entry_lines")
      .select("journal_entry_id, debit, credit")
      .eq("gl_account_id", cashAccountId)
      .in("journal_entry_id", entryIds);

    if (eLines) {
      setQueryError(eLines.message);
      setLoading(false);
      return;
    }

    const linesByEntry: Record<string, { debit: number; credit: number }> = {};
    (linesData || []).forEach((l: { journal_entry_id: string; debit: number; credit: number }) => {
      if (!linesByEntry[l.journal_entry_id]) linesByEntry[l.journal_entry_id] = { debit: 0, credit: 0 };
      linesByEntry[l.journal_entry_id].debit += Number(l.debit) || 0;
      linesByEntry[l.journal_entry_id].credit += Number(l.credit) || 0;
    });

    let running = opening;
    const mov: CashMovement[] = [];
    (entriesData as { id: string; transaction_id: string | null; entry_date: string; description: string }[])
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
      .forEach((e) => {
        const l = linesByEntry[e.id];
        if (!l) return;
        const debit = l.debit,
          credit = l.credit;
        running += debit - credit;
        mov.push({
          transaction_id: e.transaction_id,
          entry_date: e.entry_date,
          description: e.description,
          debit,
          credit,
          balance: running,
        });
      });

    setMovements(mov);
    setOpeningBalance(opening);
    setClosingBalance(running);
    setLoading(false);
  }, [cashAccountId, dateRange, customFrom, customTo, orgId, superAdmin]);

  const fetchAccountsForLedger = useCallback(async () => {
    if (!orgId && !superAdmin) {
      setQueryError("Missing organization on your staff profile. Contact admin to link your account.");
      setLoading(false);
      return;
    }
    const { data, error } = await filterByOrganizationId(
      supabase
        .from("gl_accounts")
        .select("*")
        .eq("account_type", "asset")
        .order("account_code"),
      orgId,
      superAdmin
    );

    if (error) {
      setQueryError(error.message);
      setLoading(false);
      return;
    }

    const rows = normalizeGlAccountRows((data || []) as unknown[])
      .filter((row) => row.is_active && row.account_type === "asset")
      .map((row) => ({
        id: row.id,
        account_code: row.account_code,
        account_name: row.account_name,
        category: row.category,
      }));
    setAccounts(rows);

    const defaults = await getDefaultGlAccounts();
    let pick = "";
    if (defaults.cash && rows.some((r) => r.id === defaults.cash)) {
      pick = defaults.cash;
    } else {
      const cashish = rows.find((r) => (r.category || "").toLowerCase().includes("cash"));
      pick = cashish?.id ?? rows[0]?.id ?? "";
    }

    setCashAccountId((prev) => prev || pick);
    if (!pick) setLoading(false);
  }, [orgId, superAdmin]);

  const fetchStatement = useCallback(async () => {
    if (!orgId && !superAdmin) {
      setQueryError("Missing organization on your staff profile. Contact admin to link your account.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setQueryError(null);
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const { data: accData, error: eAcc } = await filterByOrganizationId(
      supabase
        .from("gl_accounts")
        .select("*"),
      orgId,
      superAdmin
    );

    if (eAcc) {
      setQueryError(eAcc.message);
      setLoading(false);
      return;
    }

    const allAccounts = normalizeGlAccountRows((accData || []) as unknown[])
      .filter((row) => row.is_active)
      .map((row) => ({
        id: row.id,
        account_code: row.account_code,
        account_name: row.account_name,
        account_type: row.account_type,
        category: row.category,
      })) as GlAccountRow[];
    const accMap = Object.fromEntries(allAccounts.map((a) => [a.id, a]));

    const defaults = await getDefaultGlAccounts();
    const cashPoolIds = new Set<string>();
    for (const a of allAccounts) {
      if (isCashEquivalentAccount(a)) cashPoolIds.add(a.id);
    }
    for (const id of [defaults.cash, defaults.posBank, defaults.posMtnMobileMoney, defaults.posAirtelMoney]) {
      if (id && allAccounts.some((a) => a.id === id)) cashPoolIds.add(id);
    }
    if (cashPoolIds.size === 0) {
      setQueryError("No cash-equivalent GL accounts found. Use category “cash” or names like Bank / Mobile money.");
      setLoading(false);
      return;
    }

    const fetchLinesForEntries = async (entryIds: string[]) => {
      if (entryIds.length === 0) return [] as JournalLineRow[];
      const { data, error } = await supabase
        .from("journal_entry_lines")
        .select("gl_account_id, debit, credit, journal_entry_id")
        .in("journal_entry_id", entryIds);
      if (error) throw new Error(error.message);
      return (data || []) as (JournalLineRow & { journal_entry_id: string })[];
    };

    const fetchEntryIds = async (cond: { lt?: string; lte?: string; gte?: string }) => {
      let q = filterByOrganizationId(supabase.from("journal_entries").select("id"), orgId, superAdmin);
      if (cond.lt) q = q.lt("entry_date", cond.lt);
      if (cond.lte) q = q.lte("entry_date", cond.lte);
      if (cond.gte) q = q.gte("entry_date", cond.gte);
      q = q.eq("is_posted", true);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ((data || []) as { id: string }[]).map((e) => e.id);
    };

    const computeStatementForRange = async (rangeFrom: string, rangeTo: string) => {
      const idsBeforeFrom = await fetchEntryIds({ lt: rangeFrom });
      const idsThroughEnd = await fetchEntryIds({ lte: rangeTo });
      const periodEntryIds = await fetchEntryIds({ gte: rangeFrom, lte: rangeTo });

      const linesBeforeFrom = await fetchLinesForEntries(idsBeforeFrom);
      const linesThroughEnd = await fetchLinesForEntries(idsThroughEnd);
      const linesPeriod = await fetchLinesForEntries(periodEntryIds);

      const { data: entriesPeriodMeta, error: eMeta } = await filterByOrganizationId(
        supabase
          .from("journal_entries")
          .select("id, reference_type, description, entry_date")
          .gte("entry_date", rangeFrom)
          .lte("entry_date", rangeTo)
          .eq("is_posted", true),
        orgId,
        superAdmin
      );
      if (eMeta) throw new Error(eMeta.message);

      const balBeginWC = cumulativeBalances(allAccounts, linesBeforeFrom);
      const balEndWC = cumulativeBalances(allAccounts, linesThroughEnd);

      const arBegin = sumAccountGroup(balBeginWC, allAccounts, isReceivableAccount);
      const arEnd = sumAccountGroup(balEndWC, allAccounts, isReceivableAccount);
      const invBegin = sumAccountGroup(balBeginWC, allAccounts, isInventoryAccount);
      const invEnd = sumAccountGroup(balEndWC, allAccounts, isInventoryAccount);
      const apBegin = sumAccountGroup(balBeginWC, allAccounts, isPayableAccount);
      const apEnd = sumAccountGroup(balEndWC, allAccounts, isPayableAccount);

      const balBeginCash = cumulativeBalances(allAccounts, linesBeforeFrom);
      const balEndCash = cumulativeBalances(allAccounts, linesThroughEnd);
      let cb = 0;
      let ce = 0;
      for (const id of cashPoolIds) {
        cb += balBeginCash[id] ?? 0;
        ce += balEndCash[id] ?? 0;
      }
      cb = roundMoney(cb);
      ce = roundMoney(ce);

      const incomeExpenseAccounts = allAccounts.filter((a) => a.account_type === "income" || a.account_type === "expense");
      const ieMap = Object.fromEntries(incomeExpenseAccounts.map((a) => [a.id, a]));
      const periodIELines = linesPeriod.filter((l) => ieMap[l.gl_account_id]);
      const ni = netIncomeFromLines(incomeExpenseAccounts, periodIELines);
      const dep = depreciationAddBackForPeriod(allAccounts, linesPeriod);

      const indirectResult = buildIndirectOperating(ni.netIncome, dep, arBegin, arEnd, invBegin, invEnd, apBegin, apEnd);

      const linesByEntryId: Record<string, JournalLineRow[]> = {};
      for (const l of linesPeriod) {
        const je = (l as JournalLineRow & { journal_entry_id: string }).journal_entry_id;
        if (!linesByEntryId[je]) linesByEntryId[je] = [];
        linesByEntryId[je].push({
          gl_account_id: l.gl_account_id,
          debit: l.debit,
          credit: l.credit,
        });
      }

      let inv = 0;
      let fin = 0;
      let receipts = 0;
      let payments = 0;

      for (const e of (entriesPeriodMeta || []) as {
        id: string;
        reference_type: string | null;
        description: string;
        entry_date: string;
      }[]) {
        const ls = linesByEntryId[e.id];
        if (!ls) continue;
        const cashNet = cashNetOnPool(ls, cashPoolIds);
        if (Math.abs(cashNet) < 0.005) continue;

        const cat = classifyEntryCashFlow(ls, accMap, cashPoolIds);
        if (cat === "investing") inv += cashNet;
        else if (cat === "financing") fin += cashNet;
        else {
          const split = splitDirectOperating(cashNet, ls, accMap, cashPoolIds);
          receipts += split.receiptsFromCustomers;
          payments += split.paymentsOperating;
        }
      }

      const directOpNet = roundMoney(receipts - payments);
      inv = roundMoney(inv);
      fin = roundMoney(fin);
      receipts = roundMoney(receipts);
      payments = roundMoney(payments);

      const netChange = roundMoney(ce - cb);
      const classified = roundMoney(directOpNet + inv + fin);
      const diff = roundMoney(netChange - classified);

      return {
        cashBegin: cb,
        cashEnd: ce,
        netChangeCash: netChange,
        indirectResult,
        directOps: { receipts, payments, net: directOpNet },
        investing: inv,
        financing: fin,
        directOperatingNet: directOpNet,
        reconcileDiff: diff,
      };
    };

    try {
      const current = await computeStatementForRange(fromStr, toStr);
      setCashBegin(current.cashBegin);
      setCashEnd(current.cashEnd);
      setNetChangeCash(current.netChangeCash);
      setIndirect(current.indirectResult);
      setDirectOps(current.directOps);
      setInvesting(current.investing);
      setFinancing(current.financing);
      setDirectOperatingNet(current.directOperatingNet);
      setReconcileDiff(current.reconcileDiff);

      if (compareRange === "none") {
        setPreviousLabel("Previous");
        setPreviousCashBegin(0);
        setPreviousCashEnd(0);
        setPreviousNetChangeCash(0);
        setPreviousIndirectOperatingNet(0);
        setPreviousDirectOperatingNet(0);
        setPreviousInvesting(0);
        setPreviousFinancing(0);
      } else {
        const msPerDay = 24 * 60 * 60 * 1000;
        const currentFrom = new Date(`${fromStr}T00:00:00`);
        const currentTo = new Date(`${toStr}T00:00:00`);
        let prevFrom = new Date(currentFrom);
        let prevTo = new Date(currentTo);
        if (compareRange === "previous_period") {
          const daySpan = Math.floor((currentTo.getTime() - currentFrom.getTime()) / msPerDay) + 1;
          prevFrom = new Date(currentFrom.getTime() - daySpan * msPerDay);
          prevTo = new Date(currentTo.getTime() - daySpan * msPerDay);
          setPreviousLabel("Previous period");
        } else {
          prevFrom.setFullYear(prevFrom.getFullYear() - 1);
          prevTo.setFullYear(prevTo.getFullYear() - 1);
          setPreviousLabel("Same period last year");
        }

        const previous = await computeStatementForRange(
          prevFrom.toISOString().slice(0, 10),
          prevTo.toISOString().slice(0, 10)
        );
        setPreviousCashBegin(previous.cashBegin);
        setPreviousCashEnd(previous.cashEnd);
        setPreviousNetChangeCash(previous.netChangeCash);
        setPreviousIndirectOperatingNet(previous.indirectResult.netCashOperatingIndirect);
        setPreviousDirectOperatingNet(previous.directOperatingNet);
        setPreviousInvesting(previous.investing);
        setPreviousFinancing(previous.financing);
      }
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dateRange, customFrom, customTo, orgId, superAdmin, compareRange]);

  useEffect(() => {
    fetchAccountsForLedger();
  }, [fetchAccountsForLedger]);

  useEffect(() => {
    if (view === "ledger" && cashAccountId) fetchLedger();
  }, [view, cashAccountId, fetchLedger]);

  useEffect(() => {
    if (view === "statement") fetchStatement();
  }, [view, fetchStatement]);

  const periodLabel = useMemo(() => {
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    return `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`;
  }, [dateRange, customFrom, customTo]);

  const fileStamp = useMemo(() => computeRangeInTimezone(dateRange, customFrom, customTo).to.toISOString().slice(0, 10), [dateRange, customFrom, customTo]);

  const exportStatementExcel = () => {
    const rows: (string | number)[][] = [
      ["Statement of cash flows", periodLabel],
      [`Operating section shown: ${method === "indirect" ? "Indirect" : "Direct"}`],
      [],
      ["Cash position (pool)"],
      ["Cash at beginning of period", cashBegin.toFixed(2)],
      ["Cash at end of period", cashEnd.toFixed(2)],
      ["Net increase (decrease) in cash", netChangeCash.toFixed(2)],
      [],
    ];
    if (method === "indirect" && indirect) {
      rows.push(
        ["Operating activities (indirect)"],
        ["Net income", indirect.netIncome.toFixed(2)],
        ["Add: Depreciation & amortization", indirect.depreciationAddBack.toFixed(2)],
        ["Change in accounts receivable (adjustment)", (-indirect.deltaReceivables).toFixed(2)],
        ["Change in inventory (adjustment)", (-indirect.deltaInventory).toFixed(2)],
        ["Change in accounts payable", indirect.deltaPayables.toFixed(2)],
        ["Net cash from operating activities", indirect.netCashOperatingIndirect.toFixed(2)],
        []
      );
    }
    if (method === "direct") {
      rows.push(
        ["Operating activities (direct)"],
        ["Cash received from customers", directOps.receipts.toFixed(2)],
        ["Cash paid (suppliers, inventory, expenses)", directOps.payments.toFixed(2)],
        ["Net cash from operating activities", directOperatingNet.toFixed(2)],
        []
      );
    }
    rows.push(
      ["Investing & financing"],
      ["Net cash from investing", investing.toFixed(2)],
      ["Net cash from financing", financing.toFixed(2)],
      []
    );
    if (Math.abs(reconcileDiff) >= 0.02) {
      rows.push(["Reconciliation difference", reconcileDiff.toFixed(2)]);
    }
    downloadCsv(`cash-flow-statement-${fileStamp}.csv`, rows);
  };

  const exportStatementPdf = () => {
    const sections: AccountingPdfSection[] = [
      {
        title: "Cash position (pool)",
        head: ["Description", "Amount"],
        body: [
          ["Cash at beginning of period", cashBegin.toFixed(2)],
          ["Cash at end of period", cashEnd.toFixed(2)],
          ["Net increase (decrease) in cash", netChangeCash.toFixed(2)],
        ],
      },
    ];
    if (method === "indirect" && indirect) {
      sections.push({
        title: "Operating activities (indirect)",
        head: ["Line", "Amount"],
        body: [
          ["Net income", indirect.netIncome.toFixed(2)],
          ["Add: Depreciation & amortization", indirect.depreciationAddBack.toFixed(2)],
          ["Change in accounts receivable", (-indirect.deltaReceivables).toFixed(2)],
          ["Change in inventory", (-indirect.deltaInventory).toFixed(2)],
          ["Change in accounts payable", indirect.deltaPayables.toFixed(2)],
          ["Net cash from operating activities", indirect.netCashOperatingIndirect.toFixed(2)],
        ],
      });
    }
    if (method === "direct") {
      sections.push({
        title: "Operating activities (direct)",
        head: ["Line", "Amount"],
        body: [
          ["Cash received from customers", directOps.receipts.toFixed(2)],
          ["Cash paid (suppliers, inventory, expenses)", directOps.payments.toFixed(2)],
          ["Net cash from operating activities", directOperatingNet.toFixed(2)],
        ],
      });
    }
    sections.push({
      title: "Investing & financing",
      head: ["Line", "Amount"],
      body: [
        ["Net cash from investing activities", investing.toFixed(2)],
        ["Net cash from financing activities", financing.toFixed(2)],
      ],
    });
    const footerLines: string[] = [];
    if (Math.abs(reconcileDiff) >= 0.02) {
      footerLines.push(`Reconciliation difference: ${reconcileDiff.toFixed(2)}`);
    }
    exportAccountingPdf({
      title: "Statement of cash flows",
      subtitle: `${periodLabel} · Operating: ${method === "indirect" ? "Indirect" : "Direct"}`,
      filename: `cash-flow-statement-${fileStamp}.pdf`,
      sections,
      footerLines: footerLines.length ? footerLines : undefined,
    });
  };

  const exportLedgerExcel = () => {
    const acct = accounts.find((a) => a.id === cashAccountId);
    const acctLabel = acct ? `${acct.account_code} ${acct.account_name}` : "";
    const rows: (string | number)[][] = [
      ["Cash account ledger", periodLabel, acctLabel],
      ["Opening balance", openingBalance.toFixed(2)],
      [],
      ["Transaction ID", "Date", "Description", "In", "Out", "Balance"],
      ...movements.map((m) => [
        m.transaction_id ?? "",
        m.entry_date,
        m.description,
        formatDrCrCell(m.debit),
        formatDrCrCell(m.credit),
        m.balance.toFixed(2),
      ]),
      [],
      ["Closing balance", closingBalance.toFixed(2)],
    ];
    downloadCsv(`cash-flow-ledger-${fileStamp}.csv`, rows);
  };

  const exportLedgerPdf = () => {
    const acct = accounts.find((a) => a.id === cashAccountId);
    const acctLabel = acct ? `${acct.account_code} – ${acct.account_name}` : "Cash account";
    exportAccountingPdf({
      title: "Cash account ledger",
      subtitle: `${periodLabel} · ${acctLabel}`,
      filename: `cash-flow-ledger-${fileStamp}.pdf`,
      sections: [
        {
          title: "Movements",
          head: ["Transaction ID", "Date", "Description", "In", "Out", "Balance"],
          body: movements.map((m) => [
            m.transaction_id ?? "—",
            m.entry_date,
            m.description,
            formatDrCrCell(m.debit),
            formatDrCrCell(m.credit),
            m.balance.toFixed(2),
          ]),
        },
      ],
      footerLines: [`Opening: ${openingBalance.toFixed(2)}  Closing: ${closingBalance.toFixed(2)}`],
    });
  };

  const exportDisabled = loading || !!queryError || (view === "ledger" && !cashAccountId);

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Cash Flow</h1>
          <PageNotes ariaLabel="Cash flow help">
            <p>
              <strong>Statement of cash flows</strong> (direct or indirect operating section) plus optional <strong>cash account ledger</strong>.
              Cash pool includes GL accounts flagged as cash equivalents (category &quot;cash&quot;, bank, mobile money) and journal default
              cash/bank/mobile accounts.
            </p>
          </PageNotes>
        </div>
      </div>

      {queryError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {queryError}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-100">
          <button
            type="button"
            onClick={() => setView("statement")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${view === "statement" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
          >
            Statement
          </button>
          <button
            type="button"
            onClick={() => setView("ledger")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${view === "ledger" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
          >
            Account ledger
          </button>
        </div>
        {view === "statement" && (
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-100">
            <button
              type="button"
              onClick={() => setMethod("indirect")}
              className={`px-4 py-2 rounded-md text-sm font-medium ${method === "indirect" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
            >
              Indirect (operating)
            </button>
            <button
              type="button"
              onClick={() => setMethod("direct")}
              className={`px-4 py-2 rounded-md text-sm font-medium ${method === "direct" ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
            >
              Direct (operating)
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
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
          {view === "statement" && (
            <select
              value={compareRange}
              onChange={(e) => setCompareRange(e.target.value as "none" | "previous_period" | "same_period_last_year")}
              className="border rounded-lg px-3 py-2"
            >
              <option value="none">No comparison</option>
              <option value="previous_period">Compare with previous period</option>
              <option value="same_period_last_year">Compare with same period last year</option>
            </select>
          )}
          {view === "ledger" && (
            <select
              value={cashAccountId}
              onChange={(e) => setCashAccountId(e.target.value)}
              className="border rounded-lg px-3 py-2 min-w-[200px]"
            >
              <option value="">Select cash account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} – {a.account_name}
                </option>
              ))}
            </select>
          )}
        </div>
        <AccountingExportButtons
          onExcel={view === "ledger" ? exportLedgerExcel : exportStatementExcel}
          onPdf={view === "ledger" ? exportLedgerPdf : exportStatementPdf}
          disabled={exportDisabled}
        />
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : view === "ledger" ? (
        !cashAccountId ? (
          <p className="text-slate-500">No asset accounts found.</p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-3xl">
            <div className="p-4 border-b bg-slate-50 flex justify-between">
              <span className="font-medium">Opening balance</span>
              <span>{openingBalance.toFixed(2)}</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="p-2 text-left">Transaction ID</th>
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Description</th>
                  <th className="p-2 text-right">In</th>
                  <th className="p-2 text-right">Out</th>
                  <th className="p-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-mono text-slate-600">{m.transaction_id ?? "—"}</td>
                    <td className="p-2">{m.entry_date}</td>
                    <td className="p-2">{m.description}</td>
                    <td className="p-2 text-right">{formatDrCrCell(m.debit)}</td>
                    <td className="p-2 text-right">{formatDrCrCell(m.credit)}</td>
                    <td className="p-2 text-right font-medium">{m.balance.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {movements.length === 0 && (
              <p className="p-4 text-sm text-slate-500">No movements in this period for the selected account.</p>
            )}
            <div className="p-4 border-t bg-slate-50 flex justify-between font-medium">
              <span>Closing balance</span>
              <span>{closingBalance.toFixed(2)}</span>
            </div>
          </div>
        )
      ) : (
        <div className={`grid grid-cols-1 gap-6 items-start ${compareRange !== "none" ? "xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]" : ""}`}>
          <div className="space-y-6 max-w-2xl">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b bg-slate-50 font-medium">Cash position (pool)</div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t">
                  <td className="p-3">Cash at beginning of period</td>
                  <td className="p-3 text-right font-mono">{cashBegin.toFixed(2)}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-3">Cash at end of period</td>
                  <td className="p-3 text-right font-mono">{cashEnd.toFixed(2)}</td>
                </tr>
                <tr className="border-t bg-slate-50 font-medium">
                  <td className="p-3">Net increase (decrease) in cash</td>
                  <td className="p-3 text-right font-mono">{netChangeCash.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {method === "indirect" && indirect && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 border-b bg-slate-50 font-medium">Cash flows from operating activities (indirect method)</div>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-t">
                    <td className="p-3">Net income</td>
                    <td className="p-3 text-right font-mono">{indirect.netIncome.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Add: Depreciation &amp; amortization (non-cash)</td>
                    <td className="p-3 text-right font-mono">{indirect.depreciationAddBack.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Change in accounts receivable</td>
                    <td className="p-3 text-right font-mono">{(-indirect.deltaReceivables).toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Change in inventory</td>
                    <td className="p-3 text-right font-mono">{(-indirect.deltaInventory).toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Change in accounts payable</td>
                    <td className="p-3 text-right font-mono">{indirect.deltaPayables.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t bg-emerald-50 font-medium">
                    <td className="p-3">Net cash from operating activities</td>
                    <td className="p-3 text-right font-mono">{indirect.netCashOperatingIndirect.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="p-3 text-xs text-slate-500 border-t">
                Working capital uses receivable, inventory, and payable accounts (by category/name). Increase in receivables or
                inventory reduces operating cash; increase in payables adds to it.
              </p>
            </div>
          )}

          {method === "direct" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="p-4 border-b bg-slate-50 font-medium">Cash flows from operating activities (direct method)</div>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-t">
                    <td className="p-3">Cash received from customers (and similar)</td>
                    <td className="p-3 text-right font-mono">{directOps.receipts.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Cash paid to suppliers, for inventory, and operating expenses</td>
                    <td className="p-3 text-right font-mono">({directOps.payments.toFixed(2)})</td>
                  </tr>
                  <tr className="border-t bg-emerald-50 font-medium">
                    <td className="p-3">Net cash from operating activities</td>
                    <td className="p-3 text-right font-mono">{directOperatingNet.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b bg-slate-50 font-medium">Investing &amp; financing (both methods)</div>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t">
                  <td className="p-3">Net cash from investing activities</td>
                  <td className="p-3 text-right font-mono">{investing.toFixed(2)}</td>
                </tr>
                <tr className="border-t">
                  <td className="p-3">Net cash from financing activities</td>
                  <td className="p-3 text-right font-mono">{financing.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
            <p className="p-3 text-xs text-slate-500 border-t">
              Investing: fixed-asset style accounts. Financing: equity and non–trade payables liabilities. Everything else defaults
              to operating.
            </p>
          </div>

          {Math.abs(reconcileDiff) >= 0.02 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>Reconciliation:</strong> Classified operating + investing + financing ({(directOperatingNet + investing + financing).toFixed(2)}) vs
              actual change in cash pool ({netChangeCash.toFixed(2)}). Difference: {reconcileDiff.toFixed(2)}. Mixed journal lines or
              unclassified entries may cause this.
            </div>
          )}
          </div>
          {compareRange !== "none" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl xl:max-w-none">
              <div className="p-4 border-b bg-slate-50 font-medium">Comparison ({previousLabel})</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Metric</th>
                    <th className="p-3 text-right">Current</th>
                    <th className="p-3 text-right">{previousLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="p-3">Cash at beginning of period</td>
                    <td className="p-3 text-right font-mono">{cashBegin.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">{previousCashBegin.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Cash at end of period</td>
                    <td className="p-3 text-right font-mono">{cashEnd.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">{previousCashEnd.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t font-medium bg-slate-50">
                    <td className="p-3">Net increase (decrease) in cash</td>
                    <td className="p-3 text-right font-mono">{netChangeCash.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">{previousNetChangeCash.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">
                      Net cash from operating activities ({method === "indirect" ? "indirect" : "direct"})
                    </td>
                    <td className="p-3 text-right font-mono">
                      {(method === "indirect" ? indirect?.netCashOperatingIndirect ?? 0 : directOperatingNet).toFixed(2)}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {(method === "indirect" ? previousIndirectOperatingNet : previousDirectOperatingNet).toFixed(2)}
                    </td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Net cash from investing activities</td>
                    <td className="p-3 text-right font-mono">{investing.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">{previousInvesting.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="p-3">Net cash from financing activities</td>
                    <td className="p-3 text-right font-mono">{financing.toFixed(2)}</td>
                    <td className="p-3 text-right font-mono">{previousFinancing.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
