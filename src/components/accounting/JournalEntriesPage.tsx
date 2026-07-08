import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import {
  getReferenceTypeLabel,
  backfillJournalEntries,
  repairHotelPosOrderJournals,
  repairStockAdjustmentJournals,
  reconcileInventoryLedgersToStockSummary,
  repairRoomChargeJournals,
  type BackfillProgress,
  type BackfillResult,
  type PosJournalRepairResult,
  type RoomJournalRepairResult,
  type StockAdjustmentJournalRepairResult,
} from "../../lib/journal";
import { ChevronLeft, ChevronRight, RefreshCw, Pencil, Trash2, Save, X, Plus, Star } from "lucide-react";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { orderGlAccountsWithExpensePreferences, fetchExpenseGlAccountPreferenceOrder } from "../../lib/manualJournalGlOptions";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { randomUuid } from "../../lib/randomUuid";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";

type GLAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
};

type JournalLine = {
  id: string;
  gl_account_id: string;
  debit: number;
  credit: number;
  line_description: string | null;
  dimensions?: unknown;
  gl_accounts: GLAccount | null;
};

type JournalEntry = {
  id: string;
  transaction_id: string | null;
  entry_date: string;
  description: string;
  is_posted?: boolean;
  is_deleted?: boolean;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  journal_entry_lines?: JournalLine[];
};

function formatAccount(gl: GLAccount | null): string {
  if (!gl) return "—";
  return `${gl.account_code} ${gl.account_name}`.trim();
}

function getDebitedAccounts(lines: JournalLine[]): string {
  return lines
    .filter((l) => Number(l.debit) > 0)
    .map((l) => formatAccount(l.gl_accounts))
    .join(", ") || "—";
}

function getCreditedAccounts(lines: JournalLine[]): string {
  return lines
    .filter((l) => Number(l.credit) > 0)
    .map((l) => formatAccount(l.gl_accounts))
    .join(", ") || "—";
}

function formatDimensionsSummary(lines: JournalLine[]): string {
  const withDim = lines.find((l) => {
    const d = l.dimensions;
    return d && typeof d === "object" && d !== null && Object.keys(d as object).length > 0;
  });
  if (!withDim?.dimensions || typeof withDim.dimensions !== "object" || withDim.dimensions === null) return "—";
  const o = withDim.dimensions as Record<string, unknown>;
  const parts: string[] = [];
  if (o.branch) parts.push(String(o.branch));
  if (o.department_id) parts.push(`dept ${String(o.department_id).slice(0, 8)}…`);
  return parts.length ? parts.join(" · ") : "—";
}

type EditLineRow = {
  id: string;
  gl_account_id: string;
  debit: number;
  credit: number;
  line_description: string;
  /** Structured dimensions input (saved into journal_entry_lines.dimensions). */
  branch: string;
  department_id: string;
};

const REFERENCE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All sources" },
  { value: "room_charge", label: "Room charge" },
  { value: "payment", label: "Payment" },
  { value: "pos", label: "POS" },
  { value: "bill", label: "GRN/Bill" },
  { value: "vendor_payment", label: "Vendor payment" },
  { value: "vendor_credit", label: "Vendor credit" },
  { value: "expense", label: "Expense" },
  { value: "stock_adjustment", label: "Inventory movement" },
  { value: "manual", label: "Manual" },
  { value: "fixed_asset_capitalization", label: "Fixed asset — capitalization" },
  { value: "fixed_asset_depreciation_run", label: "Fixed asset — depreciation" },
  { value: "fixed_asset_disposal", label: "Fixed asset — disposal" },
  { value: "fixed_asset_revaluation", label: "Fixed asset — revaluation" },
  { value: "fixed_asset_impairment", label: "Fixed asset — impairment" },
];

