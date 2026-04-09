import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  createJournalForExpenseWithLines,
  deleteJournalEntryByReference,
  type ExpenseJournalLineInput,
} from "../../lib/journal";
import { useAuth } from "../../contexts/AuthContext";
import { GlAccountPicker } from "../common/GlAccountPicker";
import { PageNotes } from "../common/PageNotes";
import { SourceDocumentsCell } from "../common/SourceDocumentsCell";
import { SearchableCombobox } from "../common/SearchableCombobox";
import { buildStoragePath, uploadSourceDocument, type SourceDocumentRef } from "../../lib/sourceDocuments";
import { loadJournalAccountSettings, resolveJournalAccountSettings } from "../../lib/journalAccountSettings";

type GlAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  category: string | null;
};

interface Expense {
  id: string;
  vendor_id?: string | null;
  amount: number;
  description?: string | null;
  expense_date?: string | null;
  vendors?: { name: string } | null;
  /** Line count for display (from expense_lines aggregate) */
  line_count?: number;
  /** Distinct expense GL account names on this expense (from lines) */
  expense_gl_labels?: string;
  source_documents?: unknown;
}

type LineDraft = {
  key: string;
  /** Optional vendor for this line only */
  vendor_id: string;
  expense_gl_account_id: string;
  source_cash_gl_account_id: string;
  /** Net amount (ex VAT) */
  amount: string;
  /** When true, VAT is computed from net × VAT % at top of form */
  vat_enabled: boolean;
  vat_gl_account_id: string;
  comment: string;
};

