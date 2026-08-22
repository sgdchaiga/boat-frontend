import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronRight, CircleDollarSign, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";
import { filterGlAccountsForBusinessType } from "@/lib/glAccountBusinessScope";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { budgetPeriodRange, budgetVariance, frequencyPeriodMultiplier, netJournalActivity } from "@/lib/budgetActuals";
import { randomUuid } from "@/lib/randomUuid";
import { canApprove } from "@/lib/permissions";
import { SchoolBudgetDriversPanel } from "@/components/accounting/SchoolBudgetDriversPanel";
import { STANDARD_SCHOOL_BUDGET_LINES, standardSchoolBudgetLineRows } from "@/lib/schoolBudgetLines";

type BudgetRow = {
  id: string;
  name: string;
  period_label: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  is_active: boolean;
  financial_year: number | null;
  period_mode: string;
  status: "draft" | "submitted" | "reviewed" | "approved" | "active" | "revised" | "closed";
  version_no: number;
  submitted_by: string | null;
};

type LineRow = {
  id: string;
  budget_id: string;
  gl_account_id: string | null;
  line_label: string;
  amount: number;
  sort_order: number;
  unit: string | null;
  frequency: string | null;
  quantity: number | null;
  unit_price: number | null;
  department_id: string | null;
  budget_type: string;
  term_1_amount: number;
  term_2_amount: number;
  term_3_amount: number;
  annual_other_amount: number;
  assumptions: string | null;
  gl_accounts?: { account_code: string; account_name: string } | null;
};

type DepartmentPick = { id: string; name: string };
type WorkflowRow = { id: string; from_status: string | null; to_status: string; note: string | null; acted_at: string; acted_by: string | null };

const BUDGET_FREQUENCIES = [
  { value: "one_time", label: "One-time" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "annual", label: "Annual" },
] as const;

function computeLineBudgetAmount(
  budget: BudgetRow,
  quantity: number | null | undefined,
  unitPrice: number | null | undefined,
  frequency: string | null | undefined
): number | null {
  const q = quantity == null ? NaN : Number(quantity);
  const p = unitPrice == null ? NaN : Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p) || q < 0 || p < 0) return null;
  const mult = frequencyPeriodMultiplier(budget, frequency);
  return q * p * mult;
}

function isTempLineId(id: string) {
  return id.startsWith("temp-");
}

function cloneLine(l: LineRow): LineRow {
  return { ...l, gl_accounts: l.gl_accounts ? { ...l.gl_accounts } : null };
}

function lineRowChanged(a: LineRow, b: LineRow) {
  return (
    a.line_label !== b.line_label ||
    a.gl_account_id !== b.gl_account_id ||
    Number(a.amount) !== Number(b.amount) ||
    (a.unit ?? null) !== (b.unit ?? null) ||
    (a.frequency ?? "one_time") !== (b.frequency ?? "one_time") ||
    (a.quantity ?? null) !== (b.quantity ?? null) ||
    (a.unit_price ?? null) !== (b.unit_price ?? null)
    || a.department_id !== b.department_id
    || a.budget_type !== b.budget_type
    || Number(a.term_1_amount) !== Number(b.term_1_amount)
    || Number(a.term_2_amount) !== Number(b.term_2_amount)
    || Number(a.term_3_amount) !== Number(b.term_3_amount)
    || Number(a.annual_other_amount) !== Number(b.annual_other_amount)
    || (a.assumptions ?? null) !== (b.assumptions ?? null)
  );
}

type GLPick = { id: string; account_code: string; account_name: string; account_type: string };

type Props = { readOnly?: boolean };