export function JournalEntriesPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const isHotelOrganization = user?.business_type === "hotel" || user?.business_type === "mixed";

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [expenseGlPreferenceOrder, setExpenseGlPreferenceOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState("");
  const [entryDateFilter, setEntryDateFilter] = useState("");
  const [journalNumberFilter, setJournalNumberFilter] = useState("");
  const [searchDescription, setSearchDescription] = useState("");
  const [searchAccount, setSearchAccount] = useState("");
  const [searchAmount, setSearchAmount] = useState("");
  const [page, setPage] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [totalEntries, setTotalEntries] = useState<number | null>(null);
  const [favoriteAccountIds, setFavoriteAccountIds] = useState<string[]>([]);
  const [recentAccountIds, setRecentAccountIds] = useState<string[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [dryRunBackfill, setDryRunBackfill] = useState(false);
  const [repairingPos, setRepairingPos] = useState(false);
  const [posRepairProgress, setPosRepairProgress] = useState({ processed: 0, total: 0 });
  const [posRepairResult, setPosRepairResult] = useState<PosJournalRepairResult | null>(null);
  const [posRepairJournal, setPosRepairJournal] = useState("");
  const [posRepairDepartmentId, setPosRepairDepartmentId] = useState("");
  const [posRepairFrom, setPosRepairFrom] = useState("");
  const [posRepairTo, setPosRepairTo] = useState("");
  const [repairingRooms, setRepairingRooms] = useState(false);
  const [repairingStockAdjustments, setRepairingStockAdjustments] = useState(false);
  const [stockAdjustmentRepairProgress, setStockAdjustmentRepairProgress] = useState({ processed: 0, total: 0 });
  const [stockAdjustmentRepairResult, setStockAdjustmentRepairResult] = useState<StockAdjustmentJournalRepairResult | null>(null);
  const [reconcilingInventory, setReconcilingInventory] = useState(false);
  const [inventoryReconciliationMessage, setInventoryReconciliationMessage] = useState<string | null>(null);
  const [roomRepairProgress, setRoomRepairProgress] = useState({ processed: 0, total: 0 });
  const [roomRepairResult, setRoomRepairResult] = useState<RoomJournalRepairResult | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [runningBulkAction, setRunningBulkAction] = useState<null | "delete" | "post" | "unpost">(null);
  const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([]);
  const [drillEntry, setDrillEntry] = useState<JournalEntry | null>(null);
  const [drillSourceData, setDrillSourceData] = useState<Record<string, unknown> | null>(null);
  const [periodLockBefore, setPeriodLockBefore] = useState("");
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLines, setEditLines] = useState<EditLineRow[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const baseAccountsForEdit = useMemo(
    () => orderGlAccountsWithExpensePreferences(accounts, expenseGlPreferenceOrder),
    [accounts, expenseGlPreferenceOrder]
  );
  const accountsForEdit = useMemo(() => {
    const byId = new Map(baseAccountsForEdit.map((a) => [a.id, a]));
    const ordered: GLAccount[] = [];
    const push = (id: string) => {
      const acc = byId.get(id);
      if (!acc) return;
      if (ordered.some((x) => x.id === id)) return;
      ordered.push(acc as GLAccount);
    };
    favoriteAccountIds.forEach(push);
    recentAccountIds.forEach(push);
    baseAccountsForEdit.forEach((a) => push(a.id));
    return ordered;
  }, [baseAccountsForEdit, favoriteAccountIds, recentAccountIds]);

  useEffect(() => {
    const key = `journal-entry-account-prefs:${orgId ?? "no-org"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setFavoriteAccountIds([]);
        setRecentAccountIds([]);
        return;
      }
      const parsed = JSON.parse(raw) as { favorites?: string[]; recent?: string[] };
      setFavoriteAccountIds(Array.isArray(parsed.favorites) ? parsed.favorites : []);
      setRecentAccountIds(Array.isArray(parsed.recent) ? parsed.recent : []);
    } catch {
      setFavoriteAccountIds([]);
      setRecentAccountIds([]);
    }
  }, [orgId]);

  useEffect(() => {
    const key = `journal-entry-account-prefs:${orgId ?? "no-org"}`;
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          favorites: favoriteAccountIds.slice(0, 50),
          recent: recentAccountIds.slice(0, 50),
        })
      );
    } catch {
      // ignore storage failures
    }
  }, [favoriteAccountIds, recentAccountIds, orgId]);

  useEffect(() => {
    if (!orgId && !superAdmin) {
      setPeriodLockBefore("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await (supabase as any)
        .from("journal_gl_settings")
        .select("period_lock_before_date")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (cancelled) return;
      setPeriodLockBefore((data?.period_lock_before_date as string | null) ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, superAdmin]);

  useEffect(() => {
    void fetchData();
  }, [orgId, superAdmin, page, entryDateFilter, journalNumberFilter]);

  const fetchData = async () => {
    setLoading(true);
    if (!orgId && !superAdmin) {
      setEntries([]);
      setAccounts([]);
      setDepartments([]);
      setExpenseGlPreferenceOrder([]);
      setLoading(false);
      return;
    }
    let entriesQuery = supabase
      .from("journal_entries")
      .select("*, journal_entry_lines(*, gl_accounts(id, account_code, account_name, account_type))", { count: "exact" })
      .eq("is_deleted", false);
    if (entryDateFilter) entriesQuery = entriesQuery.eq("entry_date", entryDateFilter);
    if (journalNumberFilter.trim()) {
      entriesQuery = entriesQuery.ilike("transaction_id", `%${journalNumberFilter.trim()}%`);
    }
    entriesQuery = entriesQuery
      .order("entry_date", { ascending: false })
      .range(page * 50, page * 50 + 49);
    const accountsQuery = supabase
      .from("gl_accounts")
      .select("*")
      .order("account_code");
    const scopedEntriesQuery = orgId ? entriesQuery.eq("organization_id", orgId) : entriesQuery;
    const scopedAccountsQuery = orgId ? accountsQuery.eq("organization_id", orgId) : accountsQuery;
    const departmentsQuery = filterByOrganizationId(
      supabase.from("departments").select("id, name").order("name"),
      orgId,
      false
    );
    const [entRes, accRes, depRes, prefOrder] = await Promise.all([
      scopedEntriesQuery,
      scopedAccountsQuery,
      departmentsQuery,
      fetchExpenseGlAccountPreferenceOrder(orgId, false),
    ]);
    const fetchedEntries = (entRes.data || []) as JournalEntry[];
    setEntries(fetchedEntries);
    const total = typeof entRes.count === "number" ? entRes.count : null;
    setTotalEntries(total);
    setHasMorePages(total !== null ? (page + 1) * 50 < total : fetchedEntries.length === 50);
    const normalizedAccounts = normalizeGlAccountRows((accRes.data || []) as unknown[])
      .filter((row) => row.is_active)
      .map((row) => ({
        id: row.id,
        account_code: row.account_code,
        account_name: row.account_name,
        account_type: row.account_type,
      }));
    setAccounts(normalizedAccounts as GLAccount[]);
    setDepartments((depRes.data || []) as Array<{ id: string; name: string }>);
    setExpenseGlPreferenceOrder(prefOrder);
    setLoading(false);
  };

  const movePage = (nextPage: number) => {
    setSelectedEntryIds([]);
    setExpandedEntryIds([]);
    setPage(Math.max(0, nextPage));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const paginationControls = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => movePage(page - 1)}
        disabled={page === 0}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </button>
      <span className="text-sm text-slate-600">
        Page {page + 1}
        {totalEntries !== null ? ` of ${Math.max(1, Math.ceil(totalEntries / 50))}` : ""}
      </span>
      <button
        type="button"
        onClick={() => movePage(page + 1)}
        disabled={!hasMorePages}
        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const openEdit = (e: JournalEntry) => {
    setEditingEntry(e);
    setEditDate(e.entry_date || new Date().toISOString().slice(0, 10));
    setEditDescription(e.description || "");
    const lines = e.journal_entry_lines || [];
    setEditLines(
      lines.length > 0
        ? lines.map((l) => ({
            id: l.id,
            gl_account_id: l.gl_account_id,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            line_description: l.line_description || "",
            branch:
              l.dimensions && typeof l.dimensions === "object" && l.dimensions !== null && "branch" in (l.dimensions as object)
                ? String((l.dimensions as Record<string, unknown>).branch ?? "")
                : "",
            department_id:
              l.dimensions && typeof l.dimensions === "object" && l.dimensions !== null && "department_id" in (l.dimensions as object)
                ? String((l.dimensions as Record<string, unknown>).department_id ?? "")
                : "",
          }))
        : [{ id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "", branch: "", department_id: "" }]
    );
  };

  const addEditLine = () => {
    setEditLines((prev) => [
      ...prev,
      { id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "", branch: "", department_id: "" },
    ]);
  };

  const removeEditLine = (id: string) => {
    if (editLines.length <= 1) return;
    setEditLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateEditLine = (id: string, field: keyof EditLineRow, value: string | number) => {
    setEditLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    if (field === "gl_account_id" && typeof value === "string" && value) {
      setRecentAccountIds((prev) => [value, ...prev.filter((x) => x !== value)].slice(0, 50));
    }
  };

  const toggleFavoriteAccount = (accountId: string) => {
    if (!accountId) return;
    setFavoriteAccountIds((prev) =>
      prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [accountId, ...prev].slice(0, 50)
    );
  };

  const totalEditDr = editLines.reduce((s, l) => s + Number(l.debit) || 0, 0);
  const totalEditCr = editLines.reduce((s, l) => s + Number(l.credit) || 0, 0);
  const editBalanced = Math.abs(totalEditDr - totalEditCr) < 0.01;

  const getEditLineIssue = (line: EditLineRow): string | null => {
    const dr = Number(line.debit) || 0;
    const cr = Number(line.credit) || 0;
    if (!line.gl_account_id) return "Select a GL account.";
    if (dr > 0 && cr > 0) return "Use either debit or credit, not both.";
    if (dr <= 0 && cr <= 0) return "Enter a debit or credit amount.";
    return null;
  };

  const editLineIssues = editLines.map((l) => getEditLineIssue(l));
  const hasEditLineIssues = editLineIssues.some(Boolean);

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    if (editingEntry.is_posted) {
      alert("Posted journal entries are locked and cannot be edited.");
      return;
    }
    if (periodLockBefore && editDate < periodLockBefore) {
      alert(`This period is locked. You cannot edit entries before ${periodLockBefore}.`);
      return;
    }
    if (!editDescription.trim()) {
      alert("Enter a description.");
      return;
    }
    const validLines = editLines.filter((l) => l.gl_account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (validLines.length < 2) {
      alert("Add at least two lines with account and debit or credit.");
      return;
    }
    if (!editBalanced) {
      alert("Total debits must equal total credits.");
      return;
    }
    setSavingEdit(true);
    try {
      const lineRows = validLines.map((l, i) => {
        let dimensions: Record<string, unknown> = {};
        if ((l.branch || "").trim()) dimensions.branch = l.branch.trim();
        if ((l.department_id || "").trim()) dimensions.department_id = l.department_id.trim();
        return {
          gl_account_id: l.gl_account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          line_description: (l.line_description || "").trim() || null,
          sort_order: i,
          dimensions,
        };
      });
      const { error } = await supabase.rpc("update_journal_entry_safe_with_audit", {
        p_entry_id: editingEntry.id,
        p_entry_date: editDate,
        p_description: editDescription.trim(),
        p_lines: lineRows,
        p_updated_by: user?.id ?? null,
      });
      if (error) throw error;
      setEditingEntry(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to save: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingEdit(false);
    }
  };

  const filtered = entries.filter((e) => {
    if (sourceFilter && (e.reference_type || "") !== sourceFilter) return false;
    const descNeedle = searchDescription.trim().toLowerCase();
    if (descNeedle && !(e.description || "").toLowerCase().includes(descNeedle)) return false;

    const accountNeedle = searchAccount.trim().toLowerCase();
    if (accountNeedle) {
      const lines = e.journal_entry_lines || [];
      const accountMatch = lines.some((l) => {
        const gl = l.gl_accounts;
        if (!gl) return false;
        const txt = `${gl.account_code} ${gl.account_name}`.toLowerCase();
        return txt.includes(accountNeedle);
      });
      if (!accountMatch) return false;
    }

    const amountNeedle = searchAmount.trim();
    if (amountNeedle) {
      const amountNumber = Number(amountNeedle);
      const lines = e.journal_entry_lines || [];
      const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      if (!Number.isNaN(amountNumber)) {
        const hasExact = Math.abs(dr - amountNumber) < 0.01 || Math.abs(cr - amountNumber) < 0.01;
        if (!hasExact) return false;
      } else {
        const hasText =
          dr.toFixed(2).includes(amountNeedle) ||
          cr.toFixed(2).includes(amountNeedle) ||
          lines.some((l) => Number(l.debit || 0).toFixed(2).includes(amountNeedle) || Number(l.credit || 0).toFixed(2).includes(amountNeedle));
        if (!hasText) return false;
      }
    }
    return true;
  });

  const toggleSelectedEntry = (id: string, checked: boolean) => {
    setSelectedEntryIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    if (!checked) {
      setSelectedEntryIds([]);
      return;
    }
    setSelectedEntryIds(filtered.map((e) => e.id));
  };

  const runBulkPostState = async (isPosted: boolean) => {
    if (selectedEntryIds.length === 0) return;
    setRunningBulkAction(isPosted ? "post" : "unpost");
    try {
      const { error } = await supabase.rpc("bulk_set_journal_entries_posted", {
        p_entry_ids: selectedEntryIds,
        p_is_posted: isPosted,
        p_user_id: user?.id ?? null,
      });
      if (error) throw error;
      setSelectedEntryIds([]);
      await fetchData();
    } catch (e) {
      alert(`Bulk ${isPosted ? "post" : "unpost"} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningBulkAction(null);
    }
  };

  const runBulkSoftDelete = async () => {
    if (selectedEntryIds.length === 0) return;
    const ok = window.confirm(`Soft delete ${selectedEntryIds.length} selected journal entr${selectedEntryIds.length === 1 ? "y" : "ies"}?`);
    if (!ok) return;
    setRunningBulkAction("delete");
    try {
      const { error } = await supabase.rpc("bulk_soft_delete_journal_entries", {
        p_entry_ids: selectedEntryIds,
        p_user_id: user?.id ?? null,
      });
      if (error) throw error;
      setSelectedEntryIds([]);
      await fetchData();
    } catch (e) {
      alert(`Bulk delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunningBulkAction(null);
    }
  };

  const exportSelectedCsv = () => {
    if (selectedEntryIds.length === 0) return;
    const rows = filtered.filter((e) => selectedEntryIds.includes(e.id));
    if (rows.length === 0) return;
    const header = ["Entry ID", "Transaction ID", "Date", "Source", "Description", "Debits", "Credits"];
    const csvRows = rows.map((e) => {
      const lines = e.journal_entry_lines || [];
      const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
      const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
      return [
        e.id,
        e.transaction_id ?? "",
        e.entry_date,
        getReferenceTypeLabel(e.reference_type),
        `"${(e.description || "").replace(/"/g, '""')}"`,
        dr.toFixed(2),
        cr.toFixed(2),
      ].join(",");
    });
    const csv = [header.join(","), ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal_entries_page_${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillResult(null);
    setBackfillProgress(null);
    try {
      const result = await backfillJournalEntries({
        dryRun: dryRunBackfill,
        businessType: user?.business_type,
        repairExisting: user?.business_type === "manufacturing",
        organizationId: orgId,
        onProgress: setBackfillProgress,
      });
      setBackfillResult(result);
      if (!dryRunBackfill) {
        await fetchData();
      }
    } catch (e) {
      setBackfillResult({
        room_charge: 0,
        payment: 0,
        pos: 0,
        bill: 0,
        vendor_payment: 0,
        vendor_credit: 0,
        expense: 0,
        manufacturing_costing: 0,
        stock_adjustment: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setBackfilling(false);
    }
  };

  const handleRepairPastPosJournals = async () => {
    if (repairingPos) return;
    if (posRepairFrom && posRepairTo && posRepairFrom > posRepairTo) {
      alert("POS repair start date cannot be after the end date.");
      return;
    }
    const scopes = [
      posRepairJournal.trim() ? `journal/order ${posRepairJournal.trim()}` : "",
      posRepairDepartmentId ? `department ${departments.find((department) => department.id === posRepairDepartmentId)?.name || posRepairDepartmentId}` : "",
      posRepairFrom || posRepairTo ? `dates ${posRepairFrom || "earliest"} to ${posRepairTo || "latest"}` : "",
    ].filter(Boolean);
    if (!confirm(`Rebuild POS journals for the logged-in organization for ${scopes.length ? scopes.join(", ") : "all past orders"} and recalculate COGS from sale-time stock movement costs?`)) return;
    setRepairingPos(true);
    setPosRepairResult(null);
    setPosRepairProgress({ processed: 0, total: 0 });
    try {
      const result = await repairHotelPosOrderJournals({
        organizationId: orgId,
        onProgress: (processed, total) => setPosRepairProgress({ processed, total }),
        journalOrOrder: posRepairJournal,
        departmentId: posRepairDepartmentId,
        fromDate: posRepairFrom,
        toDate: posRepairTo,
      });
      setPosRepairResult(result);
      await fetchData();
    } catch (e) {
      setPosRepairResult({ repaired: 0, removed: 0, errors: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setRepairingPos(false);
    }
  };

  const handleRepairRoomChargeJournals = async () => {
    if (repairingRooms) return;
    if (!confirm("Rebuild all room-charge journals from room billing? This uses the currently configured room revenue account.")) return;
    setRepairingRooms(true);
    setRoomRepairResult(null);
    setRoomRepairProgress({ processed: 0, total: 0 });
    try {
      const result = await repairRoomChargeJournals({
        organizationId: orgId,
        onProgress: (processed, total) => setRoomRepairProgress({ processed, total }),
      });
      setRoomRepairResult(result);
      await fetchData();
    } catch (e) {
      setRoomRepairResult({ repaired: 0, errors: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setRepairingRooms(false);
    }
  };

  const handleRepairStockAdjustmentJournals = async () => {
    if (repairingStockAdjustments) return;
    if (!confirm("Rebuild inventory movement journals from saved stock movement batches? This will replace active inventory-movement journals.")) return;
    setRepairingStockAdjustments(true);
    setStockAdjustmentRepairResult(null);
    setStockAdjustmentRepairProgress({ processed: 0, total: 0 });
    try {
      const result = await repairStockAdjustmentJournals({
        organizationId: orgId,
        onProgress: (processed, total) => setStockAdjustmentRepairProgress({ processed, total }),
      });
      setStockAdjustmentRepairResult(result);
      await fetchData();
    } catch (e) {
      setStockAdjustmentRepairResult({ repaired: 0, errors: [e instanceof Error ? e.message : String(e)] });
    } finally {
      setRepairingStockAdjustments(false);
    }
  };

  const handleReconcileInventory = async () => {
    if (reconcilingInventory) return;
    if (!confirm("Post a balanced adjustment so Bar and Kitchen inventory GL balances match the Stock Summary weighted-average valuation?")) return;
    setReconcilingInventory(true);
    setInventoryReconciliationMessage(null);
    try {
      const result = await reconcileInventoryLedgersToStockSummary(orgId);
      setInventoryReconciliationMessage(
        `Inventory reconciliation posted. Bar ${result.barBefore.toFixed(2)} -> ${result.barTarget.toFixed(2)}; ` +
          `Kitchen ${result.kitchenBefore.toFixed(2)} -> ${result.kitchenTarget.toFixed(2)}.`
      );
      await fetchData();
    } catch (e) {
      setInventoryReconciliationMessage(`Inventory reconciliation failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReconcilingInventory(false);
    }
  };

  const toggleExpandedEntry = (entryId: string) => {
    setExpandedEntryIds((prev) => (prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]));
  };

  const openDrillDown = async (entry: JournalEntry) => {
    setDrillEntry(entry);
    setDrillSourceData(null);
    if (!entry.reference_id || !entry.reference_type) return;
    if (entry.reference_type === "pos") {
      const referenceId = entry.reference_id;
      const [hotelOrderRes, retailSaleRes, paymentsRes, stockMovesRes] = await Promise.all([
        filterByOrganizationId(
          supabase.from("kitchen_orders").select("*, kitchen_order_items(quantity,unit_price,product_id,notes)").eq("id", referenceId).maybeSingle(),
          orgId,
          false
        ),
        filterByOrganizationId(
          supabase
            .from("retail_sales")
            .select("*, retail_sale_lines(description,quantity,unit_price,line_total,department_id)")
            .eq("id", referenceId)
            .maybeSingle(),
          orgId,
          false
        ),
        filterByOrganizationId(
          supabase
            .from("payments")
            .select("id,amount,payment_method,payment_status,paid_at,payment_source,transaction_id")
            .ilike("transaction_id", `${referenceId}%`),
          orgId,
          false
        ),
        filterByOrganizationId(
          supabase
            .from("product_stock_movements")
            .select("id,product_id,quantity_out,movement_date,source_type,source_id,note")
            .eq("source_type", "sale")
            .eq("source_id", referenceId),
          orgId,
          false
        ),
      ]);
      const hotelOrder = hotelOrderRes.data as Record<string, unknown> | null;
      const retailSale = retailSaleRes.data as Record<string, unknown> | null;
      const payments = (paymentsRes.data || []) as unknown[];
      const stockMovements = (stockMovesRes.data || []) as unknown[];
      setDrillSourceData({
        trace_status: hotelOrder
          ? "Found in hotel POS orders"
          : retailSale
            ? "Found in retail POS sales"
            : "Source POS order is missing",
        journal_transaction_id: entry.transaction_id,
        journal_reference_id: referenceId,
        explanation:
          "The JE number identifies the journal only. The journal reference ID is the POS order/sale ID used to trace the source.",
        source_order: hotelOrder ?? retailSale,
        linked_payments: payments,
        linked_stock_movements: stockMovements,
        missing_source_diagnostic:
          !hotelOrder && !retailSale
            ? payments.length > 0 || stockMovements.length > 0
              ? "The POS order/sale row is missing, but linked payment or stock records prove that the transaction existed."
              : "No POS order, payment, or stock movement was found for this reference ID. The journal may have been imported, manually changed, or its source deleted."
            : null,
      });
      return;
    }
    const tableByRef: Record<string, string> = {
      room_charge: "billing",
      payment: "payments",
      pos: "kitchen_orders",
      bill: "bills",
      vendor_payment: "vendor_payments",
      vendor_credit: "vendor_credits",
      expense: "expenses",
    };
    if (entry.reference_type === "stock_adjustment") {
      const { data } = await filterByOrganizationId(
        supabase
          .from("product_stock_movements")
          .select("id,product_id,movement_date,quantity_in,quantity_out,unit_cost,note,products(name)")
          .eq("source_type", "adjustment")
          .eq("source_id", entry.reference_id),
        orgId,
        false
      );
      setDrillSourceData({ stock_movements: data || [] });
      return;
    }
    const table = tableByRef[entry.reference_type];
    if (!table) return;
    const { data } = await filterByOrganizationId(
      supabase.from(table).select("*").eq("id", entry.reference_id).maybeSingle(),
      orgId,
      false
    );
    setDrillSourceData((data as Record<string, unknown> | null) ?? null);
  };

  if (loading) return <div className="p-6">Loading journal entries...</div>;

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Journal Entries</h1>
            <PageNotes ariaLabel="Journal entries help">
              <p>
                All entries from room charges, POS, purchases, and manual journals. Use Edit to correct accounts or amounts. When editing lines, GL
                accounts used on <strong>Purchases → Expenses</strong> appear first in the dropdown.
              </p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void runBulkPostState(true)}
              disabled={selectedEntryIds.length === 0 || runningBulkAction !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Bulk Post
            </button>
            <button
              type="button"
              onClick={() => void runBulkPostState(false)}
              disabled={selectedEntryIds.length === 0 || runningBulkAction !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Bulk Unpost
            </button>
            <button
              type="button"
              onClick={exportSelectedCsv}
              disabled={selectedEntryIds.length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Bulk Export
            </button>
            <button
              type="button"
              onClick={() => void runBulkSoftDelete()}
              disabled={selectedEntryIds.length === 0 || runningBulkAction !== null}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Bulk Delete
            </button>
          </div>
          {paginationControls}
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            Entry date
            <input
              type="date"
              value={entryDateFilter}
              onChange={(e) => {
                setEntryDateFilter(e.target.value);
                setPage(0);
                setSelectedEntryIds([]);
              }}
              className="border rounded-lg px-3 py-2 bg-white"
            />
          </label>
          <input
            value={journalNumberFilter}
            onChange={(e) => {
              setJournalNumberFilter(e.target.value);
              setPage(0);
              setSelectedEntryIds([]);
            }}
            placeholder="Journal number, e.g. JE-01167"
            className="border rounded-lg px-3 py-2 bg-white min-w-[220px]"
          />
          {(entryDateFilter || journalNumberFilter) && (
            <button
              type="button"
              onClick={() => {
                setEntryDateFilter("");
                setJournalNumberFilter("");
                setPage(0);
                setSelectedEntryIds([]);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Clear date/number
            </button>
          )}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-white min-w-[160px]"
          >
            {REFERENCE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            value={searchDescription}
            onChange={(e) => setSearchDescription(e.target.value)}
            placeholder="Search description"
            className="border rounded-lg px-3 py-2 bg-white min-w-[180px]"
          />
          <input
            value={searchAccount}
            onChange={(e) => setSearchAccount(e.target.value)}
            placeholder="Search account"
            className="border rounded-lg px-3 py-2 bg-white min-w-[180px]"
          />
          <input
            value={searchAmount}
            onChange={(e) => setSearchAmount(e.target.value)}
            placeholder="Search amount"
            className="border rounded-lg px-3 py-2 bg-white min-w-[140px]"
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={dryRunBackfill} onChange={(e) => setDryRunBackfill(e.target.checked)} />
            Dry run
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            Period lock before
            <input
              type="date"
              value={periodLockBefore}
              onChange={async (e) => {
                const v = e.target.value;
                setPeriodLockBefore(v);
                if (!orgId) return;
                const { error } = await (supabase as any).from("journal_gl_settings").upsert(
                  {
                    organization_id: orgId,
                    period_lock_before_date: v || null,
                  },
                  { onConflict: "organization_id" }
                );
                if (error) {
                  alert(`Failed to save period lock: ${error.message}`);
                }
              }}
              className="border rounded px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleBackfill}
            disabled={backfilling || repairingPos || repairingRooms || repairingStockAdjustments}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create missing journals for transactions belonging to the logged-in organization"
          >
            <RefreshCw className={`w-4 h-4 ${backfilling ? "animate-spin" : ""}`} />
            {backfilling ? "Running…" : dryRunBackfill ? "Dry run organization backfill" : "Backfill organization journals"}
          </button>
          {isHotelOrganization ? (
            <>
              <button
                type="button"
                onClick={handleRepairPastPosJournals}
                disabled={repairingPos || backfilling || repairingRooms}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Rebuild POS journals for the logged-in organization and recalculate COGS"
              >
                <RefreshCw className={`w-4 h-4 ${repairingPos ? "animate-spin" : ""}`} />
                {repairingPos ? "Recalculating POS COGS..." : "Repair organization POS journals"}
              </button>
              <button
                type="button"
                onClick={handleRepairRoomChargeJournals}
                disabled={repairingRooms || repairingPos || backfilling}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Rebuild room-charge journals from billing using the current room revenue account"
              >
                <RefreshCw className={`w-4 h-4 ${repairingRooms ? "animate-spin" : ""}`} />
                {repairingRooms ? "Repairing room journals..." : "Repair organization room journals"}
              </button>
              <button
                type="button"
                onClick={() => void handleReconcileInventory()}
                disabled={reconcilingInventory}
                className="px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                title="Post a balanced adjustment so Bar and Kitchen inventory ledgers match Stock Summary weighted-average values"
              >
                {reconcilingInventory ? "Reconciling inventory..." : "Reconcile organization inventory ledgers"}
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={handleRepairStockAdjustmentJournals}
            disabled={repairingStockAdjustments || backfilling || repairingPos || repairingRooms}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Rebuild inventory movement journals from stock movement batches"
          >
            <RefreshCw className={`w-4 h-4 ${repairingStockAdjustments ? "animate-spin" : ""}`} />
            {repairingStockAdjustments ? "Repairing inventory movements..." : "Repair inventory movement journals"}
          </button>
          {inventoryReconciliationMessage ? (
            <p className="text-sm text-slate-700">{inventoryReconciliationMessage}</p>
          ) : null}
        </div>
      </div>

      {isHotelOrganization ? <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="mb-2 text-sm font-medium text-amber-950">POS journal repair scope</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={posRepairJournal}
            onChange={(event) => setPosRepairJournal(event.target.value)}
            placeholder="Journal JE-01167 or order UUID"
            className="min-w-[230px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
          />
          <select
            value={posRepairDepartmentId}
            onChange={(event) => setPosRepairDepartmentId(event.target.value)}
            className="min-w-[180px] rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">All departments</option>
            {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
          </select>
          <label className="inline-flex items-center gap-1 text-xs text-amber-950">
            From
            <input type="date" value={posRepairFrom} onChange={(event) => setPosRepairFrom(event.target.value)} className="rounded-lg border border-amber-300 bg-white px-2 py-2 text-sm" />
          </label>
          <label className="inline-flex items-center gap-1 text-xs text-amber-950">
            To
            <input type="date" value={posRepairTo} onChange={(event) => setPosRepairTo(event.target.value)} className="rounded-lg border border-amber-300 bg-white px-2 py-2 text-sm" />
          </label>
          <button
            type="button"
            onClick={() => {
              setPosRepairJournal("");
              setPosRepairDepartmentId("");
              setPosRepairFrom("");
              setPosRepairTo("");
            }}
            className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
          >
            Clear scope
          </button>
        </div>
        <p className="mt-2 text-xs text-amber-800">Filters are combined. Leave every field blank to repair all POS journals for the logged-in organization.</p>
      </div> : null}

      {repairingPos && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Repairing POS journals: {posRepairProgress.processed}/{posRepairProgress.total}
        </div>
      )}

      {repairingRooms && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          Repairing room journals: {roomRepairProgress.processed}/{roomRepairProgress.total}
        </div>
      )}

      {repairingStockAdjustments && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Repairing inventory movement journals: {stockAdjustmentRepairProgress.processed}/{stockAdjustmentRepairProgress.total}
        </div>
      )}

      {roomRepairResult && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium">Room journal repair complete: {roomRepairResult.repaired} rebuilt.</p>
          {roomRepairResult.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs">
              {roomRepairResult.errors.slice(0, 10).map((error, index) => <li key={index}>{error}</li>)}
              {roomRepairResult.errors.length > 10 && <li>... and {roomRepairResult.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}

      {stockAdjustmentRepairResult && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-medium">Inventory movement journal repair complete: {stockAdjustmentRepairResult.repaired} rebuilt.</p>
          {stockAdjustmentRepairResult.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs">
              {stockAdjustmentRepairResult.errors.slice(0, 10).map((error, index) => <li key={index}>{error}</li>)}
              {stockAdjustmentRepairResult.errors.length > 10 && <li>... and {stockAdjustmentRepairResult.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}

      {posRepairResult && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            POS journal repair complete: {posRepairResult.repaired} rebuilt, {posRepairResult.removed} removed.
          </p>
          {posRepairResult.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside text-xs">
              {posRepairResult.errors.slice(0, 10).map((error, index) => <li key={index}>{error}</li>)}
              {posRepairResult.errors.length > 10 && <li>... and {posRepairResult.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}

      {backfilling && backfillProgress && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center justify-between text-sm text-blue-900 mb-1">
            <span>{backfillProgress.phaseLabel}</span>
            <span>
              {backfillProgress.processed}/{backfillProgress.total} ({backfillProgress.percent}%)
            </span>
          </div>
          <div className="h-2 rounded bg-blue-100 overflow-hidden">
            <div className="h-full bg-blue-600" style={{ width: `${backfillProgress.percent}%` }} />
          </div>
        </div>
      )}

      {backfillResult && (
        <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm">
          <p className="font-medium text-slate-800 mb-2">Backfill complete</p>
          <ul className="list-disc list-inside text-slate-600 space-y-1">
            {backfillResult.room_charge > 0 && <li>Room charges: {backfillResult.room_charge}</li>}
            {backfillResult.payment > 0 && <li>Payments: {backfillResult.payment}</li>}
            {backfillResult.pos > 0 && <li>POS orders: {backfillResult.pos}</li>}
            {backfillResult.bill > 0 && <li>GRN/Bills: {backfillResult.bill}</li>}
            {backfillResult.vendor_payment > 0 && <li>Vendor payments: {backfillResult.vendor_payment}</li>}
            {backfillResult.vendor_credit > 0 && <li>Vendor credits: {backfillResult.vendor_credit}</li>}
            {backfillResult.expense > 0 && <li>Expenses: {backfillResult.expense}</li>}
            {backfillResult.stock_adjustment > 0 && <li>Inventory movements: {backfillResult.stock_adjustment}</li>}
            {backfillResult.manufacturing_costing > 0 && <li>Manufacturing costing: {backfillResult.manufacturing_costing}</li>}
          </ul>
          {backfillResult.errors.length > 0 && (
            <div className="mt-2 text-amber-700">
              <p className="font-medium">Errors:</p>
              <ul className="list-disc list-inside text-amber-800 text-xs mt-1">
                {backfillResult.errors.slice(0, 10).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {backfillResult.errors.length > 10 && (
                  <li>… and {backfillResult.errors.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
          {[backfillResult.room_charge, backfillResult.payment, backfillResult.pos, backfillResult.bill, backfillResult.vendor_payment, backfillResult.vendor_credit, backfillResult.expense, backfillResult.stock_adjustment, backfillResult.manufacturing_costing].every((n) => n === 0) && backfillResult.errors.length === 0 && (
            <p className="text-slate-500">No new journal entries needed; all transactions already have entries.</p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr>
              <th className="p-3 text-center w-10">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedEntryIds.length === filtered.length}
                  onChange={(evt) => toggleSelectAllFiltered(evt.target.checked)}
                  aria-label="Select all visible journal entries"
                />
              </th>
              <th className="p-3 text-left">Transaction ID</th>
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Posting</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">Debited</th>
              <th className="p-3 text-left">Credited</th>
              <th className="p-3 text-left text-xs font-medium text-slate-500">Dimensions</th>
              <th className="p-3 text-right">Debits</th>
              <th className="p-3 text-right">Credits</th>
              <th className="p-3 text-center w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const lineList = e.journal_entry_lines || [];
              const dr = lineList.reduce((s, l) => s + Number(l.debit || 0), 0);
              const cr = lineList.reduce((s, l) => s + Number(l.credit || 0), 0);
              return (
                <Fragment key={e.id}>
                <tr className="border-t border-slate-100">
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedEntryIds.includes(e.id)}
                      onChange={(evt) => toggleSelectedEntry(e.id, evt.target.checked)}
                    />
                  </td>
                  <td className="p-3 font-mono text-slate-700">{e.transaction_id ?? "—"}</td>
                  <td className="p-3">{e.entry_date}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${e.is_posted === false ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
                      {e.is_posted === false ? "Unposted" : "Posted"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                      {getReferenceTypeLabel(e.reference_type)}
                    </span>
                  </td>
                  <td className="p-3">
                    <button type="button" className="underline text-slate-800 hover:text-slate-900" onClick={() => void openDrillDown(e)}>
                      {e.description}
                    </button>
                  </td>
                  <td className="p-3 text-emerald-700">{getDebitedAccounts(lineList)}</td>
                  <td className="p-3 text-violet-700">{getCreditedAccounts(lineList)}</td>
                  <td className="p-3 text-xs text-slate-600 max-w-[140px] truncate" title={formatDimensionsSummary(lineList)}>
                    {formatDimensionsSummary(lineList)}
                  </td>
                  <td className="p-3 text-right text-emerald-700 font-medium">{dr.toFixed(2)}</td>
                  <td className="p-3 text-right text-violet-700 font-medium">{cr.toFixed(2)}</td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => toggleExpandedEntry(e.id)}
                      className="mr-2 p-1.5 rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      title="Toggle line details"
                    >
                      {expandedEntryIds.includes(e.id) ? "−" : "+"}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      disabled={e.is_posted !== false}
                      className="p-1.5 rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      title={e.is_posted === false ? "Edit journal entry" : "Posted entries are locked"}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
                {expandedEntryIds.includes(e.id) && (
                  <tr className="bg-slate-50/70 border-t border-slate-100">
                    <td />
                    <td colSpan={11} className="p-3">
                      <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-white">
                            <tr>
                              <th className="text-left p-2">Account</th>
                              <th className="text-right p-2">Debit</th>
                              <th className="text-right p-2">Credit</th>
                              <th className="text-left p-2">Memo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(e.journal_entry_lines || []).map((ln) => (
                              <tr key={ln.id} className="border-t border-slate-100">
                                <td className="p-2">{formatAccount(ln.gl_accounts)}</td>
                                <td className="p-2 text-right text-emerald-700">{Number(ln.debit || 0).toFixed(2)}</td>
                                <td className="p-2 text-right text-violet-700">{Number(ln.credit || 0).toFixed(2)}</td>
                                <td className="p-2">{ln.line_description || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={12} className="p-8 text-center text-slate-500">
                  {entries.length === 0
                    ? "No journal entries yet. Entries are created from room charges, POS, purchases, and manual journals."
                    : "No entries match the selected source."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex justify-end">{paginationControls}</div>

      {editingEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full my-8 p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Edit journal entry {editingEntry.transaction_id ?? editingEntry.id.slice(0, 8)}</h2>
              <button type="button" onClick={() => setEditingEntry(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-600 mb-4">Source: {getReferenceTypeLabel(editingEntry.reference_type)}. Change date, description, or line accounts/amounts as needed.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Entry date</label>
                <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Lines (Debit / Credit)</label>
                  <button type="button" onClick={addEditLine} className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                    <Plus className="w-4 h-4" /> Add line
                  </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {editLines.map((line, idx) => (
                    <div key={line.id} className={`rounded-lg p-2 ${editLineIssues[idx] ? "bg-red-50 border border-red-200" : "bg-slate-50/40 border border-transparent"}`}>
                      <div className="flex gap-2 items-center flex-wrap">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[220px]">
                        <select
                          value={line.gl_account_id}
                          onChange={(e) => updateEditLine(line.id, "gl_account_id", e.target.value)}
                          className="flex-1 min-w-[180px] border rounded px-2 py-1.5 text-sm"
                        >
                          <option value="">Account</option>
                          {accountsForEdit.map((a) => (
                            <option key={a.id} value={a.id}>
                              {favoriteAccountIds.includes(a.id) ? "★ " : ""}
                              {recentAccountIds.includes(a.id) ? "• " : ""}
                              {a.account_code} – {a.account_name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => toggleFavoriteAccount(line.gl_account_id)}
                          disabled={!line.gl_account_id}
                          title={line.gl_account_id && favoriteAccountIds.includes(line.gl_account_id) ? "Remove favorite" : "Add favorite"}
                          className={`p-1.5 rounded border ${
                            line.gl_account_id && favoriteAccountIds.includes(line.gl_account_id)
                              ? "border-amber-300 bg-amber-50 text-amber-700"
                              : "border-slate-300 text-slate-500 hover:bg-slate-50"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <Star className="w-4 h-4" />
                        </button>
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.debit || ""}
                        onChange={(e) => {
                          const v = e.target.value ? Number(e.target.value) : 0;
                          updateEditLine(line.id, "debit", v);
                          if (v > 0) updateEditLine(line.id, "credit", 0);
                        }}
                        placeholder="Debit"
                        className="w-24 border rounded px-2 py-1.5 text-sm text-right"
                      />
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.credit || ""}
                        onChange={(e) => {
                          const v = e.target.value ? Number(e.target.value) : 0;
                          updateEditLine(line.id, "credit", v);
                          if (v > 0) updateEditLine(line.id, "debit", 0);
                        }}
                        placeholder="Credit"
                        className="w-24 border rounded px-2 py-1.5 text-sm text-right"
                      />
                      <input
                        type="text"
                        value={line.line_description}
                        onChange={(e) => updateEditLine(line.id, "line_description", e.target.value)}
                        placeholder="Memo"
                        className="flex-1 min-w-[80px] border rounded px-2 py-1.5 text-sm"
                      />
                      <input
                        type="text"
                        value={line.branch}
                        onChange={(e) => updateEditLine(line.id, "branch", e.target.value)}
                        placeholder="Branch (optional)"
                        className="w-full md:w-44 border rounded px-2 py-1.5 text-xs"
                      />
                      <select
                        value={line.department_id}
                        onChange={(e) => updateEditLine(line.id, "department_id", e.target.value)}
                        className="w-full md:w-52 border rounded px-2 py-1.5 text-xs"
                        title="Department (optional)"
                      >
                        <option value="">Department (optional)</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeEditLine(line.id)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      </div>
                      {editLineIssues[idx] && (
                        <p className="text-xs text-red-700 mt-1">{editLineIssues[idx]}</p>
                      )}
                    </div>
                  ))}
                </div>
                <p className={`text-sm mt-2 ${editBalanced ? "text-emerald-600" : "text-amber-600"}`}>
                  Total Debits: {totalEditDr.toFixed(2)} — Total Credits: {totalEditCr.toFixed(2)} {editBalanced ? "✓ Balanced" : "(must be equal)"}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => setEditingEntry(null)} className="px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={savingEdit || !editBalanced || hasEditLineIssues}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {drillEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setDrillEntry(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-900">Journal drill-down</h3>
              <button type="button" className="p-1 rounded hover:bg-slate-100" onClick={() => setDrillEntry(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-sm text-slate-700 space-y-1 mb-3">
              <p>
                <strong>Journal transaction:</strong> {drillEntry.transaction_id || drillEntry.id}
              </p>
              <p>
                <strong>Source:</strong> {getReferenceTypeLabel(drillEntry.reference_type)} ({drillEntry.reference_type || "—"})
              </p>
              <p>
                <strong>Source reference ID:</strong> {drillEntry.reference_id || "—"}
              </p>
            </div>
            {drillEntry.reference_type === "pos" && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                A number such as <strong>{drillEntry.transaction_id || "JE-xxxxx"}</strong> identifies this journal only.
                Trace the POS order using the <strong>Source reference ID</strong>. The trace below searches hotel POS,
                retail POS, linked payments, and stock movements.
              </div>
            )}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Source transaction payload</p>
              <pre className="text-xs text-slate-800 whitespace-pre-wrap">{JSON.stringify(drillSourceData, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
