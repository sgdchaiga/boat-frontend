import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { computeRangeInTimezone, toBusinessDateString, type DateRangeKey } from "../../lib/timezone";
import { downloadXlsx, exportAccountingPdf, formatCurrency, isNonZeroGlAmount } from "../../lib/accountingReportExport";
import { AccountingExportButtons } from "./AccountingExportButtons";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import type { BusinessType } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "../../lib/supabaseOrgFilter";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";
import {
  type AccountTotal,
  type IncomeStatementMode,
  type SaccoStatementNumbers,
  buildSaccoStatement,
  classifyManufacturingExpenseRow,
  classifyRetailExpenseRow,
  getIncomeStatementMode,
} from "../../lib/incomeStatementLayout";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Info } from "lucide-react";

type TrendPoint = { period: string; revenue: number; expenses: number };
type ExpenseSlice = { name: string; value: number };
type DrillLine = {
  id: string;
  entry_date: string;
  description: string;
  transaction_id: string | null;
  reference_type: string | null;
  debit: number;
  credit: number;
  line_description: string | null;
};
type TotalsSnapshot = {
  mode: IncomeStatementMode;
  revenueRows: AccountTotal[];
  expenseRows: AccountTotal[];
  cogsRows: AccountTotal[];
  opexRows: AccountTotal[];
  totalRevenue: number;
  totalCogs: number;
  totalOpex: number;
  totalExpenses: number;
  sacco: SaccoStatementNumbers | null;
  branches: string[];
  trend: TrendPoint[];
  expenseBreakdown: ExpenseSlice[];
};

const CASH_BASIS_REFERENCE_TYPES = ["payment", "pos", "vendor_payment", "expense", "school_payment"] as const;

