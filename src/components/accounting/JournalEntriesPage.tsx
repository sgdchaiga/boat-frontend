import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getReferenceTypeLabel, backfillJournalEntries, type BackfillResult } from "../../lib/journal";
import { RefreshCw, Pencil, Trash2, Save, X, Plus } from "lucide-react";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { orderGlAccountsWithExpensePreferences, fetchExpenseGlAccountPreferenceOrder } from "../../lib/manualJournalGlOptions";

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
  /** JSON for journal_entry_lines.dimensions (branch, department_id, …) */
  dimensionsJson: string;
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
  const [expenseGlPreferenceOrder, setExpenseGlPreferenceOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState("");
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLines, setEditLines] = useState<EditLineRow[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const accountsForEdit = useMemo(
    () => orderGlAccountsWithExpensePreferences(accounts, expenseGlPreferenceOrder),
    [accounts, expenseGlPreferenceOrder]
  );

  useEffect(() => {
    void fetchData();
  }, [orgId, superAdmin]);

  const fetchData = async () => {
    setLoading(true);
    const [entRes, accRes, prefOrder] = await Promise.all([
      supabase
        .from("journal_entries")
        .select("*, journal_entry_lines(*, gl_accounts(id, account_code, account_name, account_type))")
        .order("entry_date", { ascending: false }),
      supabase.from("gl_accounts").select("id, account_code, account_name, account_type").eq("is_active", true).order("account_code"),
      fetchExpenseGlAccountPreferenceOrder(orgId, superAdmin),
    ]);
    setEntries((entRes.data || []) as JournalEntry[]);
    setAccounts((accRes.data || []) as GLAccount[]);
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
            dimensionsJson:
              l.dimensions && typeof l.dimensions === "object"
                ? JSON.stringify(l.dimensions)
                : typeof l.dimensions === "string"
                  ? l.dimensions
                  : "",
          }))
        : [{ id: crypto.randomUUID(), gl_account_id: "", debit: 0, credit: 0, line_description: "", dimensionsJson: "" }]
    );
  };

  const addEditLine = () => {
    setEditLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), gl_account_id: "", debit: 0, credit: 0, line_description: "", dimensionsJson: "" },
    ]);
  };

  const removeEditLine = (id: string) => {
    if (editLines.length <= 1) return;
    setEditLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateEditLine = (id: string, field: keyof EditLineRow, value: string | number) => {
    setEditLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  };

  const totalEditDr = editLines.reduce((s, l) => s + Number(l.debit) || 0, 0);
  const totalEditCr = editLines.reduce((s, l) => s + Number(l.credit) || 0, 0);
  const editBalanced = Math.abs(totalEditDr - totalEditCr) < 0.01;

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
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
      await supabase.from("journal_entries").update({ entry_date: editDate, description: editDescription.trim() }).eq("id", editingEntry.id);
      await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", editingEntry.id);
      const lineRows = validLines.map((l, i) => {
        let dimensions: Record<string, unknown> = {};
        const raw = (l.dimensionsJson || "").trim();
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (parsed && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
              dimensions = parsed as Record<string, unknown>;
            }
          } catch {
            /* ignore invalid JSON */
          }
        }
        return {
          journal_entry_id: editingEntry.id,
          gl_account_id: l.gl_account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          line_description: (l.line_description || "").trim() || null,
          sort_order: i,
          dimensions,
        };
      });
      await supabase.from("journal_entry_lines").insert(lineRows);
      setEditingEntry(null);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to save: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingEdit(false);
    }
  };

  const filtered = sourceFilter
    ? entries.filter((e) => (e.reference_type || "") === sourceFilter)
    : entries;

  const handleBackfill = async () => {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const result = await backfillJournalEntries();
      setBackfillResult(result);
      await fetchData();
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
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 bg-white min-w-[160px]"
          >
            {REFERENCE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleBackfill}
            disabled={backfilling}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Create journal entries for all existing transactions that don't have one yet"
          >
            <RefreshCw className={`w-4 h-4 ${backfilling ? "animate-spin" : ""}`} />
            {backfilling ? "Backfilling…" : "Backfill past transactions"}
          </button>
        </div>
      </div>

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
          <thead className="bg-slate-50">
            <tr>
              <th className="p-3 text-left">Transaction ID</th>
              <th className="p-3 text-left">Date</th>
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
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono text-slate-700">{e.transaction_id ?? "—"}</td>
                  <td className="p-3">{e.entry_date}</td>
                  <td className="p-3">
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                      {getReferenceTypeLabel(e.reference_type)}
                    </span>
                  </td>
                  <td className="p-3">{e.description}</td>
                  <td className="p-3 text-slate-700">{getDebitedAccounts(lineList)}</td>
                  <td className="p-3 text-slate-700">{getCreditedAccounts(lineList)}</td>
                  <td className="p-3 text-xs text-slate-600 max-w-[140px] truncate" title={formatDimensionsSummary(lineList)}>
                    {formatDimensionsSummary(lineList)}
                  </td>
                  <td className="p-3 text-right">{dr.toFixed(2)}</td>
                  <td className="p-3 text-right">{cr.toFixed(2)}</td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => openEdit(e)}
                      className="p-1.5 rounded text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                      title="Edit journal entry"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="p-8 text-center text-slate-500">
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
                  {editLines.map((line) => (
                    <div key={line.id} className="flex gap-2 items-center flex-wrap">
                      <select
                        value={line.gl_account_id}
                        onChange={(e) => updateEditLine(line.id, "gl_account_id", e.target.value)}
                        className="flex-1 min-w-[180px] border rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">Account</option>
                        {accountsForEdit.map((a) => (
                          <option key={a.id} value={a.id}>{a.account_code} – {a.account_name}</option>
                        ))}
                      </select>
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
                        value={line.dimensionsJson}
                        onChange={(e) => updateEditLine(line.id, "dimensionsJson", e.target.value)}
                        placeholder='Dimensions JSON e.g. {"branch":"Main"}'
                        title="Optional: branch, department_id for reporting"
                        className="w-full min-w-[200px] border rounded px-2 py-1.5 text-xs font-mono"
                      />
                      <button type="button" onClick={() => removeEditLine(line.id)} className="p-1 text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
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
                disabled={savingEdit || !editBalanced}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="w-4 h-4" /> {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
