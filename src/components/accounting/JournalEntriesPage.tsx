import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getReferenceTypeLabel, backfillJournalEntries, type BackfillProgress, type BackfillResult } from "../../lib/journal";
import { RefreshCw, Pencil, Trash2, Save, X, Plus, Star } from "lucide-react";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { orderGlAccountsWithExpensePreferences, fetchExpenseGlAccountPreferenceOrder } from "../../lib/manualJournalGlOptions";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { randomUuid } from "../../lib/randomUuid";

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

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [expenseGlPreferenceOrder, setExpenseGlPreferenceOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState("");
  const [searchDescription, setSearchDescription] = useState("");
  const [searchAccount, setSearchAccount] = useState("");
  const [searchAmount, setSearchAmount] = useState("");
  const [page, setPage] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(false);
  const [favoriteAccountIds, setFavoriteAccountIds] = useState<string[]>([]);
  const [recentAccountIds, setRecentAccountIds] = useState<string[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress | null>(null);
  const [dryRunBackfill, setDryRunBackfill] = useState(false);
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
      ordered.push(acc);
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
  }, [orgId, superAdmin, page]);

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
    const entriesQuery = supabase
      .from("journal_entries")
      .select("*, journal_entry_lines(*, gl_accounts(id, account_code, account_name, account_type))")
      .eq("is_deleted", false)
      .order("entry_date", { ascending: false })
      .range(page * 50, page * 50 + 49);
    const accountsQuery = supabase
      .from("gl_accounts")
      .select("id, account_code, account_name, account_type")
      .eq("is_active", true)
      .order("account_code");
    const scopedEntriesQuery = superAdmin || !orgId ? entriesQuery : entriesQuery.eq("organization_id", orgId);
    const scopedAccountsQuery = superAdmin || !orgId ? accountsQuery : accountsQuery.eq("organization_id", orgId);
    const departmentsQuery = filterByOrganizationId(
      supabase.from("departments").select("id, name").order("name"),
      orgId,
      superAdmin
    );
    const [entRes, accRes, depRes, prefOrder] = await Promise.all([
      scopedEntriesQuery,
      scopedAccountsQuery,
      departmentsQuery,
      fetchExpenseGlAccountPreferenceOrder(orgId, superAdmin),
    ]);
    const fetchedEntries = (entRes.data || []) as JournalEntry[];
    setEntries(fetchedEntries);
    setHasMorePages(fetchedEntries.length === 50);
    setAccounts((accRes.data || []) as GLAccount[]);
    setDepartments((depRes.data || []) as Array<{ id: string; name: string }>);
    setExpenseGlPreferenceOrder(prefOrder);
    setLoading(false);
  };

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
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setBackfilling(false);
    }
  };

  const toggleExpandedEntry = (entryId: string) => {
    setExpandedEntryIds((prev) => (prev.includes(entryId) ? prev.filter((id) => id !== entryId) : [...prev, entryId]));
  };

  const openDrillDown = async (entry: JournalEntry) => {
    setDrillEntry(entry);
    setDrillSourceData(null);
    if (!entry.reference_id || !entry.reference_type) return;
    const tableByRef: Record<string, string> = {
      room_charge: "billing",
      payment: "payments",
      pos: "kitchen_orders",
      bill: "bills",
      vendor_payment: "vendor_payments",
      vendor_credit: "vendor_credits",
      expense: "expenses",
    };
    const table = tableByRef[entry.reference_type];
    if (!table) return;
    const { data } = await supabase.from(table).select("*").eq("id", entry.reference_id).maybeSingle();
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-sm text-slate-600">Page {page + 1}</span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMorePages}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
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
            disabled={backfilling}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create journal entries for all existing transactions that don't have one yet"
          >
            <RefreshCw className={`w-4 h-4 ${backfilling ? "animate-spin" : ""}`} />
            {backfilling ? "Running…" : dryRunBackfill ? "Dry run backfill" : "Backfill past transactions"}
          </button>
        </div>
      </div>

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
          {[backfillResult.room_charge, backfillResult.payment, backfillResult.pos, backfillResult.bill, backfillResult.vendor_payment, backfillResult.vendor_credit, backfillResult.expense].every((n) => n === 0) && backfillResult.errors.length === 0 && (
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
                <strong>Entry:</strong> {drillEntry.id}
              </p>
              <p>
                <strong>Source:</strong> {getReferenceTypeLabel(drillEntry.reference_type)} ({drillEntry.reference_type || "—"})
              </p>
              <p>
                <strong>Reference ID:</strong> {drillEntry.reference_id || "—"}
              </p>
            </div>
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