export function BudgetingPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const canPrepareBudget = canApprove("budget_prepare", user?.role);
  const canReviewBudget = canApprove("budget_review", user?.role);
  const canApproveBudget = canApprove("budget_approve", user?.role);
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [accounts, setAccounts] = useState<GLPick[]>([]);
  const [departments, setDepartments] = useState<DepartmentPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [linesLoading, setLinesLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newBudget, setNewBudget] = useState({ name: "", financial_year: String(new Date().getFullYear()), start_date: "", end_date: "", notes: "" });
  const [draftLine, setDraftLine] = useState({
    gl_account_id: "",
    line_label: "",
    unit: "",
    frequency: "one_time",
    quantity: "",
    unit_price: "",
    amount: "",
    department_id: "",
    budget_type: "operating_expense",
    term_1_amount: "",
    term_2_amount: "",
    term_3_amount: "",
    annual_other_amount: "",
    assumptions: "",
  });
  const [actualByGlId, setActualByGlId] = useState<Map<string, number>>(new Map());
  const [actualsLoading, setActualsLoading] = useState(false);
  /** When true, line edits are local until Save budget. */
  const [editingLines, setEditingLines] = useState(false);
  const [editedLines, setEditedLines] = useState<LineRow[]>([]);
  const [baselineLines, setBaselineLines] = useState<LineRow[]>([]);
  const [linesSaving, setLinesSaving] = useState(false);
  const [workflowHistory, setWorkflowHistory] = useState<WorkflowRow[]>([]);
  const [showCreateBudget, setShowCreateBudget] = useState(false);
  const [addingStandardLines, setAddingStandardLines] = useState(false);

  const loadBudgets = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("budgets")
      .select("id,name,period_label,start_date,end_date,notes,is_active,financial_year,period_mode,status,version_no,submitted_by")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    setErr(error?.message ?? null);
    setBudgets((data as BudgetRow[]) || []);
    setLoading(false);
  }, [orgId]);

  const loadAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("gl_accounts")
      .select("*")
      .order("account_code");
    const normalized = filterGlAccountsForBusinessType(normalizeGlAccountRows((data || []) as unknown[]), user?.business_type).filter((row) => row.is_active);
    setAccounts(normalized as GLPick[]);
  }, [user?.business_type]);

  const loadDepartments = useCallback(async () => {
    if (!orgId) return setDepartments([]);
    const { data } = await supabase.from("departments").select("id,name").eq("organization_id", orgId).order("name");
    setDepartments((data as DepartmentPick[]) || []);
  }, [orgId]);

  const accountTypeById = useMemo(() => new Map(accounts.map((a) => [a.id, a.account_type])), [accounts]);

  const loadLines = useCallback(
    async (budgetId: string) => {
      setLinesLoading(true);
      const { data, error } = await supabase
        .from("budget_lines")
        .select(
          "id,budget_id,gl_account_id,line_label,amount,sort_order,unit,frequency,quantity,unit_price,department_id,budget_type,term_1_amount,term_2_amount,term_3_amount,annual_other_amount,assumptions,gl_accounts(account_code,account_name)"
        )
        .eq("budget_id", budgetId)
        .order("sort_order", { ascending: true })
        .order("id", { ascending: true });
      setErr(error?.message ?? null);
      const rows = (data as LineRow[]) || [];
      setLines(
        rows.map((l) => ({
          ...l,
          unit: l.unit ?? null,
          frequency: l.frequency ?? "one_time",
          quantity: l.quantity ?? null,
          unit_price: l.unit_price ?? null,
          department_id: l.department_id ?? null,
          budget_type: l.budget_type ?? "operating_expense",
          term_1_amount: Number(l.term_1_amount ?? 0),
          term_2_amount: Number(l.term_2_amount ?? 0),
          term_3_amount: Number(l.term_3_amount ?? 0),
          annual_other_amount: Number(l.annual_other_amount ?? 0),
          assumptions: l.assumptions ?? null,
        }))
      );
      setLinesLoading(false);
    },
    []
  );

  const loadWorkflowHistory = useCallback(async (budgetId: string) => {
    const { data } = await supabase.from("budget_workflow_history")
      .select("id,from_status,to_status,note,acted_at,acted_by")
      .eq("budget_id", budgetId).order("acted_at", { ascending: false });
    setWorkflowHistory((data as WorkflowRow[]) || []);
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);
  useEffect(() => { void loadDepartments(); }, [loadDepartments]);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  useEffect(() => {
    if (loading || selectedId || budgets.length === 0) return;
    const activeBudget = budgets.find((budget) => budget.status === "active");
    const approvedBudgets = budgets.filter((budget) => budget.status === "approved");
    if (activeBudget) setSelectedId(activeBudget.id);
    else if (approvedBudgets.length === 1) setSelectedId(approvedBudgets[0].id);
  }, [budgets, loading, selectedId]);

  useEffect(() => {
    if (selectedId) { void loadLines(selectedId); void loadWorkflowHistory(selectedId); }
    else { setLines([]); setWorkflowHistory([]); }
  }, [selectedId, loadLines, loadWorkflowHistory]);

  useEffect(() => {
    setEditingLines(false);
    setEditedLines([]);
    setBaselineLines([]);
  }, [selectedId]);

  const selectedBudget = useMemo(() => budgets.find((b) => b.id === selectedId), [budgets, selectedId]);

  const linesForCalcs = useMemo(() => (editingLines ? editedLines : lines), [editingLines, editedLines, lines]);

  const lineTotal = useMemo(() => linesForCalcs.reduce((s, l) => s + Number(l.amount ?? 0), 0), [linesForCalcs]);
  const budgetSummary = useMemo(() => {
    const income = linesForCalcs.filter((l) => l.budget_type === "income").reduce((s,l) => s + Number(l.amount || 0), 0);
    const expenditure = linesForCalcs.filter((l) => l.budget_type !== "income").reduce((s,l) => s + Number(l.amount || 0), 0);
    const terms = ["term_1_amount","term_2_amount","term_3_amount","annual_other_amount"].map((key) => linesForCalcs.reduce((s,l) => s + Number(l[key as keyof LineRow] || 0), 0));
    const departmentTotals = new Map<string,number>();
    for (const line of linesForCalcs) { const key=line.department_id || "central"; departmentTotals.set(key,(departmentTotals.get(key)||0)+Number(line.amount||0)); }
    return { income, expenditure, net: income-expenditure, terms, departmentTotals };
  }, [linesForCalcs]);

  const loadActuals = useCallback(async () => {
    if (!orgId || !selectedBudget || linesForCalcs.length === 0) {
      setActualByGlId(new Map());
      return;
    }
    const glIds = [...new Set(linesForCalcs.map((l) => l.gl_account_id).filter(Boolean))] as string[];
    if (glIds.length === 0) {
      setActualByGlId(new Map());
      return;
    }
    setActualsLoading(true);
    const { from: fromStr, to: toStr } = budgetPeriodRange(selectedBudget);
    try {
      const entryIds: string[] = [];
      const pageSize = 1000;
      let offset = 0;
      for (;;) {
        const { data: batch, error: e1 } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("organization_id", orgId)
          .gte("entry_date", fromStr)
          .lte("entry_date", toStr)
          .order("entry_date", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (e1) throw e1;
        const rows = (batch || []) as { id: string }[];
        if (rows.length === 0) break;
        entryIds.push(...rows.map((r) => r.id));
        if (rows.length < pageSize) break;
        offset += pageSize;
      }

      const totals = new Map<string, number>();
      for (const gid of glIds) totals.set(gid, 0);

      const chunk = 150;
      for (let i = 0; i < entryIds.length; i += chunk) {
        const ids = entryIds.slice(i, i + chunk);
        const { data: jels, error: e2 } = await supabase
          .from("journal_entry_lines")
          .select("gl_account_id, debit, credit")
          .in("journal_entry_id", ids)
          .in("gl_account_id", glIds);
        if (e2) throw e2;
        for (const row of jels || []) {
          const r = row as { gl_account_id: string; debit?: number; credit?: number };
          const at = accountTypeById.get(r.gl_account_id) || "expense";
          const net = netJournalActivity(Number(r.debit ?? 0), Number(r.credit ?? 0), at);
          totals.set(r.gl_account_id, (totals.get(r.gl_account_id) || 0) + net);
        }
      }
      setActualByGlId(totals);
    } catch (e) {
      console.error("Budget actuals load failed:", e);
      setActualByGlId(new Map());
    } finally {
      setActualsLoading(false);
    }
  }, [orgId, selectedBudget, linesForCalcs, accountTypeById]);

  useEffect(() => {
    if (linesLoading || !selectedBudget) return;
    loadActuals();
  }, [linesForCalcs, linesLoading, selectedBudget, loadActuals]);

  /** Sum of budget amounts per GL (for splitting account-level actual across lines). */
  const budgetSumByGl = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linesForCalcs) {
      if (!l.gl_account_id) continue;
      const g = l.gl_account_id;
      m.set(g, (m.get(g) || 0) + Number(l.amount ?? 0));
    }
    return m;
  }, [linesForCalcs]);

  /** Per budget line: proportional share of GL net activity when multiple lines use the same account. */
  const lineActualDisplay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linesForCalcs) {
      if (!l.gl_account_id) {
        m.set(l.id, 0);
        continue;
      }
      const total = actualByGlId.get(l.gl_account_id) ?? 0;
      const share = budgetSumByGl.get(l.gl_account_id) ?? 0;
      const amt = Number(l.amount ?? 0);
      if (share <= 0) {
        m.set(l.id, 0);
        continue;
      }
      m.set(l.id, (amt / share) * total);
    }
    return m;
  }, [linesForCalcs, actualByGlId, budgetSumByGl]);

  const amountSpent = useMemo(() => [...lineActualDisplay.values()].reduce((sum, amount) => sum + amount, 0), [lineActualDisplay]);
  const availableBalance = lineTotal - amountSpent;
  const utilisation = lineTotal > 0 ? (amountSpent / lineTotal) * 100 : 0;

  const lineVariance = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linesForCalcs) {
      if (!l.gl_account_id) {
        m.set(l.id, 0);
        continue;
      }
      const at = accountTypeById.get(l.gl_account_id) || "expense";
      const bud = Number(l.amount ?? 0);
      const act = lineActualDisplay.get(l.id) ?? 0;
      m.set(l.id, budgetVariance(bud, act, at));
    }
    return m;
  }, [linesForCalcs, lineActualDisplay, accountTypeById]);

  const sumActualDisplay = useMemo(
    () => [...lineActualDisplay.values()].reduce((a, b) => a + b, 0),
    [lineActualDisplay]
  );
  const sumVariance = useMemo(() => [...lineVariance.values()].reduce((a, b) => a + b, 0), [lineVariance]);

  const periodHint = useMemo(() => {
    if (!selectedBudget) return "";
    const { from, to } = budgetPeriodRange(selectedBudget);
    return `${from} → ${to}`;
  }, [selectedBudget]);

  const draftComputedAmount = useMemo(() => {
    if (!selectedBudget) return null;
    const q = draftLine.quantity.trim() === "" ? null : Number(draftLine.quantity);
    const p = draftLine.unit_price.trim() === "" ? null : Number(draftLine.unit_price);
    if (q == null || p == null || !Number.isFinite(q) || !Number.isFinite(p) || q < 0 || p < 0) return null;
    return computeLineBudgetAmount(selectedBudget, q, p, draftLine.frequency);
  }, [selectedBudget, draftLine.quantity, draftLine.unit_price, draftLine.frequency]);

  const hasUnsavedLineChanges = useMemo(() => {
    if (!editingLines) return false;
    if (editedLines.length !== baselineLines.length) return true;
    const byId = new Map(baselineLines.map((l) => [l.id, l]));
    for (const el of editedLines) {
      const bl = byId.get(el.id);
      if (!bl) return true;
      if (lineRowChanged(bl, el)) return true;
    }
    return false;
  }, [editingLines, editedLines, baselineLines]);

  const beginEditLines = () => {
    if (readOnly || !selectedId || linesLoading || !selectedBudget || !["draft", "submitted", "reviewed"].includes(selectedBudget.status)) return;
    const snapshot = lines.map(cloneLine);
    setBaselineLines(snapshot);
    setEditedLines(snapshot);
    setEditingLines(true);
    setErr(null);
  };

  const cancelEditLines = () => {
    if (linesSaving) return;
    if (hasUnsavedLineChanges && !confirm("Discard unsaved changes to budget lines?")) return;
    setEditingLines(false);
    setEditedLines([]);
    setBaselineLines([]);
  };

  const updateEditedLine = (lineId: string, patch: Partial<LineRow>) => {
    if (!selectedBudget) return;
    setEditedLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        let next: LineRow = { ...l, ...patch };
        if (
          patch.amount === undefined &&
          (patch.quantity !== undefined || patch.unit_price !== undefined || patch.frequency !== undefined)
        ) {
          const c = computeLineBudgetAmount(selectedBudget, next.quantity, next.unit_price, next.frequency);
          if (c != null) next = { ...next, amount: c };
        }
        return next;
      })
    );
  };

  const addLineToDraft = () => {
    if (!editingLines || !selectedId || !selectedBudget) return;
    const label = draftLine.line_label.trim();
    if (!label) {
      setErr("Line description is required.");
      return;
    }
    const qtyParsed = draftLine.quantity.trim() === "" ? null : Number(draftLine.quantity);
    const priceParsed = draftLine.unit_price.trim() === "" ? null : Number(draftLine.unit_price);
    const fromDetail =
      qtyParsed != null &&
      priceParsed != null &&
      Number.isFinite(qtyParsed) &&
      Number.isFinite(priceParsed) &&
      qtyParsed >= 0 &&
      priceParsed >= 0
        ? computeLineBudgetAmount(selectedBudget, qtyParsed, priceParsed, draftLine.frequency)
        : null;
    const amtManual = Number(draftLine.amount);
    const terms = [draftLine.term_1_amount, draftLine.term_2_amount, draftLine.term_3_amount, draftLine.annual_other_amount]
      .map((value) => value.trim() === "" ? 0 : Number(value));
    const hasTerms = terms.some((value) => value > 0);
    const termTotal = terms.reduce((sum, value) => sum + value, 0);
    const amt = hasTerms ? termTotal : fromDetail != null ? fromDetail : amtManual;
    if (!Number.isFinite(amt) || amt < 0) {
      setErr("Enter quantity and unit price, or a valid budget amount (0 or more).");
      return;
    }
    setErr(null);
    const nextOrder = editedLines.length > 0 ? Math.max(...editedLines.map((l) => l.sort_order), 0) + 1 : 0;
    const glId = draftLine.gl_account_id || null;
    const g = glId ? accounts.find((a) => a.id === glId) : null;
    const newRow: LineRow = {
      id: `temp-${randomUuid()}`,
      budget_id: selectedId,
      gl_account_id: glId,
      line_label: label,
      amount: amt,
      sort_order: nextOrder,
      unit: draftLine.unit.trim() || null,
      frequency: draftLine.frequency || "one_time",
      quantity: qtyParsed != null && Number.isFinite(qtyParsed) ? qtyParsed : null,
      unit_price: priceParsed != null && Number.isFinite(priceParsed) ? priceParsed : null,
      department_id: draftLine.department_id || null,
      budget_type: draftLine.budget_type,
      term_1_amount: hasTerms ? terms[0] : 0,
      term_2_amount: hasTerms ? terms[1] : 0,
      term_3_amount: hasTerms ? terms[2] : 0,
      annual_other_amount: hasTerms ? terms[3] : amt,
      assumptions: draftLine.assumptions.trim() || null,
      gl_accounts: g ? { account_code: g.account_code, account_name: g.account_name } : null,
    };
    setEditedLines((prev) => [...prev, newRow]);
    setDraftLine({
      gl_account_id: "",
      line_label: "",
      unit: "",
      frequency: "one_time",
      quantity: "",
      unit_price: "",
      amount: "",
      department_id: "",
      budget_type: "operating_expense",
      term_1_amount: "",
      term_2_amount: "",
      term_3_amount: "",
      annual_other_amount: "",
      assumptions: "",
    });
  };

  const removeLineFromDraft = (lineId: string) => {
    setEditedLines((prev) => prev.filter((l) => l.id !== lineId));
  };

  const saveBudgetLines = async () => {
    if (readOnly || !selectedId || !selectedBudget) return;
    for (const l of editedLines) {
      if (!l.line_label.trim()) {
        setErr("Each line needs a description.");
        return;
      }
    }
    setErr(null);
    setLinesSaving(true);
    try {
      const currentById = new Map(editedLines.map((l) => [l.id, l]));
      for (const bl of baselineLines) {
        if (!currentById.has(bl.id)) {
          const { error } = await supabase.from("budget_lines").delete().eq("id", bl.id);
          if (error) throw error;
        }
      }
      for (const el of editedLines) {
        if (isTempLineId(el.id)) continue;
        const orig = baselineLines.find((b) => b.id === el.id);
        if (!orig || !lineRowChanged(orig, el)) continue;
        const { error } = await supabase
          .from("budget_lines")
          .update({
            gl_account_id: el.gl_account_id,
            line_label: el.line_label.trim(),
            amount: el.amount,
            unit: el.unit,
            frequency: el.frequency ?? "one_time",
            quantity: el.quantity,
            unit_price: el.unit_price,
            department_id: el.department_id,
            budget_type: el.budget_type,
            term_1_amount: el.term_1_amount,
            term_2_amount: el.term_2_amount,
            term_3_amount: el.term_3_amount,
            annual_other_amount: el.annual_other_amount,
            assumptions: el.assumptions,
            sort_order: el.sort_order,
          })
          .eq("id", el.id);
        if (error) throw error;
      }
      for (const el of editedLines) {
        if (!isTempLineId(el.id)) continue;
        const { error } = await supabase.from("budget_lines").insert({
          budget_id: selectedId,
          gl_account_id: el.gl_account_id,
          line_label: el.line_label.trim(),
          amount: el.amount,
          unit: el.unit,
          frequency: el.frequency ?? "one_time",
          quantity: el.quantity,
          unit_price: el.unit_price,
          department_id: el.department_id,
          budget_type: el.budget_type,
          term_1_amount: el.term_1_amount,
          term_2_amount: el.term_2_amount,
          term_3_amount: el.term_3_amount,
          annual_other_amount: el.annual_other_amount,
          assumptions: el.assumptions,
          sort_order: el.sort_order,
        });
        if (error) throw error;
      }
      await loadLines(selectedId);
      loadBudgets();
      setEditingLines(false);
      setEditedLines([]);
      setBaselineLines([]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save budget lines.");
    } finally {
      setLinesSaving(false);
    }
  };

  const createBudget = async () => {
    if (readOnly) return;
    const name = newBudget.name.trim();
    if (!name) {
      setErr("Budget name is required.");
      return;
    }
    setErr(null);
    const { data, error } = await supabase
      .from("budgets")
      .insert({
        name,
        period_label: `FY ${newBudget.financial_year}`,
        financial_year: Number(newBudget.financial_year),
        period_mode: "annual_terms",
        status: "draft",
        is_active: false,
        start_date: newBudget.start_date || null,
        end_date: newBudget.end_date || null,
        notes: newBudget.notes.trim() || null,
      })
      .select("id")
      .single();
    if (error) {
      setErr(error.message);
      return;
    }
    if (user?.business_type === "school" && data && "id" in data) {
      const budgetId = (data as { id: string }).id;
      const standardResult = await supabase.from("budget_lines").insert(standardSchoolBudgetLineRows(budgetId));
      if (standardResult.error) {
        await supabase.from("budgets").delete().eq("id", budgetId);
        setErr(`The budget could not be prepared with the standard school lines: ${standardResult.error.message}`);
        return;
      }
    }
    setNewBudget({ name: "", financial_year: String(new Date().getFullYear()), start_date: "", end_date: "", notes: "" });
    await loadBudgets();
    if (data && "id" in data) {
      setSelectedId((data as { id: string }).id);
      setEditingLines(false);
      setEditedLines([]);
      setBaselineLines([]);
    }
  };

  const addMissingStandardSchoolLines = async () => {
    if (!selectedBudget || readOnly || user?.business_type !== "school" || addingStandardLines) return;
    const existingLabels = new Set(lines.map((line) => line.line_label.trim().toLowerCase()));
    const missing = STANDARD_SCHOOL_BUDGET_LINES.filter((line) => !existingLabels.has(line.line_label.toLowerCase()));
    if (!missing.length) {
      setErr("All standard school budget lines are already present.");
      return;
    }
    setAddingStandardLines(true);
    setErr(null);
    const rows = standardSchoolBudgetLineRows(selectedBudget.id)
      .filter((row) => missing.some((line) => line.line_label === row.line_label))
      .map((row, index) => ({ ...row, sort_order: lines.length + index }));
    const { error } = await supabase.from("budget_lines").insert(rows);
    if (error) setErr(error.message);
    else await loadLines(selectedBudget.id);
    setAddingStandardLines(false);
  };

  const deleteBudget = async (id: string) => {
    if (readOnly) return;
    if (!confirm("Delete this budget and all its lines?")) return;
    setErr(null);
    const { error } = await supabase.from("budgets").delete().eq("id", id);
    if (error) setErr(error.message);
    else {
      if (selectedId === id) {
        setSelectedId(null);
        setEditingLines(false);
        setEditedLines([]);
        setBaselineLines([]);
      }
      loadBudgets();
    }
  };

  const changeBudgetStatus = async (budget: BudgetRow, toStatus: BudgetRow["status"]) => {
    if (readOnly || hasUnsavedLineChanges) return;
    const note = prompt(`Optional note for ${toStatus}:`) || null;
    setErr(null);
    const { error } = await supabase.rpc("change_budget_status", { p_budget_id: budget.id, p_to_status: toStatus, p_note: note });
    if (error) setErr(error.message);
    else await loadBudgets();
  };

  const nextStatus = (status: BudgetRow["status"]): BudgetRow["status"] | null =>
    ({ draft: "submitted", submitted: "reviewed", reviewed: "approved", approved: "active", active: "closed", revised: "closed", closed: null } as const)[status];
  const canMoveTo = (status: BudgetRow["status"] | null) => status === "submitted" ? canPrepareBudget : status === "reviewed" ? canReviewBudget : status ? canApproveBudget : false;

  const createRevision = async (budget: BudgetRow) => {
    const reason = prompt("Reason for this budget revision:");
    if (!reason?.trim()) return;
    const { data, error } = await supabase.rpc("create_budget_revision", { p_budget_id: budget.id, p_reason: reason.trim() });
    if (error) return setErr(error.message);
    await loadBudgets();
    if (typeof data === "string") setSelectedId(data);
  };

  const displayLines = editingLines ? editedLines : lines;
  const showReadOnlyLines = readOnly || !editingLines;

  if (!orgId) {
    return (
      <div className="p-6 md:p-8 max-w-4xl mx-auto">
        <p className="text-slate-600">Select an organization to manage budgets.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs font-medium text-slate-500">
        <span>Finance</span><ChevronRight className="h-3.5 w-3.5" /><span>Budget &amp; Vote Book</span><ChevronRight className="h-3.5 w-3.5" /><span className="text-slate-700">Budget Performance</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Budget Performance</h1>
            <p className="mt-1 text-sm text-slate-600">Compare approved budgets with actual income and expenditure.</p>
          </div>
          <PageNotes ariaLabel="Budget Performance">
          <p>
            Define budgets by period and optional GL lines. Click <strong>Edit lines</strong> to add or change lines, then <strong>Save budget</strong> to store
            them. Each line can include <strong>unit</strong>, <strong>frequency</strong>, <strong>quantity</strong>, and <strong>unit price</strong>; the budget
            amount is quantity × unit price × periods for that frequency, or enter a budget amount directly. <strong>Actual</strong> is net journal activity for
            the budget dates. If several lines share one account, actual is split in proportion to each line&apos;s budget.
          </p>
          </PageNotes>
        </div>
        {!readOnly && canPrepareBudget && (
          <button type="button" onClick={() => setShowCreateBudget((open) => !open)} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800">
            {showCreateBudget ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showCreateBudget ? "Close setup" : "New budget"}
          </button>
        )}
      </div>
      {readOnly && <ReadOnlyNotice />}
      {err && <p className="text-red-600 text-sm">{err}</p>}

      {!readOnly && canPrepareBudget && showCreateBudget && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="md:col-span-2 lg:col-span-3">
            <h2 className="text-sm font-semibold text-slate-900">Create a budget</h2>
            <p className="mt-0.5 text-xs text-slate-500">Set the planning period now. School budgets start with standard income, staff, operating and capital lines; you can edit them or add more after creation.</p>
          </div>
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm lg:col-span-2"
            placeholder="Budget name *"
            value={newBudget.name}
            onChange={(e) => setNewBudget((n) => ({ ...n, name: e.target.value }))}
          />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            type="number"
            min={2000}
            max={2200}
            placeholder="Financial year"
            value={newBudget.financial_year}
            onChange={(e) => setNewBudget((n) => ({ ...n, financial_year: e.target.value }))}
          />
          <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={newBudget.start_date} onChange={(e) => setNewBudget((n) => ({ ...n, start_date: e.target.value }))} />
          <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={newBudget.end_date} onChange={(e) => setNewBudget((n) => ({ ...n, end_date: e.target.value }))} />
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
            placeholder="Notes"
            value={newBudget.notes}
            onChange={(e) => setNewBudget((n) => ({ ...n, notes: e.target.value }))}
          />
          <button type="button" onClick={createBudget} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 w-fit">
            Create budget
          </button>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Budget</span>
            <select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value || null)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
              <option value="">Select a budget</option>
              {budgets.map((budget) => <option key={budget.id} value={budget.id}>{budget.name} · FY {budget.financial_year ?? "—"} · {budget.status}</option>)}
            </select>
          </label>
          {selectedBudget && <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"><span className="font-medium text-slate-800">Reporting period:</span> {periodHint || selectedBudget.period_label || "Not set"}</div>}
        </div>
      </div>

      {selectedBudget && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            {label:"Total budget",value:lineTotal,tone:"text-slate-900",accent:"border-t-slate-800"},
            {label:"Amount spent",value:amountSpent,tone:"text-teal-700",accent:"border-t-teal-600"},
            {label:"Available balance",value:availableBalance,tone:availableBalance>=0?"text-emerald-700":"text-red-700",accent:availableBalance>=0?"border-t-emerald-600":"border-t-red-600"},
            {label:"Budget utilised",value:utilisation,tone:utilisation>100?"text-red-700":utilisation>=85?"text-amber-700":"text-emerald-700",accent:utilisation>100?"border-t-red-600":utilisation>=85?"border-t-amber-500":"border-t-emerald-600",percent:true},
            {label:"Surplus / deficit",value:budgetSummary.net,tone:budgetSummary.net>=0?"text-emerald-700":"text-red-700",accent:budgetSummary.net>=0?"border-t-emerald-600":"border-t-red-600"},
          ].map((card) => <div key={card.label} className={`rounded-xl border border-t-2 border-slate-200 bg-white p-4 ${card.accent}`}><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{card.label}</p><p className={`mt-1 text-lg font-bold tabular-nums ${card.tone}`}>{card.percent?`${card.value.toFixed(1)}%`:card.value.toLocaleString(undefined,{maximumFractionDigits:2})}</p></div>)}
        </div>
      )}
      {selectedBudget && lines.length>0 && ["draft","submitted","reviewed"].includes(selectedBudget.status) && <SchoolBudgetDriversPanel budgetId={selectedBudget.id} lines={lines.map(l=>({id:l.id,line_label:l.line_label,budget_type:l.budget_type}))} disabled={readOnly||!canPrepareBudget||editingLines} onSaved={()=>void loadLines(selectedBudget.id)}/>}

      {!selectedBudget ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600"><CircleDollarSign className="h-6 w-6" /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-900">No budget selected</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Select an approved budget above to compare planned and actual performance.</p>
        </div>
      ) : <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-1 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Budgets</div>
          {loading ? (
            <p className="p-4 text-slate-500 text-sm">Loading…</p>
          ) : budgets.length === 0 ? (
            <p className="p-4 text-slate-500 text-sm">No budgets yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
              {budgets.map((b) => (
                <li key={b.id}>
                  <div className="flex items-start gap-2 p-3 hover:bg-slate-50/80">
                    <button
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={`flex-1 text-left text-sm ${selectedId === b.id ? "text-indigo-800 font-medium" : "text-slate-800"}`}
                    >
                      <span className="flex items-center gap-2"><span>{b.name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.status === "active" ? "bg-emerald-100 text-emerald-700" : b.status === "approved" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{b.status}</span></span>
                      <span className="text-xs text-slate-500">FY {b.financial_year ?? "—"} · Version {b.version_no}</span>
                    </button>
                    {!readOnly && canPrepareBudget && b.status === "draft" && (
                      <button type="button" onClick={() => deleteBudget(b.id)} className="p-1 text-slate-400 hover:text-red-600" title="Delete budget">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex flex-wrap justify-between gap-3 items-start">
            <div>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700"><BarChart3 className="h-4 w-4" />Detailed performance</span>
              {selectedBudget && periodHint && (
                <p className="text-[11px] text-slate-500 mt-0.5">GL period: {periodHint}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end">
              {selectedBudget && !readOnly && (
                <>
                  {!editingLines && nextStatus(selectedBudget.status) && canMoveTo(nextStatus(selectedBudget.status)) && <button type="button" onClick={() => void changeBudgetStatus(selectedBudget, nextStatus(selectedBudget.status)!)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white">{nextStatus(selectedBudget.status) === "submitted" ? "Submit" : nextStatus(selectedBudget.status) === "reviewed" ? "Mark reviewed" : nextStatus(selectedBudget.status) === "approved" ? "Approve" : nextStatus(selectedBudget.status) === "active" ? "Activate" : "Close"}</button>}
                  {!editingLines && canApproveBudget && ["approved", "active"].includes(selectedBudget.status) && <button type="button" onClick={() => void createRevision(selectedBudget)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium">Create revision</button>}
                  {!editingLines && user?.business_type === "school" && canPrepareBudget && ["draft", "submitted", "reviewed"].includes(selectedBudget.status) && (
                    <button type="button" onClick={() => void addMissingStandardSchoolLines()} disabled={addingStandardLines || linesLoading} className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800 disabled:opacity-50">
                      <Plus className="h-3.5 w-3.5" />{addingStandardLines ? "Adding…" : "Add standard school lines"}
                    </button>
                  )}
                  {!editingLines ? (
                    <button
                      type="button"
                      onClick={beginEditLines}
                      disabled={linesLoading || !canPrepareBudget || !["draft", "submitted", "reviewed"].includes(selectedBudget.status)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit lines
                    </button>
                  ) : (
                    <>
                      {hasUnsavedLineChanges && (
                        <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">Unsaved changes</span>
                      )}
                      <button
                        type="button"
                        onClick={() => void saveBudgetLines()}
                        disabled={linesSaving || !hasUnsavedLineChanges}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-700 text-white hover:bg-indigo-800 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {linesSaving ? "Saving…" : "Save budget"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditLines}
                        disabled={linesSaving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                    </>
                  )}
                </>
              )}
              {selectedBudget && (
                <span className="text-xs text-slate-600">
                  {actualsLoading ? (
                    <span className="text-slate-500">Loading actuals…</span>
                  ) : (
                    <>
                      Budget <span className="font-semibold tabular-nums text-slate-900">{lineTotal.toLocaleString()}</span>
                      <span className="mx-1.5 text-slate-300">|</span>
                      Actual <span className="font-semibold tabular-nums text-slate-900">{sumActualDisplay.toLocaleString()}</span>
                      <span className="mx-1.5 text-slate-300">|</span>
                      Var. <span className="font-semibold tabular-nums text-slate-900">{sumVariance.toLocaleString()}</span>
                    </>
                  )}
                </span>
              )}
            </div>
          </div>
          {linesLoading ? (
            <p className="p-6 text-slate-500 text-sm">Loading lines…</p>
          ) : (
            <>
              {displayLines.length === 0 ? (
                <p className="p-6 text-slate-500 text-sm">
                  {readOnly
                    ? "No budget lines."
                    : editingLines
                      ? "No lines yet. Use the form below to add one."
                      : "No lines yet. Click Edit lines to add or change budget lines."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[880px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left p-2 font-semibold text-slate-700 min-w-[160px]">Account / description</th>
                        <th className="text-left p-2 font-semibold text-slate-700 w-24">Unit</th>
                        <th className="text-left p-2 font-semibold text-slate-700 w-28">Frequency</th>
                        <th className="text-right p-2 font-semibold text-slate-700 w-24">Qty</th>
                        <th className="text-right p-2 font-semibold text-slate-700 w-28">Unit price</th>
                        <th className="text-right p-2 font-semibold text-slate-700 w-28">Budget</th>
                        <th className="text-right p-2 font-semibold text-slate-700 w-28">Actual</th>
                        <th className="text-right p-2 font-semibold text-slate-700 w-28">Variance</th>
                        {!readOnly && editingLines && <th className="w-10 p-2" />}
                      </tr>
                    </thead>
                    <tbody>
                      {displayLines.map((l) => {
                        const hasGl = Boolean(l.gl_account_id);
                        const act = lineActualDisplay.get(l.id);
                        const vari = lineVariance.get(l.id);
                        const variClass =
                          !hasGl || vari === undefined
                            ? "text-slate-400"
                            : vari >= 0
                              ? "text-emerald-700"
                              : "text-red-700";
                        const freqLabel = BUDGET_FREQUENCIES.find((x) => x.value === (l.frequency || "one_time"))?.label ?? l.frequency;
                        return (
                          <tr key={l.id} className="border-b border-slate-100">
                            <td className="p-2 text-slate-800 align-top space-y-1.5">
                              {showReadOnlyLines ? (
                                <>
                                  <div className="font-medium">{l.line_label}</div>
                                  <div className="text-xs text-indigo-700">{departments.find((d) => d.id === l.department_id)?.name || "Central / unassigned"} · {l.budget_type.replaceAll("_", " ")}</div>
                                  {l.gl_accounts && (
                                    <div className="text-xs text-slate-500 font-mono">
                                      {l.gl_accounts.account_code} · {l.gl_accounts.account_name}
                                    </div>
                                  )}
                                </>
                              ) : (
                                <>
                                  <input
                                    type="text"
                                    className="w-full font-medium border border-slate-200 rounded px-2 py-1 text-sm"
                                    value={l.line_label}
                                    onChange={(e) => updateEditedLine(l.id, { line_label: e.target.value })}
                                  />
                                  <select
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1"
                                    value={l.gl_account_id ?? ""}
                                    onChange={(e) => {
                                      const glId = e.target.value || null;
                                      const g = glId ? accounts.find((a) => a.id === glId) : null;
                                      updateEditedLine(l.id, {
                                        gl_account_id: glId,
                                        gl_accounts: g ? { account_code: g.account_code, account_name: g.account_name } : null,
                                      });
                                    }}
                                  >
                                    <option value="">No GL account</option>
                                    {accounts.map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.account_code} — {a.account_name}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="grid grid-cols-2 gap-1">
                                    <select className="w-full text-xs border border-slate-200 rounded px-2 py-1" value={l.department_id ?? ""} onChange={(e) => updateEditedLine(l.id, { department_id: e.target.value || null })}>
                                      <option value="">Central / shared</option>
                                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                    <select className="w-full text-xs border border-slate-200 rounded px-2 py-1" value={l.budget_type} onChange={(e) => updateEditedLine(l.id, { budget_type: e.target.value })}>
                                      <option value="income">Income</option><option value="operating_expense">Operating expense</option><option value="staff_cost">Staff cost</option><option value="capital_expenditure">Capital expenditure</option>
                                    </select>
                                  </div>
                                  <div className="grid grid-cols-4 gap-1">
                                    {(["term_1_amount","term_2_amount","term_3_amount","annual_other_amount"] as const).map((key, index) => <input key={key} type="number" min={0} step="0.01" title={["Term 1","Term 2","Term 3","Annual/holiday"][index]} className="w-full text-xs border border-slate-200 rounded px-1 py-1 text-right" value={l[key]} onChange={(e) => { const value=Math.max(0,Number(e.target.value)||0); const next={...l,[key]:value}; updateEditedLine(l.id,{[key]:value,amount:next.term_1_amount+next.term_2_amount+next.term_3_amount+next.annual_other_amount}); }} />)}
                                  </div>
                                </>
                              )}
                            </td>
                            <td className="p-2 align-top">
                              {showReadOnlyLines ? (
                                <span className="text-slate-700">{l.unit || "—"}</span>
                              ) : (
                                <input
                                  type="text"
                                  className="w-full min-w-[4rem] border border-slate-200 rounded px-2 py-1 text-sm"
                                  value={l.unit ?? ""}
                                  onChange={(e) => updateEditedLine(l.id, { unit: e.target.value.trim() || null })}
                                />
                              )}
                            </td>
                            <td className="p-2 align-top">
                              {showReadOnlyLines ? (
                                <span className="text-slate-700 text-xs">{freqLabel}</span>
                              ) : (
                                <select
                                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs"
                                  value={l.frequency || "one_time"}
                                  onChange={(e) => updateEditedLine(l.id, { frequency: e.target.value })}
                                >
                                  {BUDGET_FREQUENCIES.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td className="p-2 text-right align-top">
                              {showReadOnlyLines ? (
                                <span className="tabular-nums text-slate-700">
                                  {l.quantity != null && Number.isFinite(Number(l.quantity)) ? Number(l.quantity).toLocaleString() : "—"}
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  className="w-24 border border-slate-200 rounded px-2 py-1 text-right text-sm"
                                  value={l.quantity ?? ""}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === "") {
                                      updateEditedLine(l.id, { quantity: null });
                                      return;
                                    }
                                    const n = Number(raw);
                                    if (Number.isFinite(n) && n >= 0) updateEditedLine(l.id, { quantity: n });
                                  }}
                                />
                              )}
                            </td>
                            <td className="p-2 text-right align-top">
                              {showReadOnlyLines ? (
                                <span className="tabular-nums text-slate-700">
                                  {l.unit_price != null && Number.isFinite(Number(l.unit_price))
                                    ? Number(l.unit_price).toLocaleString(undefined, { maximumFractionDigits: 2 })
                                    : "—"}
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="w-28 border border-slate-200 rounded px-2 py-1 text-right text-sm"
                                  value={l.unit_price ?? ""}
                                  onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === "") {
                                      updateEditedLine(l.id, { unit_price: null });
                                      return;
                                    }
                                    const n = Number(raw);
                                    if (Number.isFinite(n) && n >= 0) updateEditedLine(l.id, { unit_price: n });
                                  }}
                                />
                              )}
                            </td>
                            <td className="p-2 text-right align-top">
                              {showReadOnlyLines ? (
                                <span className="tabular-nums">{Number(l.amount).toLocaleString()}</span>
                              ) : (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="w-28 border border-slate-200 rounded px-2 py-1 text-right text-sm"
                                  value={l.amount}
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    if (Number.isFinite(n) && n >= 0) updateEditedLine(l.id, { amount: n });
                                  }}
                                />
                              )}
                            </td>
                            <td className="p-2 text-right tabular-nums text-slate-800 align-top">
                              {!hasGl ? "—" : actualsLoading ? "…" : (act ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            <td className={`p-2 text-right tabular-nums font-medium align-top ${variClass}`}>
                              {!hasGl ? "—" : actualsLoading ? "…" : (vari ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                            {!readOnly && editingLines && (
                              <td className="p-2 align-top">
                                <button
                                  type="button"
                                  onClick={() => removeLineFromDraft(l.id)}
                                  className="p-1 text-slate-400 hover:text-red-600"
                                  title="Remove line"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!readOnly && editingLines && (
                <div className="p-3 border-t border-slate-200 bg-slate-50/50 space-y-3">
                  <p className="text-xs font-medium text-slate-600">Add line</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
                    <select
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm sm:col-span-2 lg:col-span-3 xl:col-span-2"
                      value={draftLine.gl_account_id}
                      onChange={(e) => setDraftLine((d) => ({ ...d, gl_account_id: e.target.value }))}
                    >
                      <option value="">GL account (optional)</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_code} — {a.account_name}
                        </option>
                      ))}
                    </select>
                    <select className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={draftLine.department_id} onChange={(e) => setDraftLine((d) => ({ ...d, department_id: e.target.value }))}>
                      <option value="">Central / shared department</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                    <select className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={draftLine.budget_type} onChange={(e) => setDraftLine((d) => ({ ...d, budget_type: e.target.value }))}>
                      <option value="income">Income</option><option value="operating_expense">Operating expense</option><option value="staff_cost">Staff cost</option><option value="capital_expenditure">Capital expenditure</option>
                    </select>
                    <input
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm lg:col-span-2 xl:col-span-2"
                      placeholder="Description *"
                      value={draftLine.line_label}
                      onChange={(e) => setDraftLine((d) => ({ ...d, line_label: e.target.value }))}
                    />
                    <input
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Unit (e.g. hrs, kg)"
                      value={draftLine.unit}
                      onChange={(e) => setDraftLine((d) => ({ ...d, unit: e.target.value }))}
                    />
                    <select
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      value={draftLine.frequency}
                      onChange={(e) => setDraftLine((d) => ({ ...d, frequency: e.target.value }))}
                    >
                      {BUDGET_FREQUENCIES.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Quantity"
                      value={draftLine.quantity}
                      onChange={(e) => setDraftLine((d) => ({ ...d, quantity: e.target.value }))}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Unit price / cost"
                      value={draftLine.unit_price}
                      onChange={(e) => setDraftLine((d) => ({ ...d, unit_price: e.target.value }))}
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm xl:col-span-2"
                      placeholder="Budget amount (if not using qty × price)"
                      value={draftLine.amount}
                      onChange={(e) => setDraftLine((d) => ({ ...d, amount: e.target.value }))}
                    />
                    {(["term_1_amount","term_2_amount","term_3_amount","annual_other_amount"] as const).map((key,index) => <input key={key} type="number" min={0} step="0.01" className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm" placeholder={["Term 1 amount","Term 2 amount","Term 3 amount","Holiday / annual amount"][index]} value={draftLine[key]} onChange={(e) => setDraftLine((d) => ({...d,[key]:e.target.value}))}/>)}
                    <input className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm xl:col-span-2" placeholder="Assumptions / notes" value={draftLine.assumptions} onChange={(e) => setDraftLine((d) => ({...d,assumptions:e.target.value}))}/>
                  </div>
                  {draftComputedAmount != null && (
                    <p className="text-xs text-slate-600">
                      Computed line total from qty × unit price × periods:{" "}
                      <span className="font-semibold tabular-nums text-slate-900">
                        {draftComputedAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={addLineToDraft}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-indigo-700 text-white rounded-lg hover:bg-indigo-800"
                  >
                    <Plus className="w-4 h-4" />
                    Add line
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>}
      {selectedBudget && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">Department consolidation</div>
            <div className="divide-y divide-slate-100">
              {[...budgetSummary.departmentTotals.entries()].sort((a,b)=>b[1]-a[1]).map(([id,total]) => <div key={id} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{id==="central"?"Central / shared":departments.find((d)=>d.id===id)?.name||"Department"}</span><span className="font-semibold tabular-nums">{total.toLocaleString()}</span></div>)}
              {budgetSummary.departmentTotals.size===0 && <p className="p-4 text-sm text-slate-500">Department totals appear after budget lines are added.</p>}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">Workflow history</div>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {workflowHistory.map((item) => <div key={item.id} className="px-4 py-3 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-semibold capitalize">{item.from_status ? `${item.from_status} → `:""}{item.to_status}</span><time className="text-xs text-slate-500">{new Date(item.acted_at).toLocaleString()}</time></div>{item.note&&<p className="mt-1 text-xs text-slate-600">{item.note}</p>}</div>)}
              {workflowHistory.length===0 && <p className="p-4 text-sm text-slate-500">No workflow actions recorded yet.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