export function IncomeStatementPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [dateRange, setDateRange] = useState<DateRangeKey>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [debouncedCustomFrom, setDebouncedCustomFrom] = useState("");
  const [debouncedCustomTo, setDebouncedCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [statementMode, setStatementMode] = useState<IncomeStatementMode>("retail");
  const [revenue, setRevenue] = useState<AccountTotal[]>([]);
  const [expenses, setExpenses] = useState<AccountTotal[]>([]);
  const [cogsRows, setCogsRows] = useState<AccountTotal[]>([]);
  const [opexRows, setOpexRows] = useState<AccountTotal[]>([]);
  const [saccoSummary, setSaccoSummary] = useState<SaccoStatementNumbers | null>(null);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalCogs, setTotalCogs] = useState(0);
  const [totalOpex, setTotalOpex] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [compareRange, setCompareRange] = useState<"none" | "previous_period" | "same_period_last_year">("none");
  const [basis, setBasis] = useState<"accrual" | "cash">("accrual");
  const [showBasisHelp, setShowBasisHelp] = useState(false);
  const [previousTotalRevenue, setPreviousTotalRevenue] = useState(0);
  const [previousTotalExpenses, setPreviousTotalExpenses] = useState(0);
  const [previousTotalCogs, setPreviousTotalCogs] = useState(0);
  const [previousTotalOpex, setPreviousTotalOpex] = useState(0);
  const [previousRevenueRows, setPreviousRevenueRows] = useState<AccountTotal[]>([]);
  const [previousExpenseRows, setPreviousExpenseRows] = useState<AccountTotal[]>([]);
  const [previousCogsRows, setPreviousCogsRows] = useState<AccountTotal[]>([]);
  const [previousOpexRows, setPreviousOpexRows] = useState<AccountTotal[]>([]);
  const [previousSacco, setPreviousSacco] = useState<SaccoStatementNumbers | null>(null);
  const [previousLabel, setPreviousLabel] = useState("Previous");
  const [companyName, setCompanyName] = useState("Business");
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState<ExpenseSlice[]>([]);
  const [drillAccount, setDrillAccount] = useState<{ id: string; code: string; name: string; type: "income" | "expense" } | null>(null);
  const [drillRows, setDrillRows] = useState<DrillLine[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);
  /** When false, account rows with a net zero amount for the period are hidden (totals unchanged). */
  const [showZeroBalanceAccounts, setShowZeroBalanceAccounts] = useState(true);
  /** SACCO structured P&L only: when true, computed summary lines with a zero amount are hidden. */
  const [hideSaccoZeroSummaryLines, setHideSaccoZeroSummaryLines] = useState(false);
  const totalsCacheRef = useRef<Map<string, TotalsSnapshot>>(new Map());
  const requestSeqRef = useRef(0);

  const revenueDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? revenue : revenue.filter((r) => isNonZeroGlAmount(r.total))),
    [revenue, showZeroBalanceAccounts]
  );
  const expensesDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? expenses : expenses.filter((e) => isNonZeroGlAmount(e.total))),
    [expenses, showZeroBalanceAccounts]
  );
  const cogsDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? cogsRows : cogsRows.filter((r) => isNonZeroGlAmount(r.total))),
    [cogsRows, showZeroBalanceAccounts]
  );
  const opexDisplayed = useMemo(
    () => (showZeroBalanceAccounts ? opexRows : opexRows.filter((r) => isNonZeroGlAmount(r.total))),
    [opexRows, showZeroBalanceAccounts]
  );

  type SaccoSummaryLine = [label: string, amount: number, bold?: boolean];
  const saccoSummaryIncomeLines = useMemo((): SaccoSummaryLine[] => {
    if (!saccoSummary) return [];
    return [
      ["Interest income", saccoSummary.interestIncome],
      ["Interest expense", saccoSummary.interestExpense],
      ["Less: Loan loss provision", saccoSummary.loanLossProvision],
      ["Net interest income", saccoSummary.netInterestIncome, true],
      ["Fee and commission income", saccoSummary.feeCommissionIncome],
      ["Fee and commission expenses", saccoSummary.feeCommissionExpense],
      ["Other income", saccoSummary.otherIncome],
      ["Total income", saccoSummary.totalIncome, true],
    ];
  }, [saccoSummary]);

  const saccoSummaryExpenditureLines = useMemo((): SaccoSummaryLine[] => {
    if (!saccoSummary) return [];
    return [
      ["Personnel expenses", saccoSummary.personnel],
      ["Administration expenses", saccoSummary.administration],
      ["Finance expenses", saccoSummary.finance],
      ["Total expenses", saccoSummary.totalExpenditure, true],
      ["Profit before income tax", saccoSummary.profitBeforeTax, true],
      ["Income tax expense", saccoSummary.incomeTax],
      ["Profit for the year", saccoSummary.profitForYear, true],
    ];
  }, [saccoSummary]);

  const saccoIncomeLinesDisplayed = useMemo(() => {
    if (!hideSaccoZeroSummaryLines) return saccoSummaryIncomeLines;
    return saccoSummaryIncomeLines.filter((r) => isNonZeroGlAmount(r[1]));
  }, [saccoSummaryIncomeLines, hideSaccoZeroSummaryLines]);

  const saccoExpenditureLinesDisplayed = useMemo(() => {
    if (!hideSaccoZeroSummaryLines) return saccoSummaryExpenditureLines;
    return saccoSummaryExpenditureLines.filter((r) => isNonZeroGlAmount(r[1]));
  }, [saccoSummaryExpenditureLines, hideSaccoZeroSummaryLines]);

  useEffect(() => {
    fetchData();
  }, [dateRange, debouncedCustomFrom, debouncedCustomTo, compareRange, basis, user?.business_type]);

  useEffect(() => {
    if (dateRange !== "custom") {
      setDebouncedCustomFrom(customFrom);
      setDebouncedCustomTo(customTo);
      return;
    }
    const t = window.setTimeout(() => {
      setDebouncedCustomFrom(customFrom);
      setDebouncedCustomTo(customTo);
    }, 350);
    return () => window.clearTimeout(t);
  }, [dateRange, customFrom, customTo]);

  useEffect(() => {
    if (!orgId) {
      setCompanyName("Business");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      if (cancelled) return;
      const name = (data as { name?: string } | null)?.name?.trim();
      setCompanyName(name || "Business");
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const resetData = () => {
    setRevenue([]);
    setExpenses([]);
    setCogsRows([]);
    setOpexRows([]);
    setSaccoSummary(null);
    setTotalRevenue(0);
    setTotalCogs(0);
    setTotalOpex(0);
    setTotalExpenses(0);
  };

  const fetchData = async () => {
    const requestSeq = ++requestSeqRef.current;
    setLoading(true);
    setFetchError(null);
    const effectiveCustomFrom = dateRange === "custom" ? debouncedCustomFrom : customFrom;
    const effectiveCustomTo = dateRange === "custom" ? debouncedCustomTo : customTo;
    const { from, to } = computeRangeInTimezone(dateRange, effectiveCustomFrom, effectiveCustomTo);
    /** Journal `entry_date` is a business calendar date; use Kampala YYYY-MM-DD, not UTC `.slice(0,10)` from ISO (off-by-one vs EAT). */
    const fromStr = toBusinessDateString(from);
    const toStrInclusive = toBusinessDateString(new Date(to.getTime() - 1));

    if (!orgId && !superAdmin) {
      setFetchError("Missing organization on your staff profile. Contact admin to link your account.");
      resetData();
      setLoading(false);
      return;
    }

    const fetchTotalsForRange = async (fromDate: string, toDateInclusive: string, businessType: BusinessType | null | undefined) => {
      const mode = getIncomeStatementMode(businessType);
      const cacheKey = [orgId || "platform", superAdmin ? "super" : "tenant", fromDate, toDateInclusive, mode, basis].join("|");
      const cached = totalsCacheRef.current.get(cacheKey);
      if (cached) return cached;

      const linesQuery = supabase
        .from("journal_entry_lines")
        .select(
          "debit, credit, gl_accounts!inner(id, account_code, account_name, account_type, category), journal_entries!inner(entry_date)"
        )
        .gte("journal_entries.entry_date", fromDate)
        .lte("journal_entries.entry_date", toDateInclusive)
        .eq("journal_entries.is_posted", true)
        .in("gl_accounts.account_type", ["income", "expense"]);
      if (basis === "cash") {
        linesQuery.in("journal_entries.reference_type", [...CASH_BASIS_REFERENCE_TYPES]);
      }

      const [linesRes, accRes] = await Promise.all([
        filterJournalLinesByOrganizationId(linesQuery, orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("gl_accounts")
            .select("*")
            .order("account_code"),
          orgId,
          superAdmin
        ),
      ]);

      if (linesRes.error) throw new Error(linesRes.error.message);
      if (accRes.error) throw new Error(accRes.error.message);

      type AccRow = {
        id: string;
        account_code: string;
        account_name: string;
        account_type: string;
        category?: string | null;
      };
      const accounts = normalizeGlAccountRows((accRes.data || []) as unknown[])
        .filter((row) => row.is_active && (row.account_type === "income" || row.account_type === "expense"))
        .map((row) => ({
          id: row.id,
          account_code: row.account_code,
          account_name: row.account_name,
          account_type: row.account_type,
          category: row.category,
        }));
      const accMap: Record<string, AccRow> = Object.fromEntries(accounts.map((a) => [a.id, a]));
      const byAccount: Record<string, number> = {};
      (linesRes.data || []).forEach((l: {
        debit: number;
        credit: number;
        gl_accounts: AccRow | null;
      }) => {
        const acc = l.gl_accounts;
        if (!acc) return;
        accMap[acc.id] = acc;
        if (!byAccount[acc.id]) byAccount[acc.id] = 0;
        if (acc.account_type === "income") byAccount[acc.id] += (Number(l.credit) || 0) - (Number(l.debit) || 0);
        else byAccount[acc.id] += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      });
      accounts.forEach((acc) => {
        if (!(acc.id in byAccount)) byAccount[acc.id] = 0;
      });

      const rev: AccountTotal[] = [];
      const exp: AccountTotal[] = [];
      let tr = 0,
        te = 0;
      const byPeriod: Record<string, { revenue: number; expenses: number }> = {};
      Object.entries(byAccount).forEach(([id, total]) => {
        const acc = accMap[id];
        if (!acc) return;
        const row: AccountTotal = {
          account_id: acc.id,
          account_code: acc.account_code,
          account_name: acc.account_name,
          total,
          category: acc.category ?? null,
          account_type: acc.account_type === "income" ? "income" : "expense",
        };
        if (acc.account_type === "income") {
          rev.push(row);
          tr += total;
        } else {
          exp.push(row);
          te += total;
        }
      });
      (linesRes.data || []).forEach((l: {
        debit: number;
        credit: number;
        gl_accounts: { account_type: string } | null;
        journal_entries: { entry_date: string } | null;
      }) => {
        const accType = l.gl_accounts?.account_type;
        const entryDate = l.journal_entries?.entry_date || "";
        if (!entryDate || (accType !== "income" && accType !== "expense")) return;
        const period = entryDate.slice(0, 7);
        if (!byPeriod[period]) byPeriod[period] = { revenue: 0, expenses: 0 };
        if (accType === "income") byPeriod[period].revenue += (Number(l.credit) || 0) - (Number(l.debit) || 0);
        if (accType === "expense") byPeriod[period].expenses += (Number(l.debit) || 0) - (Number(l.credit) || 0);
      });
      rev.sort((a, b) => a.account_code.localeCompare(b.account_code));
      exp.sort((a, b) => a.account_code.localeCompare(b.account_code));
      const trend = Object.keys(byPeriod)
        .sort()
        .map((period) => ({
          period,
          revenue: byPeriod[period].revenue,
          expenses: byPeriod[period].expenses,
        }));

      let cogsRows: AccountTotal[] = [];
      let opexRows: AccountTotal[] = [];
      let saccoResult: SaccoStatementNumbers | null = null;
      let totalCogs = 0;
      let totalOpex = 0;
      let totalExpenseOut = te;

      if (mode === "school") {
        opexRows = [...exp];
        totalCogs = 0;
        totalOpex = te;
        totalExpenseOut = te;
      } else if (mode === "sacco") {
        saccoResult = buildSaccoStatement(rev, exp);
        totalCogs = 0;
        totalOpex = saccoResult.totalExpenditure;
        totalExpenseOut = saccoResult.totalExpenditure + saccoResult.incomeTax;
      } else {
        const classifier = mode === "manufacturing" ? classifyManufacturingExpenseRow : classifyRetailExpenseRow;
        for (const row of exp) {
          if (classifier(row) === "cogs") cogsRows.push(row);
          else opexRows.push(row);
        }
        totalCogs = cogsRows.reduce((s, r) => s + r.total, 0);
        totalOpex = opexRows.reduce((s, r) => s + r.total, 0);
        totalExpenseOut = totalCogs + totalOpex;
      }

      let expenseBreakdown: ExpenseSlice[];
      if (mode === "sacco" && saccoResult) {
        expenseBreakdown = [
          { name: "Personnel", value: saccoResult.personnel },
          { name: "Administration", value: saccoResult.administration },
          { name: "Finance", value: saccoResult.finance },
          { name: "Income tax", value: saccoResult.incomeTax },
        ]
          .filter((r) => Math.abs(r.value) > 0.0001)
          .sort((a, b) => b.value - a.value);
      } else {
        const pieRows = mode === "school" ? exp : opexRows;
        expenseBreakdown = pieRows
          .map((r) => ({ name: `${r.account_code} ${r.account_name}`.trim(), value: Number(r.total) || 0 }))
          .filter((r) => Math.abs(r.value) > 0.0001)
          .sort((a, b) => b.value - a.value)
          .slice(0, 12);
      }

      const snapshot: TotalsSnapshot = {
        mode,
        revenueRows: rev,
        expenseRows: exp,
        cogsRows,
        opexRows,
        totalRevenue: tr,
        totalCogs,
        totalOpex,
        totalExpenses: totalExpenseOut,
        sacco: saccoResult,
        branches: [] as string[],
        trend,
        expenseBreakdown,
      };
      totalsCacheRef.current.set(cacheKey, snapshot);
      return snapshot;
    };
    try {
      const bt = user?.business_type ?? null;
      const currentRes = await fetchTotalsForRange(fromStr, toStrInclusive, bt);

      if (requestSeq !== requestSeqRef.current) return;
      setStatementMode(currentRes.mode);
      setRevenue(currentRes.revenueRows);
      setExpenses(currentRes.expenseRows);
      setCogsRows(currentRes.cogsRows);
      setOpexRows(currentRes.opexRows);
      setSaccoSummary(currentRes.sacco);
      setTotalRevenue(currentRes.totalRevenue);
      setTotalCogs(currentRes.totalCogs);
      setTotalOpex(currentRes.totalOpex);
      setTotalExpenses(currentRes.totalExpenses);
      setTrendData(currentRes.trend);
      setExpenseBreakdown(currentRes.expenseBreakdown);

      if (compareRange === "none") {
        setPreviousTotalRevenue(0);
        setPreviousTotalExpenses(0);
        setPreviousTotalCogs(0);
        setPreviousTotalOpex(0);
        setPreviousRevenueRows([]);
        setPreviousExpenseRows([]);
        setPreviousCogsRows([]);
        setPreviousOpexRows([]);
        setPreviousSacco(null);
        setPreviousLabel("Previous");
        return;
      }

      const msPerDay = 24 * 60 * 60 * 1000;
      let prevFrom = new Date(fromStr + "T00:00:00");
      let prevTo = new Date(toStr + "T00:00:00");
      if (compareRange === "previous_period") {
        const daySpan = Math.floor((prevTo.getTime() - prevFrom.getTime()) / msPerDay) + 1;
        prevFrom = new Date(prevFrom.getTime() - daySpan * msPerDay);
        prevTo = new Date(prevTo.getTime() - daySpan * msPerDay);
        setPreviousLabel("Previous period");
      } else {
        prevFrom.setFullYear(prevFrom.getFullYear() - 1);
        prevTo.setFullYear(prevTo.getFullYear() - 1);
        setPreviousLabel("Same period last year");
      }

      const prevFromStr = toBusinessDateString(prevFrom);
      const prevToInclusive = toBusinessDateString(new Date(prevTo.getTime() - 1));
      const prevRes = await fetchTotalsForRange(prevFromStr, prevToInclusive, bt);
      if (requestSeq !== requestSeqRef.current) return;
      setPreviousTotalRevenue(prevRes.totalRevenue);
      setPreviousTotalExpenses(prevRes.totalExpenses);
      setPreviousTotalCogs(prevRes.totalCogs);
      setPreviousTotalOpex(prevRes.totalOpex);
      setPreviousRevenueRows(prevRes.revenueRows);
      setPreviousExpenseRows(prevRes.expenseRows);
      setPreviousCogsRows(prevRes.cogsRows);
      setPreviousOpexRows(prevRes.opexRows);
      setPreviousSacco(prevRes.sacco);
    } catch (e) {
      if (requestSeq !== requestSeqRef.current) return;
      setFetchError(e instanceof Error ? e.message : String(e));
      setPreviousTotalRevenue(0);
      setPreviousTotalExpenses(0);
      setPreviousTotalCogs(0);
      setPreviousTotalOpex(0);
      setPreviousRevenueRows([]);
      setPreviousExpenseRows([]);
      setPreviousCogsRows([]);
      setPreviousOpexRows([]);
      setPreviousSacco(null);
    } finally {
      if (requestSeq !== requestSeqRef.current) return;
      setLoading(false);
    }
  };

  const netIncome = useMemo(() => {
    if (statementMode === "sacco" && saccoSummary) return saccoSummary.profitForYear;
    if (statementMode === "school") return totalRevenue - totalExpenses;
    return totalRevenue - totalCogs - totalOpex;
  }, [statementMode, saccoSummary, totalRevenue, totalExpenses, totalCogs, totalOpex]);

  const previousNetIncome = useMemo(() => {
    if (statementMode === "sacco" && previousSacco) return previousSacco.profitForYear;
    if (statementMode === "school") return previousTotalRevenue - previousTotalExpenses;
    return previousTotalRevenue - previousTotalCogs - previousTotalOpex;
  }, [
    statementMode,
    previousSacco,
    previousTotalRevenue,
    previousTotalExpenses,
    previousTotalCogs,
    previousTotalOpex,
  ]);

  /** Retail / manufacturing three-section layout: revenue minus COGS. */
  const grossProfit = useMemo(() => totalRevenue - totalCogs, [totalRevenue, totalCogs]);
  const previousGrossProfit = useMemo(
    () => previousTotalRevenue - previousTotalCogs,
    [previousTotalRevenue, previousTotalCogs]
  );
  const previousRevenueById = useMemo(
    () => new Map(previousRevenueRows.map((r) => [r.account_id, r.total])),
    [previousRevenueRows]
  );
  const previousExpenseById = useMemo(
    () => new Map(previousExpenseRows.map((r) => [r.account_id, r.total])),
    [previousExpenseRows]
  );
  const previousCogsById = useMemo(
    () => new Map(previousCogsRows.map((r) => [r.account_id, r.total])),
    [previousCogsRows]
  );
  const previousOpexById = useMemo(
    () => new Map(previousOpexRows.map((r) => [r.account_id, r.total])),
    [previousOpexRows]
  );

  const hasNegativeRevenue = revenue.some((r) => r.total < 0);
  const hasNegativeExpense =
    expenses.some((e) => e.total < 0) || cogsRows.some((r) => r.total < 0) || opexRows.some((r) => r.total < 0);
  const hasRenderedData =
    revenue.length > 0 ||
    expenses.length > 0 ||
    totalRevenue !== 0 ||
    totalExpenses !== 0 ||
    compareRange !== "none";
  const initialLoading = loading && !hasRenderedData;
  const refreshing = loading && hasRenderedData;

  const periodLabel = useMemo(() => {
    const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
    const basisLabel = basis === "cash" ? "Cash basis" : "Accrual basis";
    const endInclusive = toBusinessDateString(new Date(to.getTime() - 1));
    return `${toBusinessDateString(from)} to ${endInclusive} (${basisLabel})`;
  }, [dateRange, customFrom, customTo, basis]);

  const fileStamp = useMemo(() => computeRangeInTimezone(dateRange, customFrom, customTo).to.toISOString().slice(0, 10), [dateRange, customFrom, customTo]);
  const pieColors = ["#0ea5e9", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#14b8a6", "#6366f1", "#84cc16", "#ec4899", "#22c55e", "#f97316", "#64748b"];

  const openDrilldown = async (account: { id: string; code: string; name: string; type: "income" | "expense" }) => {
    setDrillAccount(account);
    setDrillRows([]);
    setDrillError(null);
    setDrillLoading(true);
    try {
      const effectiveCustomFrom = dateRange === "custom" ? debouncedCustomFrom : customFrom;
      const effectiveCustomTo = dateRange === "custom" ? debouncedCustomTo : customTo;
      const { from, to } = computeRangeInTimezone(dateRange, effectiveCustomFrom, effectiveCustomTo);
      const fromStr = toBusinessDateString(from);
      const toStrInclusive = toBusinessDateString(new Date(to.getTime() - 1));
      const q = supabase
        .from("journal_entry_lines")
        .select(
          "id, debit, credit, line_description, journal_entries!inner(id, entry_date, description, transaction_id, reference_type), gl_accounts!inner(id)"
        )
        .eq("gl_account_id", account.id)
        .gte("journal_entries.entry_date", fromStr)
        .lte("journal_entries.entry_date", toStrInclusive)
        .eq("journal_entries.is_posted", true)
        .order("entry_date", { ascending: false, referencedTable: "journal_entries" });
      if (basis === "cash") {
        q.in("journal_entries.reference_type", [...CASH_BASIS_REFERENCE_TYPES]);
      }
      const { data, error } = await filterJournalLinesByOrganizationId(q, orgId, superAdmin);
      if (error) throw new Error(error.message);
      const rows = ((data || []) as Array<{
        id: string;
        debit: number;
        credit: number;
        line_description: string | null;
        journal_entries: { entry_date: string; description: string; transaction_id: string | null; reference_type: string | null } | null;
      }>).map((r) => ({
        id: r.id,
        entry_date: r.journal_entries?.entry_date || "",
        description: r.journal_entries?.description || "",
        transaction_id: r.journal_entries?.transaction_id ?? null,
        reference_type: r.journal_entries?.reference_type ?? null,
        debit: Number(r.debit) || 0,
        credit: Number(r.credit) || 0,
        line_description: r.line_description,
      }));
      setDrillRows(rows);
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : String(e));
    } finally {
      setDrillLoading(false);
    }
  };

  const ugxOpts = { currency: "UGX" as const, locale: "en-UG" as const };
  const fmtUgx = (n: number) => formatCurrency(n, ugxOpts);

  const exportExcel = () => {
    const head: (string | number)[][] = [["Income Statement", periodLabel], []];

    if (statementMode === "sacco" && saccoSummary) {
      const incomeRows = saccoIncomeLinesDisplayed.map(([label, val]) => [label, fmtUgx(val)] as (string | number)[]);
      const expenditureRows = saccoExpenditureLinesDisplayed.map(([label, val]) => [label, fmtUgx(val)] as (string | number)[]);
      const rows: (string | number)[][] = [...head, ["Income"], ...incomeRows, [], ["Expenditure"], ...expenditureRows];
      downloadXlsx(`income-statement-${fileStamp}.xlsx`, rows, { companyName, sheetName: "Income Statement" });
      return;
    }

    if (statementMode === "school") {
      const rows: (string | number)[][] = [
        ...head,
        ["Income"],
        ["Code", "Name", "Amount"],
        ...revenueDisplayed.map((r) => [r.account_code, r.account_name, fmtUgx(r.total)]),
        ["", "Total income", fmtUgx(totalRevenue)],
        [],
        ["Expenditure"],
        ["Code", "Name", "Amount"],
        ...expensesDisplayed.map((e) => [e.account_code, e.account_name, fmtUgx(e.total)]),
        ["", "Total expenditure", fmtUgx(totalExpenses)],
        [],
        ["", "Net income", fmtUgx(netIncome)],
      ];
      downloadXlsx(`income-statement-${fileStamp}.xlsx`, rows, { companyName, sheetName: "Income Statement" });
      return;
    }

    const rows: (string | number)[][] = [
      ...head,
      ["Revenue"],
      ["Code", "Name", "Amount"],
      ...revenueDisplayed.map((r) => [r.account_code, r.account_name, fmtUgx(r.total)]),
      ["", "Total revenue", fmtUgx(totalRevenue)],
      [],
      ["Cost of goods sold"],
      ["Code", "Name", "Amount"],
      ...cogsDisplayed.map((r) => [r.account_code, r.account_name, fmtUgx(r.total)]),
      ["", "Total cost of goods sold", fmtUgx(totalCogs)],
      ["", "Gross profit", fmtUgx(grossProfit)],
      [],
      ["Operating expenses"],
      ["Code", "Name", "Amount"],
      ...opexDisplayed.map((e) => [e.account_code, e.account_name, fmtUgx(e.total)]),
      ["", "Total operating expenses", fmtUgx(totalOpex)],
      [],
      ["", "Net income", fmtUgx(netIncome)],
    ];
    downloadXlsx(`income-statement-${fileStamp}.xlsx`, rows, { companyName, sheetName: "Income Statement" });
  };

  const exportPdf = () => {
    if (statementMode === "sacco" && saccoSummary) {
      exportAccountingPdf({
        title: "Income Statement (SACCO)",
        subtitle: periodLabel,
        filename: `income-statement-${fileStamp}.pdf`,
        companyName,
        sections: [
          {
            title: "Income",
            head: ["Line", "Amount"],
            body: saccoIncomeLinesDisplayed.map(([label, val]) => [label, fmtUgx(val)]),
          },
          {
            title: "Expenditure",
            head: ["Line", "Amount"],
            body: saccoExpenditureLinesDisplayed.map(([label, val]) => [label, fmtUgx(val)]),
          },
        ],
      });
      return;
    }

    if (statementMode === "school") {
      exportAccountingPdf({
        title: "Income Statement",
        subtitle: periodLabel,
        filename: `income-statement-${fileStamp}.pdf`,
        companyName,
        sections: [
          {
            title: "Income",
            head: ["Code", "Name", "Amount"],
            body: revenueDisplayed.map((r) => [r.account_code, r.account_name, fmtUgx(r.total)]),
          },
          {
            title: "Expenditure",
            head: ["Code", "Name", "Amount"],
            body: expensesDisplayed.map((e) => [e.account_code, e.account_name, fmtUgx(e.total)]),
          },
        ],
        footerLines: [
          `Total income: ${fmtUgx(totalRevenue)}  Total expenditure: ${fmtUgx(totalExpenses)}`,
          `Net income: ${fmtUgx(netIncome)}`,
        ],
      });
      return;
    }

    exportAccountingPdf({
      title: "Income Statement",
      subtitle: periodLabel,
      filename: `income-statement-${fileStamp}.pdf`,
      companyName,
      sections: [
        {
          title: "Revenue",
          head: ["Code", "Name", "Amount"],
          body: revenueDisplayed.map((r) => [r.account_code, r.account_name, fmtUgx(r.total)]),
        },
        {
          title: "Cost of goods sold",
          head: ["Code", "Name", "Amount"],
          body: cogsDisplayed.map((r) => [r.account_code, r.account_name, fmtUgx(r.total)]),
        },
        {
          title: "Gross profit",
          head: ["Line", "Amount"],
          body: [["Gross profit", fmtUgx(grossProfit)]],
        },
        {
          title: "Operating expenses",
          head: ["Code", "Name", "Amount"],
          body: opexDisplayed.map((e) => [e.account_code, e.account_name, fmtUgx(e.total)]),
        },
      ],
      footerLines: [
        `Total revenue: ${fmtUgx(totalRevenue)}  COGS: ${fmtUgx(totalCogs)}  Gross profit: ${fmtUgx(grossProfit)}  Operating expenses: ${fmtUgx(totalOpex)}`,
        `Net income: ${fmtUgx(netIncome)}`,
      ],
    });
  };

  return (
    <div className="p-6 md:p-8">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Income Statement</h1>
          <PageNotes ariaLabel="Income statement help">
            {statementMode === "school" ? (
              <p>
                <strong>School:</strong> Income and expenditure from posted journals. Tag GL accounts in the chart of accounts (category / name) so
                costs classify correctly.
              </p>
            ) : statementMode === "sacco" ? (
              <p>
                <strong>SACCO:</strong> Lines map from your chart using keywords (interest, fee, loan loss, personnel, administration, finance, tax).
                Adjust account names or categories to match.
              </p>
            ) : statementMode === "manufacturing" ? (
              <p>
                <strong>Manufacturing:</strong> Same layout as retail (revenue, cost of goods sold, operating expenses). Direct production and factory
                costs are grouped under <strong>Cost of goods sold</strong> when account names/categories match manufacturing keywords.
              </p>
            ) : (
              <p>
                <strong>Hotel / retail:</strong> Revenue, <strong>cost of goods sold</strong> (direct costs / inventory COGS), and operating expenses.
                Use GL categories or names containing &quot;cogs&quot;, &quot;cost of goods&quot;, etc. for COGS.
              </p>
            )}
            <p className="mt-2">
              Uses posted journal lines for income and expense accounts (no per-branch filter unless your database has optional{" "}
              <code className="text-xs">journal_entry_lines.dimensions</code>).
            </p>
          </PageNotes>
        </div>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">
          {fetchError}
        </div>
      )}
      {!fetchError && (hasNegativeRevenue || hasNegativeExpense) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="alert">
          Negative balances detected in {hasNegativeRevenue ? "revenue" : ""}
          {hasNegativeRevenue && hasNegativeExpense ? " and " : ""}
          {hasNegativeExpense ? "expense" : ""} accounts. Please review source journals for potential posting errors.
        </div>
      )}
      {!fetchError && basis === "cash" && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900" role="status">
          Cash basis view is enabled. This report is generated from posted journal entries.
        </div>
      )}
      {!fetchError && showBasisHelp && (
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700" role="status">
          Basis help: accrual includes all posted journals for the period. Cash includes posted journals with reference types:
          <code className="text-xs"> payment</code>, <code className="text-xs">pos</code>, <code className="text-xs">vendor_payment</code>,{" "}
          <code className="text-xs">expense</code>.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
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
          <select
            value={compareRange}
            onChange={(e) => setCompareRange(e.target.value as "none" | "previous_period" | "same_period_last_year")}
            className="border rounded-lg px-3 py-2"
          >
            <option value="none">No comparison</option>
            <option value="previous_period">Compare with previous period</option>
            <option value="same_period_last_year">Compare with same period last year</option>
          </select>
          <select value={basis} onChange={(e) => setBasis(e.target.value as "accrual" | "cash")} className="border rounded-lg px-3 py-2">
            <option value="accrual">Accrual basis</option>
            <option value="cash">Cash basis</option>
          </select>
          <button
            type="button"
            onClick={() => setShowBasisHelp((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50"
            title={showBasisHelp ? "Hide basis help" : "Show basis help"}
            aria-label={showBasisHelp ? "Hide basis help" : "Show basis help"}
          >
            <Info className="h-4 w-4" />
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showZeroBalanceAccounts}
              onChange={(e) => setShowZeroBalanceAccounts(e.target.checked)}
              className="rounded border-slate-300"
            />
            Show zero-balance accounts
          </label>
          {statementMode === "sacco" && (
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideSaccoZeroSummaryLines}
                onChange={(e) => setHideSaccoZeroSummaryLines(e.target.checked)}
                className="rounded border-slate-300"
              />
              Hide zero summary lines
            </label>
          )}
        </div>
        {!loading && !fetchError && <AccountingExportButtons onExcel={exportExcel} onPdf={exportPdf} />}
      </div>

      {initialLoading ? (
        <div className="space-y-4 max-w-2xl">
          <div className="h-10 w-56 rounded-lg bg-slate-200 animate-pulse" />
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="h-5 w-40 rounded bg-slate-200 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="h-5 w-40 rounded bg-slate-200 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-full rounded bg-slate-100 animate-pulse" />
            <div className="h-4 w-3/4 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-6 items-start ${compareRange !== "none" ? "xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]" : ""}`}>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-3xl">
          {refreshing && (
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
              Refreshing report...
            </div>
          )}
          {statementMode === "sacco" && saccoSummary ? (
            <>
              <div className="p-4 border-b bg-slate-50 font-semibold text-slate-900">Income</div>
              <table className="w-full text-sm">
                <tbody>
                  {saccoIncomeLinesDisplayed.length === 0 ? (
                    <tr className="border-t">
                      <td colSpan={2} className="p-3 text-slate-500">
                        No non-zero income summary lines (turn off &quot;Hide zero summary lines&quot; to show all).
                      </td>
                    </tr>
                  ) : (
                    saccoIncomeLinesDisplayed.map((row) => {
                      const [label, val, bold] = row;
                      return (
                        <tr key={label} className="border-t">
                          <td className={`p-3 ${bold ? "font-semibold" : ""}`}>{label}</td>
                          <td className={`p-3 text-right ${bold ? "font-semibold" : ""}`}>{fmtUgx(val)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div className="p-4 border-t border-b bg-slate-50 font-semibold text-slate-900">Expenditure</div>
              <table className="w-full text-sm">
                <tbody>
                  {saccoExpenditureLinesDisplayed.length === 0 ? (
                    <tr className="border-t">
                      <td colSpan={2} className="p-3 text-slate-500">
                        No non-zero expenditure summary lines (turn off &quot;Hide zero summary lines&quot; to show all).
                      </td>
                    </tr>
                  ) : (
                    saccoExpenditureLinesDisplayed.map((row) => {
                      const [label, val, bold] = row;
                      return (
                        <tr key={label} className="border-t">
                          <td className={`p-3 ${bold ? "font-semibold" : ""}`}>{label}</td>
                          <td className={`p-3 text-right ${bold ? "font-semibold" : ""}`}>{fmtUgx(val)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </>
          ) : statementMode === "school" ? (
            <>
              <div className="p-4 border-b bg-slate-50 font-medium">Income</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Code</th>
                    <th className="p-3 text-left">Account</th>
                    <th className="p-3 text-right">% of income</th>
                    <th className="p-3 text-right">Amount</th>
                    {compareRange !== "none" && <th className="p-3 text-right">{previousLabel}</th>}
                  </tr>
                </thead>
                <tbody>
                  {revenueDisplayed.map((r) => (
                    <tr key={r.account_code} className="border-t">
                      <td className="p-3 font-mono">{r.account_code}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown({ id: r.account_id, code: r.account_code, name: r.account_name, type: "income" })}
                          className="text-left text-blue-700 hover:underline"
                        >
                          {r.account_name}
                        </button>
                      </td>
                      <td className="p-3 text-right text-slate-600">
                        {totalRevenue !== 0 ? `${((r.total / totalRevenue) * 100).toFixed(1)}%` : "0.0%"}
                      </td>
                      <td className={`p-3 text-right ${r.total < 0 ? "text-rose-700 font-medium" : ""}`}>{fmtUgx(r.total)}</td>
                      {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousRevenueById.get(r.account_id) ?? 0)}</td>}
                    </tr>
                  ))}
                  {revenue.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No income accounts
                      </td>
                    </tr>
                  )}
                  {revenue.length > 0 && revenueDisplayed.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No non-zero income accounts (turn on &quot;Show zero-balance accounts&quot; to list all).
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-medium">
                  <tr>
                    <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-right">
                      Total income
                    </td>
                    <td className="p-3 text-right">{fmtUgx(totalRevenue)}</td>
                    {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousTotalRevenue)}</td>}
                  </tr>
                </tfoot>
              </table>
              <div className="p-4 border-t border-b bg-slate-50 font-medium">Expenditure</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Code</th>
                    <th className="p-3 text-left">Account</th>
                    <th className="p-3 text-right">% of expenditure</th>
                    <th className="p-3 text-right">Amount</th>
                    {compareRange !== "none" && <th className="p-3 text-right">{previousLabel}</th>}
                  </tr>
                </thead>
                <tbody>
                  {expensesDisplayed.map((e) => (
                    <tr key={e.account_code} className="border-t">
                      <td className="p-3 font-mono">{e.account_code}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown({ id: e.account_id, code: e.account_code, name: e.account_name, type: "expense" })}
                          className="text-left text-blue-700 hover:underline"
                        >
                          {e.account_name}
                        </button>
                      </td>
                      <td className="p-3 text-right text-slate-600">
                        {totalExpenses !== 0 ? `${((e.total / totalExpenses) * 100).toFixed(1)}%` : "0.0%"}
                      </td>
                      <td className={`p-3 text-right ${e.total < 0 ? "text-rose-700 font-medium" : ""}`}>{fmtUgx(e.total)}</td>
                      {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousExpenseById.get(e.account_id) ?? 0)}</td>}
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No expenditure accounts
                      </td>
                    </tr>
                  )}
                  {expenses.length > 0 && expensesDisplayed.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No non-zero expenditure accounts (turn on &quot;Show zero-balance accounts&quot; to list all).
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-medium">
                  <tr>
                    <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-right">
                      Total expenditure
                    </td>
                    <td className="p-3 text-right">{fmtUgx(totalExpenses)}</td>
                    {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousTotalExpenses)}</td>}
                  </tr>
                </tfoot>
              </table>
              <div className="p-4 border-t bg-emerald-50 font-bold text-lg">
                <span className="inline-block w-full text-right">Net income: {fmtUgx(netIncome)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 border-b bg-slate-50 font-medium">Revenue</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Code</th>
                    <th className="p-3 text-left">Account</th>
                    <th className="p-3 text-right">% of revenue</th>
                    <th className="p-3 text-right">Amount</th>
                    {compareRange !== "none" && <th className="p-3 text-right">{previousLabel}</th>}
                  </tr>
                </thead>
                <tbody>
                  {revenueDisplayed.map((r) => (
                    <tr key={r.account_code} className="border-t">
                      <td className="p-3 font-mono">{r.account_code}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown({ id: r.account_id, code: r.account_code, name: r.account_name, type: "income" })}
                          className="text-left text-blue-700 hover:underline"
                        >
                          {r.account_name}
                        </button>
                      </td>
                      <td className="p-3 text-right text-slate-600">
                        {totalRevenue !== 0 ? `${((r.total / totalRevenue) * 100).toFixed(1)}%` : "0.0%"}
                      </td>
                      <td className={`p-3 text-right ${r.total < 0 ? "text-rose-700 font-medium" : ""}`}>{fmtUgx(r.total)}</td>
                      {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousRevenueById.get(r.account_id) ?? 0)}</td>}
                    </tr>
                  ))}
                  {revenue.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No revenue accounts
                      </td>
                    </tr>
                  )}
                  {revenue.length > 0 && revenueDisplayed.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No non-zero revenue accounts (turn on &quot;Show zero-balance accounts&quot; to list all).
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-medium">
                  <tr>
                    <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-right">
                      Total revenue
                    </td>
                    <td className="p-3 text-right">{fmtUgx(totalRevenue)}</td>
                    {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousTotalRevenue)}</td>}
                  </tr>
                </tfoot>
              </table>
              <div className="p-4 border-t border-b bg-slate-50 font-medium">Cost of goods sold</div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Code</th>
                    <th className="p-3 text-left">Account</th>
                    <th className="p-3 text-right">% of revenue</th>
                    <th className="p-3 text-right">Amount</th>
                    {compareRange !== "none" && <th className="p-3 text-right">{previousLabel}</th>}
                  </tr>
                </thead>
                <tbody>
                  {cogsDisplayed.map((r) => (
                    <tr key={r.account_code} className="border-t">
                      <td className="p-3 font-mono">{r.account_code}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown({ id: r.account_id, code: r.account_code, name: r.account_name, type: "expense" })}
                          className="text-left text-blue-700 hover:underline"
                        >
                          {r.account_name}
                        </button>
                      </td>
                      <td className="p-3 text-right text-slate-600">
                        {totalRevenue !== 0 ? `${((r.total / totalRevenue) * 100).toFixed(1)}%` : "0.0%"}
                      </td>
                      <td className={`p-3 text-right ${r.total < 0 ? "text-rose-700 font-medium" : ""}`}>{fmtUgx(r.total)}</td>
                      {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousCogsById.get(r.account_id) ?? 0)}</td>}
                    </tr>
                  ))}
                  {cogsRows.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No COGS accounts (tag direct costs in your chart).
                      </td>
                    </tr>
                  )}
                  {cogsRows.length > 0 && cogsDisplayed.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No non-zero COGS lines (turn on &quot;Show zero-balance accounts&quot; to list all).
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-medium">
                  <tr>
                    <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-right">
                      Total cost of goods sold
                    </td>
                    <td className="p-3 text-right">{fmtUgx(totalCogs)}</td>
                    {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousTotalCogs)}</td>}
                  </tr>
                </tfoot>
              </table>
              <table className="w-full text-sm border-t-2 border-slate-200">
                <tbody>
                  <tr className="bg-slate-100">
                    <td colSpan={2} className="p-3 text-right font-semibold text-slate-900">Gross profit</td>
                    <td className="p-3 text-right font-normal text-slate-600">
                      {totalRevenue !== 0 ? `${((grossProfit / totalRevenue) * 100).toFixed(1)}%` : "0.0%"}
                    </td>
                    <td className={`p-3 text-right font-semibold ${grossProfit < 0 ? "text-rose-700" : "text-slate-900"}`}>
                      {fmtUgx(grossProfit)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="p-4 border-t border-b bg-slate-50 font-medium">
                Operating expenses
                {statementMode === "manufacturing" ? (
                  <span className="block text-xs font-normal text-slate-600 mt-1">
                    (General &amp; administrative — production costs are under COGS above.)
                  </span>
                ) : null}
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-3 text-left">Code</th>
                    <th className="p-3 text-left">Account</th>
                    <th className="p-3 text-right">% of revenue</th>
                    <th className="p-3 text-right">Amount</th>
                    {compareRange !== "none" && <th className="p-3 text-right">{previousLabel}</th>}
                  </tr>
                </thead>
                <tbody>
                  {opexDisplayed.map((e) => (
                    <tr key={e.account_code} className="border-t">
                      <td className="p-3 font-mono">{e.account_code}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => openDrilldown({ id: e.account_id, code: e.account_code, name: e.account_name, type: "expense" })}
                          className="text-left text-blue-700 hover:underline"
                        >
                          {e.account_name}
                        </button>
                      </td>
                      <td className="p-3 text-right text-slate-600">
                        {totalRevenue !== 0 ? `${((e.total / totalRevenue) * 100).toFixed(1)}%` : "0.0%"}
                      </td>
                      <td className={`p-3 text-right ${e.total < 0 ? "text-rose-700 font-medium" : ""}`}>{fmtUgx(e.total)}</td>
                      {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousOpexById.get(e.account_id) ?? 0)}</td>}
                    </tr>
                  ))}
                  {opexRows.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No operating expense accounts
                      </td>
                    </tr>
                  )}
                  {opexRows.length > 0 && opexDisplayed.length === 0 && (
                    <tr>
                      <td colSpan={compareRange !== "none" ? 5 : 4} className="p-3 text-slate-500">
                        No non-zero operating expenses (turn on &quot;Show zero-balance accounts&quot; to list all).
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 font-medium">
                  <tr>
                    <td colSpan={compareRange !== "none" ? 4 : 3} className="p-3 text-right">
                      Total operating expenses
                    </td>
                    <td className="p-3 text-right">{fmtUgx(totalOpex)}</td>
                    {compareRange !== "none" && <td className="p-3 text-right">{fmtUgx(previousTotalOpex)}</td>}
                  </tr>
                </tfoot>
              </table>
              <div className="p-4 border-t bg-emerald-50 font-bold text-lg">
                <span className="inline-block w-full text-right">Net income: {fmtUgx(netIncome)}</span>
              </div>
            </>
          )}
          </div>
          {!fetchError && compareRange !== "none" && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden max-w-2xl xl:max-w-none">
              {refreshing && (
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  Refreshing comparison...
                </div>
              )}
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
                  {statementMode === "sacco" && saccoSummary ? (
                    <>
                      <tr className="border-t">
                        <td className="p-3">Total income</td>
                        <td className="p-3 text-right">{fmtUgx(saccoSummary.totalIncome)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousSacco?.totalIncome ?? 0)}</td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Total expenses</td>
                        <td className="p-3 text-right">{fmtUgx(saccoSummary.totalExpenditure)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousSacco?.totalExpenditure ?? 0)}</td>
                      </tr>
                      <tr className="border-t font-medium bg-slate-50">
                        <td className="p-3">Profit for the year</td>
                        <td className="p-3 text-right">{fmtUgx(netIncome)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousNetIncome)}</td>
                      </tr>
                    </>
                  ) : statementMode === "school" ? (
                    <>
                      <tr className="border-t">
                        <td className="p-3">Income</td>
                        <td className="p-3 text-right">{fmtUgx(totalRevenue)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousTotalRevenue)}</td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Expenditure</td>
                        <td className="p-3 text-right">{fmtUgx(totalExpenses)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousTotalExpenses)}</td>
                      </tr>
                      <tr className="border-t font-medium bg-slate-50">
                        <td className="p-3">Net income</td>
                        <td className="p-3 text-right">{fmtUgx(netIncome)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousNetIncome)}</td>
                      </tr>
                    </>
                  ) : (
                    <>
                      <tr className="border-t">
                        <td className="p-3">Revenue</td>
                        <td className="p-3 text-right">{fmtUgx(totalRevenue)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousTotalRevenue)}</td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Cost of goods sold</td>
                        <td className="p-3 text-right">{fmtUgx(totalCogs)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousTotalCogs)}</td>
                      </tr>
                      <tr className="border-t font-medium bg-slate-50">
                        <td className="p-3">Gross profit</td>
                        <td className="p-3 text-right">{fmtUgx(grossProfit)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousGrossProfit)}</td>
                      </tr>
                      <tr className="border-t">
                        <td className="p-3">Operating expenses</td>
                        <td className="p-3 text-right">{fmtUgx(totalOpex)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousTotalOpex)}</td>
                      </tr>
                      <tr className="border-t font-medium bg-slate-50">
                        <td className="p-3">Net income</td>
                        <td className="p-3 text-right">{fmtUgx(netIncome)}</td>
                        <td className="p-3 text-right">{fmtUgx(previousNetIncome)}</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {!initialLoading && !fetchError && (
        <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-6 max-w-6xl">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-3">
              {statementMode === "school"
                ? "Income vs expenditure trend"
                : statementMode === "sacco"
                  ? "Income vs expenses trend"
                  : "Revenue vs expenses trend"}
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => formatCurrency(Number(v) || 0, { currency: "UGX", locale: "en-UG" })} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="expenses" stroke="#7c3aed" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-800 mb-3">
              {statementMode === "school" || statementMode === "sacco" ? "Expenditure breakdown" : "Operating expense breakdown"}
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expenseBreakdown} dataKey="value" nameKey="name" outerRadius={100} labelLine={false} label={({ percent = 0 }) => `${(percent * 100).toFixed(1)}%`}>
                    {expenseBreakdown.map((_, idx) => (
                      <Cell key={`slice-${idx}`} fill={pieColors[idx % pieColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(Number(v) || 0, { currency: "UGX", locale: "en-UG" })} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      {drillAccount && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4 overflow-y-auto">
          <div className="mx-auto mt-8 w-full max-w-5xl rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Drill-down: {drillAccount.code} {drillAccount.name}
                </h3>
                <p className="text-xs text-slate-500 capitalize">{drillAccount.type} transactions in selected period/filters</p>
              </div>
              <button
                type="button"
                onClick={() => setDrillAccount(null)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="p-4">
              {drillLoading ? (
                <div className="text-slate-500">Loading transactions...</div>
              ) : drillError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{drillError}</div>
              ) : (
                <div className="overflow-auto max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">Date</th>
                        <th className="p-2 text-left">Description</th>
                        <th className="p-2 text-left">Ref</th>
                        <th className="p-2 text-right">Debit</th>
                        <th className="p-2 text-right">Credit</th>
                        <th className="p-2 text-right">Impact</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drillRows.map((r) => {
                        const impact = drillAccount.type === "income" ? r.credit - r.debit : r.debit - r.credit;
                        return (
                          <tr key={r.id} className="border-t">
                            <td className="p-2">{r.entry_date}</td>
                            <td className="p-2">
                              <div>{r.description || "—"}</div>
                              {r.line_description ? <div className="text-xs text-slate-500">{r.line_description}</div> : null}
                            </td>
                            <td className="p-2 text-xs text-slate-600">{r.reference_type || "—"} {r.transaction_id ? `#${r.transaction_id}` : ""}</td>
                            <td className="p-2 text-right">{formatCurrency(r.debit, { currency: "UGX", locale: "en-UG" })}</td>
                            <td className="p-2 text-right">{formatCurrency(r.credit, { currency: "UGX", locale: "en-UG" })}</td>
                            <td className="p-2 text-right font-medium">{formatCurrency(impact, { currency: "UGX", locale: "en-UG" })}</td>
                          </tr>
                        );
                      })}
                      {drillRows.length === 0 && (
                        <tr>
                          <td colSpan={6} className="p-4 text-center text-slate-500">
                            No transactions found for this account and filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