function emptyLine(): LineDraft {
  return {
    key: crypto.randomUUID(),
    vendor_id: "",
    expense_gl_account_id: "",
    source_cash_gl_account_id: "",
    amount: "",
    vat_enabled: true,
    vat_gl_account_id: "",
    comment: "",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNum(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Calendar date in local timezone (date inputs must not use UTC-only ISO). */
function localDateISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100] as const;

/** Supabase/PostgREST errors are plain objects — avoid "[object Object]" in alerts. */
function formatSupabaseError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const err = e as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    if (err.code) return `Code ${err.code}`;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** DB migration for `source_documents` not applied yet (PostgREST / Postgres). */
function isMissingSourceDocumentsColumnError(err: unknown): boolean {
  const msg = formatSupabaseError(err).toLowerCase();
  return msg.includes("source_documents") && msg.includes("does not exist");
}

export function ExpensesPage() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [glAccounts, setGlAccounts] = useState<GlAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [expenseDate, setExpenseDate] = useState(() => localDateISO());
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [expenseAttachmentFiles, setExpenseAttachmentFiles] = useState<File[]>([]);
  const [filterDateFrom, setFilterDateFrom] = useState(() => localDateISO());
  const [filterDateTo, setFilterDateTo] = useState(() => localDateISO());
  const [filterVendorId, setFilterVendorId] = useState("");
  /** Filter list to expenses that have at least one line posting to this expense GL */
  const [filterExpenseGlAccountId, setFilterExpenseGlAccountId] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  /** False when DB has no `expenses.source_documents` column (migration not run). */
  const [expenseAttachmentsSupported, setExpenseAttachmentsSupported] = useState(true);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [vatRatePercent, setVatRatePercent] = useState("18");
  const [existingSourceDocuments, setExistingSourceDocuments] = useState<SourceDocumentRef[]>([]);
  const [editModalLoading, setEditModalLoading] = useState(false);
  /** Default VAT GL from journal settings — applied to new lines and first line on Add */
  const [defaultVatGlId, setDefaultVatGlId] = useState("");

  const orgId = user?.organization_id ?? null;

  const loadGlAccounts = useCallback(async () => {
    const { data } = await supabase
      .from("gl_accounts")
      .select("id, account_code, account_name, account_type, category")
      .eq("is_active", true)
      .order("account_code");
    setGlAccounts((data || []) as GlAccount[]);
  }, []);

  const loadVendors = useCallback(async () => {
    let q = supabase.from("vendors").select("id, name").order("name");
    if (orgId) q = q.eq("organization_id", orgId);
    const { data, error } = await q;
    if (error) {
      console.error("Vendors load error:", error.message);
      setVendors([]);
      return;
    }
    setVendors(data || []);
  }, [orgId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const venRes = await (() => {
        let q = supabase.from("vendors").select("id, name").order("name");
        if (orgId) q = q.eq("organization_id", orgId);
        return q;
      })();

      if (venRes.error) console.error("Vendors:", venRes.error.message);
      setVendors(venRes.data || []);
      const vMap = new Map((venRes.data || []).map((v) => [v.id, v.name]));

      const fromIdx = page * pageSize;
      const toIdx = fromIdx + pageSize - 1;

      let glFilteredExpenseIds: string[] | null = null;
      if (filterExpenseGlAccountId) {
        const { data: glLines, error: glErr } = await supabase
          .from("expense_lines")
          .select("expense_id")
          .eq("expense_gl_account_id", filterExpenseGlAccountId);
        if (glErr) {
          console.error("Expense lines GL filter:", glErr.message);
          throw glErr;
        }
        glFilteredExpenseIds = [...new Set((glLines || []).map((r) => (r as { expense_id: string }).expense_id))];
        if (glFilteredExpenseIds.length === 0) {
          setTotalCount(0);
          setExpenses([]);
          setLoading(false);
          return;
        }
      }

      const buildExpenseQuery = (selectCols: string) => {
        let q = supabase
          .from("expenses")
          .select(selectCols, { count: "exact" })
          .order("expense_date", { ascending: false });
        if (orgId) q = q.eq("organization_id", orgId);
        if (filterDateFrom) q = q.gte("expense_date", filterDateFrom);
        if (filterDateTo) q = q.lte("expense_date", filterDateTo);
        if (filterVendorId) q = q.eq("vendor_id", filterVendorId);
        if (glFilteredExpenseIds && glFilteredExpenseIds.length > 0) {
          q = q.in("id", glFilteredExpenseIds);
        }
        return q;
      };

      let expRes = await buildExpenseQuery(
        "id, vendor_id, amount, description, expense_date, source_documents"
      ).range(fromIdx, toIdx);

      if (expRes.error && isMissingSourceDocumentsColumnError(expRes.error)) {
        setExpenseAttachmentsSupported(false);
        expRes = await buildExpenseQuery("id, vendor_id, amount, description, expense_date").range(fromIdx, toIdx);
      } else if (!expRes.error) {
        setExpenseAttachmentsSupported(true);
      }

      if (expRes.error) {
        console.error("Expenses:", expRes.error);
        throw expRes.error;
      }

      setTotalCount(typeof expRes.count === "number" ? expRes.count : null);

      const raw = (expRes.data || []) as unknown as Array<{
        id: string;
        vendor_id: string | null;
        amount: number;
        description: string | null;
        expense_date: string | null;
        source_documents?: unknown;
      }>;

      const ids = raw.map((e) => e.id);
      const lineByExpense: Record<string, number> = {};
      const glNamesByExpense: Record<string, Set<string>> = {};
      if (ids.length > 0) {
        const { data: lineRows, error: lineErr } = await supabase
          .from("expense_lines")
          .select("expense_id, expense_gl_account_id")
          .in("expense_id", ids);
        if (lineErr) console.error("Expense lines count:", lineErr.message);
        else {
          const glIds = new Set<string>();
          for (const r of lineRows || []) {
            const row = r as { expense_id: string; expense_gl_account_id: string };
            const eid = row.expense_id;
            lineByExpense[eid] = (lineByExpense[eid] || 0) + 1;
            glIds.add(row.expense_gl_account_id);
          }
          let nameByGlId = new Map<string, string>();
          if (glIds.size > 0) {
            const { data: glRows } = await supabase
              .from("gl_accounts")
              .select("id, account_name")
              .in("id", [...glIds]);
            nameByGlId = new Map((glRows || []).map((g) => [(g as { id: string }).id, (g as { account_name: string }).account_name]));
          }
          for (const r of lineRows || []) {
            const row = r as { expense_id: string; expense_gl_account_id: string };
            const nm = nameByGlId.get(row.expense_gl_account_id);
            if (!nm) continue;
            if (!glNamesByExpense[row.expense_id]) glNamesByExpense[row.expense_id] = new Set();
            glNamesByExpense[row.expense_id].add(nm);
          }
        }
      }

      setExpenses(
        raw.map((e) => ({
          ...e,
          vendors: e.vendor_id ? { name: vMap.get(e.vendor_id) ?? "—" } : null,
          line_count: lineByExpense[e.id] ?? 0,
          expense_gl_labels: glNamesByExpense[e.id]?.size
            ? [...glNamesByExpense[e.id]].sort().join(", ")
            : "—",
          source_documents: e.source_documents,
        }))
      );
    } catch (e) {
      console.error("Error fetching expenses:", e);
      setFetchError(formatSupabaseError(e));
      setExpenses([]);
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [orgId, filterDateFrom, filterDateTo, filterVendorId, filterExpenseGlAccountId, page, pageSize]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
  }, [filterDateFrom, filterDateTo, filterVendorId, filterExpenseGlAccountId, pageSize]);

  useEffect(() => {
    loadGlAccounts();
  }, [loadGlAccounts]);

  useEffect(() => {
    if (showModal) {
      void loadVendors();
      void loadGlAccounts();
    }
  }, [showModal, loadVendors, loadGlAccounts]);

  useEffect(() => {
    if (!orgId) return;
    void loadVendors();
    void loadGlAccounts();
  }, [orgId, loadVendors, loadGlAccounts]);

  const cashSourceOptions = useMemo(() => {
    const list = glAccounts.filter((a) => (a.category || "").toLowerCase() === "cash");
    if (list.length > 0) return list;
    return glAccounts.filter((a) => a.account_type === "asset");
  }, [glAccounts]);

  const expenseGlOptions = useMemo(
    () => glAccounts.filter((a) => a.account_type === "expense"),
    [glAccounts]
  );

  /** Input VAT can sit on asset, liability, or expense per chart — allow full chart search */
  const vatGlAccountOptions = useMemo(
    () =>
      glAccounts.map((a) => ({
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
      })),
    [glAccounts]
  );

  const paginationLabel = useMemo(() => {
    if (totalCount === 0) return "0 expenses";
    if (totalCount === null) {
      const from = page * pageSize + 1;
      const to = page * pageSize + expenses.length;
      return expenses.length ? `Rows ${from}–${to}` : "";
    }
    const from = page * pageSize + 1;
    const to = Math.min(page * pageSize + expenses.length, totalCount);
    return `Rows ${from}–${to} of ${totalCount}`;
  }, [totalCount, page, pageSize, expenses.length]);

  const canPrevPage = page > 0;
  const canNextPage = totalCount !== null && (page + 1) * pageSize < totalCount;

  const updateLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = () =>
    setLines((prev) => {
      const l = emptyLine();
      if (defaultVatGlId) l.vat_gl_account_id = defaultVatGlId;
      return [...prev, l];
    });

  const removeRow = (key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  };

  const lineTotals = useMemo(() => {
    const rate = parseNum(vatRatePercent);
    return lines.map((r) => {
      const net = round2(parseNum(r.amount));
      const vat = r.vat_enabled ? round2(net * (rate / 100)) : 0;
      return { net, vat, rowTotal: round2(net + vat) };
    });
  }, [lines, vatRatePercent]);

  const vendorComboboxOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, label: v.name })),
    [vendors]
  );

  const grandTotal = useMemo(() => lineTotals.reduce((s, t) => s + t.rowTotal, 0), [lineTotals]);
  const grandNet = useMemo(() => lineTotals.reduce((s, t) => s + t.net, 0), [lineTotals]);
  const grandVat = useMemo(() => lineTotals.reduce((s, t) => s + t.vat, 0), [lineTotals]);

  const handleSave = async () => {
    const journalRows: ExpenseJournalLineInput[] = [];
    const vendorIdsPerJournalRow: (string | null)[] = [];
    for (let i = 0; i < lines.length; i++) {
      const r = lines[i];
      const t = lineTotals[i];
      if (t.rowTotal <= 0) continue;
      if (!r.expense_gl_account_id || !r.source_cash_gl_account_id) {
        alert("Each line with an amount must have Expense GL and Source of funds selected.");
        return;
      }
      journalRows.push({
        expense_gl_account_id: r.expense_gl_account_id,
        source_cash_gl_account_id: r.source_cash_gl_account_id,
        amount: t.net,
        bank_charges: 0,
        vat_amount: t.vat,
        vat_gl_account_id: r.vat_gl_account_id || null,
        bank_charges_gl_account_id: null,
        comment: r.comment.trim() || null,
      });
      vendorIdsPerJournalRow.push(r.vendor_id.trim() || null);
    }

    if (journalRows.length === 0) {
      alert("Enter at least one line with a positive total (amount and/or VAT).");
      return;
    }

    setSaving(true);
    try {
      const expDate = expenseDate || localDateISO();
      const summary =
        lines
          .map((l) => l.comment.trim())
          .filter(Boolean)
          .join("; ") || "Expense";

      const totalRounded = Math.round(grandTotal * 100) / 100;

      const lineInsertsFor = (expenseId: string) =>
        journalRows.map((jr, idx) => ({
          expense_id: expenseId,
          expense_gl_account_id: jr.expense_gl_account_id,
          source_cash_gl_account_id: jr.source_cash_gl_account_id,
          amount: jr.amount,
          bank_charges: 0,
          vat_amount: jr.vat_amount,
          vat_gl_account_id: jr.vat_gl_account_id || null,
          bank_charges_gl_account_id: null,
          comment: jr.comment || null,
          sort_order: idx,
          vendor_id: vendorIdsPerJournalRow[idx] ?? null,
        }));

      let expenseId: string;
      let savedDate: string;

      if (editingExpenseId) {
        expenseId = editingExpenseId;
        const delJ = await deleteJournalEntryByReference("expense", expenseId);
        if (!delJ.ok) throw new Error(delJ.error);

        const { error: delLinesErr } = await supabase.from("expense_lines").delete().eq("expense_id", expenseId);
        if (delLinesErr) throw delLinesErr;

        const { error: updErr } = await supabase
          .from("expenses")
          .update({
            amount: totalRounded,
            description: summary,
            expense_date: expDate,
          })
          .eq("id", expenseId);
        if (updErr) throw updErr;

        const { data: expRow } = await supabase.from("expenses").select("expense_date").eq("id", expenseId).single();
        savedDate = (expRow as { expense_date: string | null } | null)?.expense_date ?? expDate;

        const { error: lineErr } = await supabase.from("expense_lines").insert(lineInsertsFor(expenseId));
        if (lineErr) throw lineErr;
      } else {
        const { data: insertedRows, error: expErr } = await supabase
          .from("expenses")
          .insert({
            vendor_id: null,
            amount: totalRounded,
            description: summary,
            expense_date: expDate,
          })
          .select("id, expense_date");

        if (expErr) throw expErr;
        const inserted = insertedRows?.[0] as { id: string; expense_date: string } | undefined;
        if (!inserted?.id) {
          throw new Error(
            "Expense insert returned no row. Often RLS or missing organization on your staff profile — check Supabase policies and migrations."
          );
        }
        expenseId = inserted.id;
        savedDate = inserted.expense_date ?? expDate;

        const { error: lineErr } = await supabase.from("expense_lines").insert(lineInsertsFor(expenseId));
        if (lineErr) {
          await supabase.from("expenses").delete().eq("id", expenseId);
          throw lineErr;
        }
      }

      const jr = await createJournalForExpenseWithLines(
        expenseId,
        savedDate,
        journalRows,
        user?.id ?? null
      );
      if (!jr.ok) {
        alert(`Expense saved but journal was not posted: ${jr.error}`);
      }

      const uploadNewAttachments = async (): Promise<SourceDocumentRef[]> => {
        const next: SourceDocumentRef[] = [];
        if (expenseAttachmentFiles.length > 0 && orgId) {
          for (const file of expenseAttachmentFiles) {
            const path = buildStoragePath(orgId, "expenses", expenseId, file.name);
            const up = await uploadSourceDocument(file, path);
            if (!up.error) next.push({ path, name: file.name });
          }
        }
        return next;
      };

      const uploaded = await uploadNewAttachments();
      const mergedDocs =
        editingExpenseId && existingSourceDocuments.length > 0
          ? [...existingSourceDocuments, ...uploaded]
          : uploaded.length > 0
            ? uploaded
            : editingExpenseId
              ? existingSourceDocuments
              : [];

      if (mergedDocs.length > 0 && expenseAttachmentsSupported) {
        const { error: docErr } = await supabase.from("expenses").update({ source_documents: mergedDocs }).eq("id", expenseId);
        if (docErr && isMissingSourceDocumentsColumnError(docErr)) {
          alert(
            "Expense saved, but attachments could not be stored: run the SQL migration that adds expenses.source_documents (see supabase/migrations/20260328000000_source_documents_attachments.sql)."
          );
        } else if (docErr) {
          throw docErr;
        }
      }

      setShowModal(false);
      setEditingExpenseId(null);
      setExistingSourceDocuments([]);
      setExpenseDate(localDateISO());
      setVatRatePercent("18");
      setDefaultVatGlId("");
      setLines([emptyLine()]);
      setExpenseAttachmentFiles([]);
      void fetchData();
    } catch (e) {
      console.error("Error adding expense:", e);
      alert("Failed: " + formatSupabaseError(e));
    } finally {
      setSaving(false);
    }
  };

  const openModal = () => {
    setEditingExpenseId(null);
    setExistingSourceDocuments([]);
    setExpenseAttachmentFiles([]);
    setExpenseDate(localDateISO());
    setLines([emptyLine()]);
    setShowModal(true);
    void (async () => {
      const s = orgId ? await resolveJournalAccountSettings(orgId) : loadJournalAccountSettings();
      const pct = s.default_vat_percent;
      setVatRatePercent(pct != null && Number.isFinite(pct) ? String(pct) : "18");
      const vatGl = s.vat_id ?? "";
      setDefaultVatGlId(vatGl);
      setLines((prev) => {
        if (prev.length !== 1) return prev;
        const row = prev[0];
        if (row.vat_gl_account_id) return prev;
        return [{ ...row, vat_gl_account_id: vatGl }];
      });
    })();
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setEditingExpenseId(null);
    setExistingSourceDocuments([]);
    setExpenseAttachmentFiles([]);
    setVatRatePercent("18");
    setDefaultVatGlId("");
    setLines([emptyLine()]);
  };

  const openEditModal = async (expenseId: string) => {
    setShowModal(true);
    setEditModalLoading(true);
    setEditingExpenseId(expenseId);
    setExpenseAttachmentFiles([]);
    try {
      const j = orgId ? await resolveJournalAccountSettings(orgId) : loadJournalAccountSettings();
      setDefaultVatGlId(j.vat_id ?? "");

      const { data: exp, error: expErr } = await supabase
        .from("expenses")
        .select("id, expense_date, description, source_documents")
        .eq("id", expenseId)
        .single();
      if (expErr) throw expErr;
      const row = exp as {
        id: string;
        expense_date: string | null;
        description: string | null;
        source_documents: unknown;
      };
      setExpenseDate(row.expense_date || localDateISO());

      const docs = row.source_documents;
      setExistingSourceDocuments(
        Array.isArray(docs) ? (docs as SourceDocumentRef[]).filter((d) => d && typeof d.path === "string") : []
      );

      const { data: lineRows, error: lineErr } = await supabase
        .from("expense_lines")
        .select(
          "vendor_id, expense_gl_account_id, source_cash_gl_account_id, amount, vat_amount, vat_gl_account_id, comment, sort_order"
        )
        .eq("expense_id", expenseId)
        .order("sort_order", { ascending: true });
      if (lineErr) throw lineErr;

      let inferredRate = 18;
      for (const lr of lineRows || []) {
        const l = lr as {
          amount: number;
          vat_amount: number;
        };
        const net = Number(l.amount) || 0;
        const vat = Number(l.vat_amount) || 0;
        if (net > 0 && vat > 0) {
          inferredRate = Math.round((vat / net) * 10000) / 100;
          break;
        }
      }
      setVatRatePercent(String(inferredRate));

      setLines(
        (lineRows || []).map((lr) => {
          const l = lr as {
            vendor_id: string | null;
            expense_gl_account_id: string;
            source_cash_gl_account_id: string;
            amount: number;
            vat_amount: number;
            vat_gl_account_id: string | null;
            comment: string | null;
          };
          const net = Number(l.amount) || 0;
          const vat = Number(l.vat_amount) || 0;
          return {
            key: crypto.randomUUID(),
            vendor_id: l.vendor_id ?? "",
            expense_gl_account_id: l.expense_gl_account_id,
            source_cash_gl_account_id: l.source_cash_gl_account_id,
            amount: net > 0 ? String(net) : "",
            vat_enabled: vat > 0,
            vat_gl_account_id: l.vat_gl_account_id ?? "",
            comment: l.comment ?? "",
          };
        })
      );
      if (!lineRows?.length) {
        setLines([emptyLine()]);
      }
    } catch (e) {
      console.error("Load expense for edit:", e);
      alert("Could not load expense: " + formatSupabaseError(e));
      setShowModal(false);
      setEditingExpenseId(null);
    } finally {
      setEditModalLoading(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Expenses</h1>
            <PageNotes ariaLabel="Expenses help">
              <p>Record cash expenses by line: optional vendor per line, expense account, source of funds, and VAT.</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="app-btn-primary"
        >
          <Plus className="w-5 h-5" /> Add expense
        </button>
      </div>

      {fetchError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          <p className="font-medium">Could not load expenses</p>
          <p className="mt-1 text-red-800">{fetchError}</p>
        </div>
      )}

      {!expenseAttachmentsSupported && !fetchError && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          <p className="font-medium">Expense attachments disabled</p>
          <p className="mt-1 text-amber-900/90">
            The <code className="rounded bg-amber-100/80 px-1 text-xs">source_documents</code> column is missing on{" "}
            <code className="rounded bg-amber-100/80 px-1 text-xs">expenses</code>. Run{" "}
            <code className="rounded bg-amber-100/80 px-1 text-xs">supabase/migrations/20260328000000_source_documents_attachments.sql</code>{" "}
            in the Supabase SQL Editor (at least the <code className="rounded bg-amber-100/80 px-1 text-xs">ALTER TABLE expenses</code>{" "}
            line), then reload.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
        <p className="text-sm font-medium text-slate-700 mb-3">Filters</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From date</label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To date</label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="min-w-[12rem]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Vendor</label>
            <select
              value={filterVendorId}
              onChange={(e) => setFilterVendorId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
            >
              <option value="">All vendors</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Rows per page</label>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 100 ? "50+ (100)" : n}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              const t = localDateISO();
              setFilterDateFrom(t);
              setFilterDateTo(t);
            }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => {
              setFilterDateFrom("");
              setFilterDateTo("");
            }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            All dates
          </button>
          <div className="min-w-[14rem]">
            <label className="block text-xs font-medium text-slate-600 mb-1">Expense GL (line)</label>
            <select
              value={filterExpenseGlAccountId}
              onChange={(e) => setFilterExpenseGlAccountId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-h-[42px]"
            >
              <option value="">All expense accounts</option>
              {expenseGlOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              const t = localDateISO();
              setFilterDateFrom(t);
              setFilterDateTo(t);
              setFilterVendorId("");
              setFilterExpenseGlAccountId("");
            }}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Default view is today (local date). Use &quot;All dates&quot; if older expenses do not appear.
        </p>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Vendor</th>
                <th className="text-left p-3 min-w-[12rem]">Expense GL (lines)</th>
                <th className="text-left p-3">Description</th>
                <th className="text-right p-3">Lines</th>
                <th className="text-right p-3">Total</th>
                <th className="text-right p-3 w-24"> </th>
                {expenseAttachmentsSupported ? <th className="text-left p-3 w-28">Docs</th> : null}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">
                    {e.expense_date ? new Date(e.expense_date).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3">{e.vendors?.name || "—"}</td>
                  <td className="p-3 max-w-xs text-slate-700 text-xs" title={e.expense_gl_labels || undefined}>
                    {e.expense_gl_labels || "—"}
                  </td>
                  <td className="p-3 max-w-md truncate" title={e.description || undefined}>
                    {e.description || "—"}
                  </td>
                  <td className="p-3 text-right">{e.line_count ?? 0}</td>
                  <td className="p-3 text-right font-medium">{Number(e.amount).toFixed(2)}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => void openEditModal(e.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      title="Edit expense"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </td>
                  {expenseAttachmentsSupported ? (
                    <td className="p-3 align-top">
                      <SourceDocumentsCell
                        table="expenses"
                        recordId={e.id}
                        organizationId={orgId}
                        rawDocuments={e.source_documents}
                        onUpdated={() => void fetchData()}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && !fetchError && (
            <p className="p-8 text-center text-slate-500">
              No expenses in this range. Try &quot;All dates&quot; or widen the date range.
            </p>
          )}
          {!loading && expenses.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
              <span className="tabular-nums">{paginationLabel}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!canPrevPage}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!canNextPage}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget && !saving) closeModal();
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-6xl w-full p-6 my-8 relative z-10"
            onClick={(ev) => ev.stopPropagation()}
            onMouseDown={(ev) => ev.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{editingExpenseId ? "Edit expense" : "Add expense"}</h2>
                <p className="text-sm text-slate-500 mt-1">
                  Each row is one payment from a source of funds. Optionally choose a vendor for that line. Enter net amounts; VAT is calculated from the rate below when VAT is on for the line. Debits expense and VAT; credits the selected cash account for the total outflow.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!saving) closeModal();
                }}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editModalLoading ? (
              <p className="text-slate-600 py-8 text-center">Loading expense…</p>
            ) : (
              <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-w-xs"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">VAT % (for lines with VAT on)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={vatRatePercent}
                  onChange={(e) => setVatRatePercent(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm max-w-[10rem]"
                />
                <p className="text-xs text-slate-500 mt-1 max-w-md">
                  Initial rate comes from <strong className="font-medium text-slate-600">Admin → Journal account settings</strong>{" "}
                  (VAT defaults) when adding an expense; you can change it here.
                </p>
              </div>
              {orgId && vendors.length === 0 && (
                <div className="flex items-end">
                  <p className="text-xs text-amber-700">No vendors yet. Add them under Purchases → Vendors to tag lines.</p>
                </div>
              )}
            </div>

            {expenseAttachmentsSupported ? (
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-1">Attachments (optional)</label>
                {editingExpenseId && existingSourceDocuments.length > 0 ? (
                  <p className="text-xs text-slate-600 mb-2">
                    Already saved: {existingSourceDocuments.map((d) => d.name || d.path).join(", ")}
                  </p>
                ) : null}
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf,.doc,.docx"
                  className="w-full text-sm file:mr-2 file:rounded file:border file:border-slate-300 file:px-2 file:py-1"
                  onChange={(e) => setExpenseAttachmentFiles(Array.from(e.target.files || []))}
                  onMouseDown={(e) => e.stopPropagation()}
                />
                {expenseAttachmentFiles.length > 0 ? (
                  <p className="text-xs text-slate-600 mt-1">New files: {expenseAttachmentFiles.map((f) => f.name).join(", ")}</p>
                ) : null}
              </div>
            ) : null}

            <div className="border border-slate-200 rounded-lg overflow-x-auto overflow-y-visible">
              <table className="min-w-[1280px] w-full text-xs sm:text-sm [&_td]:overflow-visible [&_td]:relative">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="text-left p-2 font-semibold min-w-[200px]">Vendor</th>
                    <th className="text-left p-2 font-semibold min-w-[160px]">Source of funds</th>
                    <th className="text-left p-2 font-semibold min-w-[160px]">Expense GL</th>
                    <th className="text-center p-2 font-semibold w-14" title="Apply VAT for this line">
                      VAT
                    </th>
                    <th className="text-right p-2 font-semibold w-28">Net (ex VAT)</th>
                    <th className="text-right p-2 font-semibold w-24">VAT amt</th>
                    <th className="text-right p-2 font-semibold w-24">Total</th>
                    <th className="text-left p-2 font-semibold min-w-[160px]">VAT GL</th>
                    <th className="w-10 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row, lineIdx) => {
                    const t = lineTotals[lineIdx] ?? { net: 0, vat: 0, rowTotal: 0 };
                    return (
                    <Fragment key={row.key}>
                      <tr className="border-t border-slate-100 align-top">
                        <td className="p-2 align-top">
                          <SearchableCombobox
                            value={row.vendor_id}
                            onChange={(id) => updateLine(row.key, { vendor_id: id })}
                            options={vendorComboboxOptions}
                            placeholder="Search vendor…"
                            emptyOption={{ label: "No vendor" }}
                            inputAriaLabel="Vendor for this line"
                            className="min-w-[200px]"
                          />
                        </td>
                        <td className="p-2 align-top">
                          <GlAccountPicker
                            value={row.source_cash_gl_account_id}
                            onChange={(id) => updateLine(row.key, { source_cash_gl_account_id: id })}
                            options={cashSourceOptions}
                            placeholder="Type code or name…"
                          />
                        </td>
                        <td className="p-2 align-top">
                          <GlAccountPicker
                            value={row.expense_gl_account_id}
                            onChange={(id) => updateLine(row.key, { expense_gl_account_id: id })}
                            options={expenseGlOptions}
                            placeholder="Type code or name…"
                          />
                        </td>
                        <td className="p-2 text-center align-middle">
                          <input
                            type="checkbox"
                            checked={row.vat_enabled}
                            onChange={(e) => updateLine(row.key, { vat_enabled: e.target.checked })}
                            onMouseDown={(ev) => ev.stopPropagation()}
                            className="h-4 w-4 rounded border-slate-300"
                            title="VAT on for this line"
                            aria-label="VAT on for this line"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={row.amount}
                            onChange={(e) => updateLine(row.key, { amount: e.target.value })}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm text-right"
                            placeholder="0"
                          />
                        </td>
                        <td className="p-2 text-right tabular-nums text-slate-700">{t.vat.toFixed(2)}</td>
                        <td className="p-2 text-right tabular-nums font-medium text-slate-900">{t.rowTotal.toFixed(2)}</td>
                        <td className="p-2 align-top">
                          <GlAccountPicker
                            value={row.vat_gl_account_id}
                            onChange={(id) => updateLine(row.key, { vat_gl_account_id: id })}
                            options={vatGlAccountOptions}
                            placeholder="Type code or name…"
                            emptyOption={{ label: "Same as expense" }}
                          />
                        </td>
                        <td className="p-2 align-top">
                          <button
                            type="button"
                            onClick={() => removeRow(row.key)}
                            disabled={lines.length <= 1}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-30"
                            title="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                      <tr className="border-b border-slate-200 bg-slate-50/50">
                        <td colSpan={9} className="px-2 pb-3 pt-0">
                          <label className="text-xs font-medium text-slate-500 block mb-1">Comment</label>
                          <input
                            value={row.comment}
                            onChange={(e) => updateLine(row.key, { comment: e.target.value })}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                            placeholder="Optional note for this line"
                          />
                        </td>
                      </tr>
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 mt-4">
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50"
              >
                <Plus className="w-4 h-4" /> Add row
              </button>
              <div className="text-sm text-slate-800 text-right space-y-0.5">
                <p className="text-slate-600">
                  Net (ex VAT): <span className="tabular-nums">{grandNet.toFixed(2)}</span>
                  {" · "}
                  VAT: <span className="tabular-nums">{grandVat.toFixed(2)}</span>
                </p>
                <p className="font-semibold">
                  Total outflow: <span className="tabular-nums">{grandTotal.toFixed(2)}</span>
                </p>
              </div>
            </div>

            <div className="flex gap-2 mt-6 justify-end">
              <button
                type="button"
                onClick={() => !saving && closeModal()}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || editModalLoading}
                className="app-btn-primary px-5 disabled:cursor-not-allowed"
              >
                {saving ? "Saving…" : editingExpenseId ? "Save changes" : "Save expense"}
              </button>
            </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
