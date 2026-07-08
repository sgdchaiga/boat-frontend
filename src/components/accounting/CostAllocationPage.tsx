import { useEffect, useMemo, useState } from "react";
import { BarChart3, Calculator, CheckCircle2, Download, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { createJournalEntry } from "../../lib/journal";
import { resolveJournalAccountSettings } from "../../lib/journalAccountSettings";
import { canApprove } from "../../lib/permissions";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";

const BASES = [
  { value: "floor_area", label: "Floor Area" },
  { value: "headcount", label: "Headcount" },
  { value: "machine_hours", label: "Machine Hours" },
  { value: "labour_hours", label: "Labour Hours" },
  { value: "asset_value", label: "Asset Value" },
  { value: "revenue", label: "Revenue" },
  { value: "custom_percentage", label: "Custom Percentage" },
] as const;

const CENTRE_TYPES = [
  { value: "production", label: "Production" },
  { value: "administration", label: "Administration" },
  { value: "sales", label: "Sales" },
  { value: "support", label: "Support" },
  { value: "other", label: "Other" },
] as const;

type Basis = typeof BASES[number]["value"];
type CentreType = typeof CENTRE_TYPES[number]["value"];

type GLAccount = { id: string; account_code: string; account_name: string; account_type: string };
type CostCentre = { id: string; code: string | null; name: string; centre_type: CentreType; is_active: boolean };
type DriverValue = { id: string; period: string; cost_centre_id: string; basis: Basis; driver_value: number };
type AllocationRule = {
  id: string;
  name: string;
  expense_gl_account_id: string;
  debit_gl_account_id: string;
  target_cost_centre_id: string | null;
  basis: Basis;
  custom_percentage: number | null;
  is_active: boolean;
};
type AllocationRuleCentre = {
  id: string;
  rule_id: string;
  cost_centre_id: string;
  is_enabled: boolean;
};
type AllocationRun = {
  id: string;
  period: string;
  status: "draft" | "approved" | "reversed";
  total_amount: number;
  journal_entry_id: string | null;
  reversal_journal_entry_id: string | null;
  created_at: string;
  lines?: unknown;
};
type AllocationLine = {
  ruleId: string;
  ruleName: string;
  centreId: string;
  centreName: string;
  centreType: string;
  basis: Basis;
  expenseGlAccountId: string;
  expenseAccount: string;
  debitGlAccountId: string;
  debitAccount: string;
  driverValue: number;
  denominator: number;
  sourceAmount: number;
  allocatedAmount: number;
};
type ProductionEntry = {
  id: string;
  manual_serial_number: string | null;
  product_name: string | null;
  production_date: string | null;
  produced_qty: number | null;
};
type ProductionAllocationLine = {
  productionEntryId: string;
  label: string;
  basisValue: number;
  amount: number;
};
type AllocationReportRow = {
  key: string;
  centreName: string;
  centreType: string;
  basis: Basis;
  expenseAccount: string;
  amount: number;
};

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

function monthRange(period: string) {
  const [year, month] = period.split("-").map((value) => Number(value));
  const start = `${period}-01`;
  const endDate = new Date(Date.UTC(year, month, 0));
  return { start, end: endDate.toISOString().slice(0, 10) };
}

function fmt(n: number) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function accountLabel(account?: GLAccount | null) {
  return account ? `${account.account_code} ${account.account_name}`.trim() : "";
}

function isAllocationLine(line: unknown): line is AllocationLine {
  if (!line || typeof line !== "object") return false;
  const candidate = line as Partial<AllocationLine>;
  return typeof candidate.centreName === "string" && typeof candidate.expenseAccount === "string" && typeof candidate.allocatedAmount === "number";
}

export function CostAllocationPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const isManufacturing = user?.business_type === "manufacturing";
  const [period, setPeriod] = useState(currentPeriod());
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [centres, setCentres] = useState<CostCentre[]>([]);
  const [drivers, setDrivers] = useState<DriverValue[]>([]);
  const [rules, setRules] = useState<AllocationRule[]>([]);
  const [ruleCentres, setRuleCentres] = useState<AllocationRuleCentre[]>([]);
  const [runs, setRuns] = useState<AllocationRun[]>([]);
  const [productionEntries, setProductionEntries] = useState<ProductionEntry[]>([]);
  const [preview, setPreview] = useState<AllocationLine[]>([]);
  const [productionPreview, setProductionPreview] = useState<ProductionAllocationLine[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [centreName, setCentreName] = useState("");
  const [centreCode, setCentreCode] = useState("");
  const [centreType, setCentreType] = useState<CentreType>("production");
  const [driverCentreId, setDriverCentreId] = useState("");
  const [driverBasis, setDriverBasis] = useState<Basis>("floor_area");
  const [driverValue, setDriverValue] = useState("0");
  const [ruleName, setRuleName] = useState("");
  const [ruleExpenseAccountId, setRuleExpenseAccountId] = useState("");
  const [ruleDebitAccountId, setRuleDebitAccountId] = useState("");
  const [ruleBasis, setRuleBasis] = useState<Basis>("floor_area");
  const [ruleEnabledCentreIds, setRuleEnabledCentreIds] = useState<string[]>([]);
  const [productionOverheadAmount, setProductionOverheadAmount] = useState("0");
  const [productionDebitAccountId, setProductionDebitAccountId] = useState("");
  const [productionCreditAccountId, setProductionCreditAccountId] = useState("");

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const centreById = useMemo(() => new Map(centres.map((centre) => [centre.id, centre])), [centres]);
  const activeRules = useMemo(() => rules.filter((rule) => rule.is_active), [rules]);
  const ruleCentresByRuleId = useMemo(() => {
    const grouped = new Map<string, AllocationRuleCentre[]>();
    ruleCentres.forEach((row) => grouped.set(row.rule_id, [...(grouped.get(row.rule_id) || []), row]));
    return grouped;
  }, [ruleCentres]);
  const totalPreview = useMemo(() => preview.reduce((sum, line) => sum + line.allocatedAmount, 0), [preview]);
  const totalProductionPreview = useMemo(() => productionPreview.reduce((sum, line) => sum + line.amount, 0), [productionPreview]);
  const canManageAllocation = !readOnly && canApprove("cost_allocation_manage", user?.role);
  const canPostAllocation = !readOnly && canApprove("cost_allocation_post", user?.role);
  const reportRows = useMemo(() => {
    const grouped = new Map<string, AllocationReportRow>();
    runs
      .filter((run) => run.period === period && run.status === "approved")
      .forEach((run) => {
        const lines = Array.isArray(run.lines) ? run.lines.filter(isAllocationLine) : [];
        lines.forEach((line) => {
          const key = `${line.centreId}:${line.expenseGlAccountId}:${line.basis}`;
          const existing = grouped.get(key);
          if (existing) {
            existing.amount += Number(line.allocatedAmount || 0);
          } else {
            grouped.set(key, {
              key,
              centreName: line.centreName,
              centreType: line.centreType,
              basis: line.basis,
              expenseAccount: line.expenseAccount,
              amount: Number(line.allocatedAmount || 0),
            });
          }
        });
      });
    return Array.from(grouped.values()).sort((a, b) => b.amount - a.amount);
  }, [period, runs]);
  const reportTotalsByType = useMemo(() => {
    const grouped = new Map<string, number>();
    reportRows.forEach((row) => grouped.set(row.centreType, (grouped.get(row.centreType) || 0) + row.amount));
    return Array.from(grouped.entries()).map(([centreType, amount]) => ({ centreType, amount })).sort((a, b) => b.amount - a.amount);
  }, [reportRows]);
  const reportTotal = useMemo(() => reportRows.reduce((sum, row) => sum + row.amount, 0), [reportRows]);

  const loadAll = async () => {
    setLoading(true);
    setMessage("");
    try {
      const [accountsRes, centresRes, driversRes, rulesRes, ruleCentresRes, runsRes, productionRes] = await Promise.all([
        filterByOrganizationId(supabase.from("gl_accounts").select("id,account_code,account_name,account_type").order("account_code"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("cost_allocation_centres").select("*").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("cost_allocation_driver_values").select("*").eq("period", period), orgId, superAdmin),
        filterByOrganizationId(supabase.from("cost_allocation_rules").select("*").order("created_at", { ascending: false }), orgId, superAdmin),
        filterByOrganizationId(supabase.from("cost_allocation_rule_centres").select("*"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("cost_allocation_runs").select("*").order("created_at", { ascending: false }).limit(20), orgId, superAdmin),
        isManufacturing
          ? filterByOrganizationId(
              supabase
                .from("manufacturing_production_entries")
                .select("id,manual_serial_number,product_name,production_date,produced_qty")
                .gte("production_date", monthRange(period).start)
                .lte("production_date", monthRange(period).end)
                .order("production_date", { ascending: true }),
              orgId,
              superAdmin
            )
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (accountsRes.error) throw accountsRes.error;
      if (centresRes.error) throw centresRes.error;
      if (driversRes.error) throw driversRes.error;
      if (rulesRes.error) throw rulesRes.error;
      if (ruleCentresRes.error) throw ruleCentresRes.error;
      if (runsRes.error) throw runsRes.error;
      setAccounts((accountsRes.data || []) as GLAccount[]);
      setCentres((centresRes.data || []) as CostCentre[]);
      setDrivers((driversRes.data || []) as DriverValue[]);
      setRules((rulesRes.data || []) as AllocationRule[]);
      setRuleCentres((ruleCentresRes.data || []) as AllocationRuleCentre[]);
      setRuns((runsRes.data || []) as AllocationRun[]);
      setProductionEntries((productionRes.data || []) as ProductionEntry[]);
      if (isManufacturing && (!productionDebitAccountId || !productionCreditAccountId)) {
        const settings = await resolveJournalAccountSettings(orgId);
        if (!productionDebitAccountId && settings.manufacturing_wip_id) setProductionDebitAccountId(settings.manufacturing_wip_id);
        if (!productionCreditAccountId && settings.manufacturing_overhead_id) setProductionCreditAccountId(settings.manufacturing_overhead_id);
      }
      if (!isManufacturing) setProductionEntries([]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load cost allocation data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [orgId, superAdmin, period]);

  const saveCentre = async () => {
    if (!canManageAllocation || !orgId || !centreName.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("cost_allocation_centres").insert({
      organization_id: orgId,
      code: centreCode.trim() || null,
      name: centreName.trim(),
      centre_type: centreType,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setCentreName("");
    setCentreCode("");
    await loadAll();
  };

  const saveDriver = async () => {
    if (!canManageAllocation || !orgId || !driverCentreId) return;
    setSaving(true);
    const { error } = await supabase.from("cost_allocation_driver_values").upsert(
      {
        organization_id: orgId,
        period,
        cost_centre_id: driverCentreId,
        basis: driverBasis,
        driver_value: Number(driverValue || 0),
      },
      { onConflict: "organization_id,period,cost_centre_id,basis" }
    );
    setSaving(false);
    if (error) return setMessage(error.message);
    setDriverValue("0");
    await loadAll();
  };

  const saveRule = async () => {
    if (!canManageAllocation || !orgId || !ruleName.trim() || !ruleExpenseAccountId || !ruleDebitAccountId || ruleEnabledCentreIds.length === 0) return;
    setSaving(true);
    const { data: rule, error } = await supabase.from("cost_allocation_rules").insert({
      organization_id: orgId,
      name: ruleName.trim(),
      expense_gl_account_id: ruleExpenseAccountId,
      debit_gl_account_id: ruleDebitAccountId,
      target_cost_centre_id: null,
      basis: ruleBasis,
      custom_percentage: null,
    }).select("id").single();
    if (error || !rule) {
      setSaving(false);
      return setMessage(error?.message || "Could not add allocation rule.");
    }
    const enabled = new Set(ruleEnabledCentreIds);
    const { error: centreError } = await supabase.from("cost_allocation_rule_centres").insert(
      centres.map((centre) => ({
        organization_id: orgId,
        rule_id: (rule as { id: string }).id,
        cost_centre_id: centre.id,
        is_enabled: enabled.has(centre.id),
      }))
    );
    setSaving(false);
    if (centreError) return setMessage(centreError.message);
    setRuleName("");
    setRuleExpenseAccountId("");
    setRuleDebitAccountId("");
    setRuleEnabledCentreIds([]);
    await loadAll();
  };

  const calculatePreview = async () => {
    setMessage("");
    setPreview([]);
    if (!orgId || activeRules.length === 0) return;
    const expenseAccountIds = [...new Set(activeRules.map((rule) => rule.expense_gl_account_id))];
    const { start, end } = monthRange(period);
    const { data, error } = await supabase
      .from("journal_entry_lines")
      .select("gl_account_id,debit,credit,journal_entries!inner(entry_date,is_posted,is_deleted,organization_id)")
      .in("gl_account_id", expenseAccountIds)
      .eq("journal_entries.organization_id", orgId)
      .eq("journal_entries.is_posted", true)
      .eq("journal_entries.is_deleted", false)
      .gte("journal_entries.entry_date", start)
      .lte("journal_entries.entry_date", end);
    if (error) return setMessage(error.message);
    const balances = new Map<string, number>();
    ((data || []) as Array<{ gl_account_id: string; debit: number | null; credit: number | null }>).forEach((line) => {
      balances.set(line.gl_account_id, (balances.get(line.gl_account_id) || 0) + Number(line.debit || 0) - Number(line.credit || 0));
    });
    const driverMap = new Map(drivers.map((driver) => [`${driver.cost_centre_id}:${driver.basis}`, Number(driver.driver_value || 0)]));
    const next: AllocationLine[] = [];
    activeRules.forEach((rule) => {
      const sourceAmount = Math.max(0, balances.get(rule.expense_gl_account_id) || 0);
      const configuredCentres = ruleCentresByRuleId.get(rule.id) || [];
      const enabledCentreIds = configuredCentres.length > 0
        ? configuredCentres.filter((row) => row.is_enabled).map((row) => row.cost_centre_id)
        : rule.target_cost_centre_id ? [rule.target_cost_centre_id] : [];
      const denominator = enabledCentreIds.reduce((sum, centreId) => sum + (driverMap.get(`${centreId}:${rule.basis}`) || 0), 0);
      enabledCentreIds.forEach((centreId) => {
        const centre = centreById.get(centreId);
        const expenseAccount = accountById.get(rule.expense_gl_account_id);
        const debitAccount = accountById.get(rule.debit_gl_account_id);
        const driver = driverMap.get(`${centreId}:${rule.basis}`) || 0;
        const allocatedAmount = denominator > 0 ? sourceAmount * driver / denominator : 0;
        if (allocatedAmount <= 0) return;
        next.push({
          ruleId: rule.id,
          ruleName: rule.name,
          centreId,
          centreName: centre?.name || "Cost centre",
          centreType: centre?.centre_type || "other",
          basis: rule.basis,
          expenseGlAccountId: rule.expense_gl_account_id,
          expenseAccount: accountLabel(expenseAccount),
          debitGlAccountId: rule.debit_gl_account_id,
          debitAccount: accountLabel(debitAccount),
          driverValue: driver,
          denominator,
          sourceAmount,
          allocatedAmount: Math.round(allocatedAmount * 100) / 100,
        });
      });
    });
    setPreview(next);
    if (next.length === 0) setMessage("No allocation amounts found. Check posted expense journals, rules, and driver values for this month.");
  };

  const approveRun = async () => {
    if (!canPostAllocation || !orgId || preview.length === 0) return;
    setSaving(true);
    setMessage("");
    const total = Math.round(totalPreview * 100) / 100;
    const { data: run, error: runError } = await supabase
      .from("cost_allocation_runs")
      .insert({
        organization_id: orgId,
        period,
        status: "draft",
        total_amount: total,
        lines: preview,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (runError || !run) {
      setSaving(false);
      return setMessage(runError?.message || "Could not create allocation run.");
    }
    const journal = await createJournalEntry({
      entry_date: `${period}-01`,
      description: `Cost allocation run (${period})`,
      reference_type: "cost_allocation",
      reference_id: (run as { id: string }).id,
      created_by: user?.id ?? null,
      organizationId: orgId,
      lines: preview.flatMap((line) => [
        {
          gl_account_id: line.debitGlAccountId,
          debit: line.allocatedAmount,
          credit: 0,
          line_description: `${line.centreName} - ${line.ruleName}`,
          dimensions: { cost_centre_id: line.centreId, cost_centre_type: line.centreType },
        },
        {
          gl_account_id: line.expenseGlAccountId,
          debit: 0,
          credit: line.allocatedAmount,
          line_description: `${line.expenseAccount} allocated to ${line.centreName}`,
          dimensions: { cost_centre_id: line.centreId, cost_centre_type: line.centreType },
        },
      ]),
    });
    if (!journal.ok) {
      setSaving(false);
      return setMessage(journal.error);
    }
    await supabase
      .from("cost_allocation_runs")
      .update({ status: "approved", journal_entry_id: journal.journalId, approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
      .eq("id", (run as { id: string }).id);
    setSaving(false);
    setPreview([]);
    setMessage("Allocation approved and journal posted.");
    await loadAll();
  };

  const reverseRun = async (run: AllocationRun) => {
    if (!canPostAllocation || !orgId || run.status !== "approved") return;
    if (!confirm("Reverse this allocation run with an equal and opposite journal?")) return;
    const lines = Array.isArray(run.lines) ? run.lines as AllocationLine[] : [];
    const journal = await createJournalEntry({
      entry_date: `${run.period}-01`,
      description: `Reverse cost allocation run (${run.period})`,
      reference_type: "cost_allocation",
      reference_id: run.id,
      created_by: user?.id ?? null,
      organizationId: orgId,
      lines: lines.flatMap((line) => [
        { gl_account_id: line.debitGlAccountId, debit: 0, credit: line.allocatedAmount, line_description: `Reverse ${line.centreName} - ${line.ruleName}` },
        { gl_account_id: line.expenseGlAccountId, debit: line.allocatedAmount, credit: 0, line_description: `Reverse allocation from ${line.centreName}` },
      ]),
    });
    if (!journal.ok) return setMessage(journal.error);
    await supabase.from("cost_allocation_runs").update({
      status: "reversed",
      reversal_journal_entry_id: journal.journalId,
      reversed_at: new Date().toISOString(),
    }).eq("id", run.id);
    setMessage("Allocation run reversed.");
    await loadAll();
  };

  const calculateProductionPreview = () => {
    const amount = Number(productionOverheadAmount || 0);
    const denominator = productionEntries.reduce((sum, entry) => sum + Number(entry.produced_qty || 0), 0);
    if (amount <= 0 || denominator <= 0) {
      setProductionPreview([]);
      setMessage("Enter an overhead amount and make sure this month has production entries with produced quantity.");
      return;
    }
    setProductionPreview(productionEntries.map((entry) => {
      const basisValue = Number(entry.produced_qty || 0);
      return {
        productionEntryId: entry.id,
        label: `${entry.manual_serial_number || entry.id.slice(0, 8)} - ${entry.product_name || "Product"}`,
        basisValue,
        amount: Math.round((amount * basisValue / denominator) * 100) / 100,
      };
    }).filter((line) => line.amount > 0));
  };

  const postProductionOverhead = async () => {
    if (!canPostAllocation || !orgId || productionPreview.length === 0 || !productionDebitAccountId || !productionCreditAccountId) return;
    const total = Math.round(totalProductionPreview * 100) / 100;
    const { data: run, error: runError } = await supabase
      .from("cost_allocation_runs")
      .insert({
        organization_id: orgId,
        period,
        status: "draft",
        total_amount: total,
        lines: productionPreview,
        created_by: user?.id ?? null,
      })
      .select("id")
      .single();
    if (runError || !run) return setMessage(runError?.message || "Could not create production overhead run.");
    const runId = (run as { id: string }).id;
    const journal = await createJournalEntry({
      entry_date: `${period}-01`,
      description: `Production overhead allocation (${period})`,
      reference_type: "cost_allocation",
      reference_id: runId,
      created_by: user?.id ?? null,
      organizationId: orgId,
      lines: [
        ...productionPreview.map((line) => ({
          gl_account_id: productionDebitAccountId,
          debit: line.amount,
          credit: 0,
          line_description: `${line.label} - overhead to WIP`,
          dimensions: { production_entry_id: line.productionEntryId },
        })),
        {
          gl_account_id: productionCreditAccountId,
          debit: 0,
          credit: total,
          line_description: "Production overhead pool allocated",
        },
      ],
    });
    if (!journal.ok) return setMessage(journal.error);
    await supabase.from("cost_allocation_runs").update({
      status: "approved",
      journal_entry_id: journal.journalId,
      approved_by: user?.id ?? null,
      approved_at: new Date().toISOString(),
    }).eq("id", runId);
    await supabase.from("cost_allocation_production_batches").insert(productionPreview.map((line) => ({
      organization_id: orgId,
      run_id: runId,
      period,
      production_entry_id: line.productionEntryId,
      basis: "produced_qty",
      basis_value: line.basisValue,
      allocated_amount: line.amount,
      journal_entry_id: journal.journalId,
    })));
    setProductionPreview([]);
    setProductionOverheadAmount("0");
    setMessage("Production overhead allocated to batches and posted.");
    await loadAll();
  };

  const toggleNewRuleCentre = (centreId: string) => {
    setRuleEnabledCentreIds((current) =>
      current.includes(centreId) ? current.filter((id) => id !== centreId) : [...current, centreId]
    );
  };

  const setRuleCentreEnabled = async (rule: AllocationRule, centreId: string, isEnabled: boolean) => {
    if (!canManageAllocation || !orgId) return;
    const existing = (ruleCentresByRuleId.get(rule.id) || []).find((row) => row.cost_centre_id === centreId);
    if (existing) {
      const { error } = await supabase
        .from("cost_allocation_rule_centres")
        .update({ is_enabled: isEnabled })
        .eq("id", existing.id);
      if (error) return setMessage(error.message);
    } else {
      const { error } = await supabase.from("cost_allocation_rule_centres").insert({
        organization_id: orgId,
        rule_id: rule.id,
        cost_centre_id: centreId,
        is_enabled: isEnabled,
      });
      if (error) return setMessage(error.message);
    }
    await loadAll();
  };

  const accountOptions = (type?: string) => accounts.filter((account) => !type || account.account_type === type);
  const exportReportCsv = () => {
    const header = ["Period", "Centre", "Type", "Basis", "Expense Account", "Amount"];
    const rows = reportRows.map((row) => [
      period,
      row.centreName,
      row.centreType,
      BASES.find((basis) => basis.value === row.basis)?.label || row.basis,
      row.expenseAccount,
      row.amount.toFixed(2),
    ]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `cost-allocation-report-${period}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-6">Loading cost allocation...</div>;

  return (
    <div className="p-6 md:p-8 space-y-6">
      {readOnly && <ReadOnlyNotice />}
      {!canManageAllocation || !canPostAllocation ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <ShieldCheck className="h-4 w-4 text-slate-500" />
          <span>
            {canManageAllocation ? "Setup enabled." : "Setup is view-only for your role."} {canPostAllocation ? "Posting enabled." : "Posting and reversals require cost allocation post permission."}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Cost Allocation</h1>
          <PageNotes ariaLabel="Cost allocation help">
            <p>Define cost centres, monthly drivers, allocation rules, then preview and approve monthly journals. Production overhead can also be pushed to individual production batches.</p>
          </PageNotes>
        </div>
        <label className="text-sm text-slate-700">Period <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="ml-2 rounded-lg border border-slate-300 px-3 py-2" /></label>
      </div>
      {message ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Cost Centres</h2>
          <div className="grid gap-2 md:grid-cols-4">
            <input value={centreCode} onChange={(e) => setCentreCode(e.target.value)} placeholder="Code" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input value={centreName} onChange={(e) => setCentreName(e.target.value)} placeholder="Cost centre name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
            <select value={centreType} onChange={(e) => setCentreType(e.target.value as CentreType)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {CENTRE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
          </div>
          <button type="button" onClick={saveCentre} disabled={!canManageAllocation || saving} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />Save centre</button>
          <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm"><tbody>{centres.map((centre) => <tr key={centre.id} className="border-b last:border-b-0"><td className="p-2 font-medium">{centre.code || "-"}</td><td className="p-2">{centre.name}</td><td className="p-2 capitalize">{centre.centre_type}</td></tr>)}</tbody></table>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Driver Actuals by Cost Centre</h2>
          <div className="grid gap-2 md:grid-cols-4">
            <select value={driverCentreId} onChange={(e) => setDriverCentreId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Cost centre...</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}
            </select>
            <select value={driverBasis} onChange={(e) => setDriverBasis(e.target.value as Basis)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {BASES.map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
            </select>
            <input type="number" min="0" step="0.01" value={driverValue} onChange={(e) => setDriverValue(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="button" onClick={saveDriver} disabled={!canManageAllocation || saving} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Save driver</button>
          </div>
          <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm"><tbody>{drivers.map((driver) => <tr key={driver.id} className="border-b last:border-b-0"><td className="p-2">{centreById.get(driver.cost_centre_id)?.name}</td><td className="p-2">{BASES.find((basis) => basis.value === driver.basis)?.label}</td><td className="p-2 text-right">{fmt(Number(driver.driver_value))}</td></tr>)}</tbody></table>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Allocation Rules</h2>
        <div className="grid gap-2 lg:grid-cols-4">
          <input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="Rule name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <select value={ruleExpenseAccountId} onChange={(e) => setRuleExpenseAccountId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Expense account...</option>{accountOptions("expense").map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
          <select value={ruleDebitAccountId} onChange={(e) => setRuleDebitAccountId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Charge/WIP account...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
          </select>
          <select value={ruleBasis} onChange={(e) => setRuleBasis(e.target.value as Basis)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {BASES.map((basis) => <option key={basis.value} value={basis.value}>{basis.label}</option>)}
          </select>
        </div>
        <div className="mt-3 rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">Participating cost centres for this expense</p>
            <button type="button" onClick={() => setRuleEnabledCentreIds(centres.map((centre) => centre.id))} className="text-xs font-semibold text-brand-700">Select all</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {centres.map((centre) => (
              <label key={centre.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm ${ruleEnabledCentreIds.includes(centre.id) ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                <input type="checkbox" checked={ruleEnabledCentreIds.includes(centre.id)} onChange={() => toggleNewRuleCentre(centre.id)} disabled={!canManageAllocation} />
                <span>{centre.name}</span>
              </label>
            ))}
          </div>
        </div>
        <button type="button" onClick={saveRule} disabled={!canManageAllocation || saving} className="mt-3 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add rule</button>
        <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Rule</th><th className="p-2 text-left">Expense</th><th className="p-2 text-left">Debit</th><th className="p-2 text-left">Driver</th><th className="p-2 text-left">Cost centres</th></tr></thead><tbody>{rules.map((rule) => {
            const configured = ruleCentresByRuleId.get(rule.id) || [];
            const enabled = new Set(configured.filter((row) => row.is_enabled).map((row) => row.cost_centre_id));
            if (configured.length === 0 && rule.target_cost_centre_id) enabled.add(rule.target_cost_centre_id);
            return (
              <tr key={rule.id} className="border-t align-top">
                <td className="p-2">{rule.name}</td>
                <td className="p-2">{accountLabel(accountById.get(rule.expense_gl_account_id))}</td>
                <td className="p-2">{accountLabel(accountById.get(rule.debit_gl_account_id))}</td>
                <td className="p-2">{BASES.find((basis) => basis.value === rule.basis)?.label}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {centres.map((centre) => (
                      <label key={`${rule.id}:${centre.id}`} className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${enabled.has(centre.id) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                        <input type="checkbox" checked={enabled.has(centre.id)} disabled={!canManageAllocation} onChange={(event) => void setRuleCentreEnabled(rule, centre.id, event.target.checked)} />
                        {centre.name}
                      </label>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}</tbody></table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Allocation Run</h2>
          <div className="flex gap-2">
            <button type="button" onClick={calculatePreview} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"><Calculator className="h-4 w-4" />Calculate</button>
            <button type="button" onClick={approveRun} disabled={!canPostAllocation || preview.length === 0 || saving} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Approve & post</button>
          </div>
        </div>
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Centre</th><th className="p-2 text-left">Expense</th><th className="p-2 text-left">Debit account</th><th className="p-2 text-right">Driver</th><th className="p-2 text-right">Source</th><th className="p-2 text-right">Allocated</th></tr></thead><tbody>{preview.map((line, index) => <tr key={`${line.ruleId}-${index}`} className="border-t"><td className="p-2">{line.centreName}</td><td className="p-2">{line.expenseAccount}</td><td className="p-2">{line.debitAccount}</td><td className="p-2 text-right">{fmt(line.driverValue)}</td><td className="p-2 text-right">{fmt(line.sourceAmount)}</td><td className="p-2 text-right font-semibold">{fmt(line.allocatedAmount)}</td></tr>)}{preview.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No preview yet.</td></tr>}<tr className="border-t bg-slate-50 font-semibold"><td colSpan={5} className="p-2 text-right">Total</td><td className="p-2 text-right">{fmt(totalPreview)}</td></tr></tbody></table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-slate-900"><BarChart3 className="h-5 w-5" />Reports</h2>
          <button type="button" onClick={exportReportCsv} disabled={reportRows.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Export CSV</button>
        </div>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">Approved allocations</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{fmt(reportTotal)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">Allocated lines</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{reportRows.length}</p>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">Top centre type</p>
            <p className="mt-1 text-2xl font-semibold capitalize text-slate-900">{reportTotalsByType[0]?.centreType || "-"}</p>
          </div>
        </div>
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50"><tr><th className="p-2 text-left">Centre</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Basis</th><th className="p-2 text-left">Expense</th><th className="p-2 text-right">Amount</th></tr></thead>
            <tbody>
              {reportRows.map((row) => (
                <tr key={row.key} className="border-t"><td className="p-2">{row.centreName}</td><td className="p-2 capitalize">{row.centreType}</td><td className="p-2">{BASES.find((basis) => basis.value === row.basis)?.label}</td><td className="p-2">{row.expenseAccount}</td><td className="p-2 text-right font-semibold">{fmt(row.amount)}</td></tr>
              ))}
              {reportRows.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">No approved allocation report lines for this period.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {isManufacturing ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Production Overhead Allocation</h2>
          <div className="grid gap-2 lg:grid-cols-4">
            <input type="number" min="0" step="0.01" value={productionOverheadAmount} onChange={(e) => setProductionOverheadAmount(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Overhead pool amount" />
            <select value={productionDebitAccountId} onChange={(e) => setProductionDebitAccountId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Debit WIP account...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
            </select>
            <select value={productionCreditAccountId} onChange={(e) => setProductionCreditAccountId(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Credit overhead account...</option>{accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
            </select>
            <div className="flex gap-2"><button type="button" onClick={calculateProductionPreview} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Preview batches</button><button type="button" onClick={postProductionOverhead} disabled={!canPostAllocation || productionPreview.length === 0} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Post</button></div>
          </div>
          <div className="mt-4 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Batch</th><th className="p-2 text-right">Produced qty</th><th className="p-2 text-right">Allocated overhead</th></tr></thead><tbody>{productionPreview.map((line) => <tr key={line.productionEntryId} className="border-t"><td className="p-2">{line.label}</td><td className="p-2 text-right">{fmt(line.basisValue)}</td><td className="p-2 text-right">{fmt(line.amount)}</td></tr>)}{productionPreview.length === 0 && <tr><td colSpan={3} className="p-6 text-center text-slate-500">No production overhead preview yet.</td></tr>}<tr className="border-t bg-slate-50 font-semibold"><td colSpan={2} className="p-2 text-right">Total</td><td className="p-2 text-right">{fmt(totalProductionPreview)}</td></tr></tbody></table>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Runs</h2>
        <div className="overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-2 text-left">Period</th><th className="p-2 text-left">Status</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Created</th><th className="p-2 text-right">Action</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id} className="border-t"><td className="p-2">{run.period}</td><td className="p-2 capitalize">{run.status}</td><td className="p-2 text-right">{fmt(Number(run.total_amount || 0))}</td><td className="p-2">{String(run.created_at || "").slice(0, 10)}</td><td className="p-2 text-right">{run.status === "approved" ? <button type="button" onClick={() => void reverseRun(run)} disabled={!canPostAllocation} className="inline-flex items-center gap-1 rounded border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />Reverse</button> : null}</td></tr>)}</tbody></table>
        </div>
      </section>
    </div>
  );
}
