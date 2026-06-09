import { useEffect, useMemo, useState } from "react";
import { Download, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { createJournalEntry, type JournalPostResult } from "../../lib/journal";
import { businessTodayISO } from "../../lib/timezone";
import { orderGlAccountsWithExpensePreferences, fetchExpenseGlAccountPreferenceOrder } from "../../lib/manualJournalGlOptions";
import { GlAccountPicker, type GlAccountOption } from "../common/GlAccountPicker";
import { PageNotes } from "../common/PageNotes";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { randomUuid } from "../../lib/randomUuid";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";

type GLAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
};

type LineRow = {
  id: string;
  gl_account_id: string;
  debit: number;
  credit: number;
  line_description: string;
};

type PostedJournalLine = LineRow & {
  gl_accounts: GLAccount | null;
};

type PostedJournal = {
  id: string;
  transaction_id: string | null;
  entry_date: string;
  description: string;
  journal_entry_lines?: PostedJournalLine[];
};

export function ManualJournalsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [expenseGlPreferenceOrder, setExpenseGlPreferenceOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [postedJournals, setPostedJournals] = useState<PostedJournal[]>([]);
  const [journalsLoading, setJournalsLoading] = useState(true);
  const [fromDateFilter, setFromDateFilter] = useState("");
  const [toDateFilter, setToDateFilter] = useState("");
  const [journalNumberFilter, setJournalNumberFilter] = useState("");
  const [descriptionFilter, setDescriptionFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [entryDate, setEntryDate] = useState(() => businessTodayISO());
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<LineRow[]>([
    { id: "1", gl_account_id: "", debit: 0, credit: 0, line_description: "" },
    { id: "2", gl_account_id: "", debit: 0, credit: 0, line_description: "" },
  ]);

  const glOptions: GlAccountOption[] = useMemo(
    () => orderGlAccountsWithExpensePreferences(accounts, expenseGlPreferenceOrder),
    [accounts, expenseGlPreferenceOrder]
  );

  useEffect(() => {
    void fetchAccounts();
  }, [orgId, superAdmin]);

  useEffect(() => {
    void fetchPostedJournals();
  }, [orgId, superAdmin, fromDateFilter, toDateFilter, journalNumberFilter]);

  const fetchAccounts = async () => {
    if (!orgId && !superAdmin) {
      setAccounts([]);
      setExpenseGlPreferenceOrder([]);
      setLoading(false);
      return;
    }
    const [accRes, prefOrder] = await Promise.all([
      filterByOrganizationId(
        supabase
          .from("gl_accounts")
          .select("*")
          .order("account_code"),
        orgId,
        superAdmin
      ),
      fetchExpenseGlAccountPreferenceOrder(orgId, superAdmin),
    ]);
    const normalized = normalizeGlAccountRows((accRes.data || []) as unknown[]).filter((row) => row.is_active);
    setAccounts(normalized as GLAccount[]);
    setExpenseGlPreferenceOrder(prefOrder);
    setLoading(false);
  };

  const fetchPostedJournals = async () => {
    if (!orgId && !superAdmin) {
      setPostedJournals([]);
      setJournalsLoading(false);
      return;
    }
    setJournalsLoading(true);
    let query = supabase
      .from("journal_entries")
      .select("id, transaction_id, entry_date, description, journal_entry_lines(id, gl_account_id, debit, credit, line_description, gl_accounts(id, account_code, account_name, account_type))")
      .eq("reference_type", "manual")
      .eq("is_posted", true)
      .eq("is_deleted", false)
      .order("entry_date", { ascending: false })
      .limit(500);
    if (fromDateFilter) query = query.gte("entry_date", fromDateFilter);
    if (toDateFilter) query = query.lte("entry_date", toDateFilter);
    if (journalNumberFilter.trim()) query = query.ilike("transaction_id", `%${journalNumberFilter.trim()}%`);
    const scoped = filterByOrganizationId(query, orgId, superAdmin);
    const { data, error } = await scoped;
    if (error) {
      console.error("[Manual journals] Failed to load posted journals", error);
      setPostedJournals([]);
    } else {
      setPostedJournals((data || []) as PostedJournal[]);
    }
    setJournalsLoading(false);
  };

  const addLine = () => {
    setLines((prev) => [...prev, { id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "" }]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 2) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, field: keyof LineRow, value: string | number) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  };

  const totalDebits = lines.reduce((s, l) => s + Number(l.debit) || 0, 0);
  const totalCredits = lines.reduce((s, l) => s + Number(l.credit) || 0, 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01;

  const handleSave = async () => {
    if (!description.trim()) {
      alert("Enter a description.");
      return;
    }
    const validLines = lines.filter((l) => l.gl_account_id && (Number(l.debit) > 0 || Number(l.credit) > 0));
    if (validLines.length < 2) {
      alert("Add at least two lines with account and debit or credit.");
      return;
    }
    if (!isBalanced) {
      alert("Total debits must equal total credits.");
      return;
    }

    setSaving(true);
    try {
      const savedLines = validLines.map((l, index) => ({
          gl_account_id: l.gl_account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          line_description: l.line_description.trim() || null,
          sort_order: index,
          dimensions: {},
        }));
      const result: JournalPostResult = editingJournalId
        ? await (async () => {
            const { error } = await supabase.rpc("update_journal_entry_safe_with_audit", {
              p_entry_id: editingJournalId,
              p_entry_date: entryDate,
              p_description: description.trim(),
              p_lines: savedLines,
              p_updated_by: user?.id ?? null,
            });
            return error ? { ok: false as const, error: error.message } : { ok: true as const, journalId: editingJournalId };
          })()
        : await createJournalEntry({
            entry_date: entryDate,
            description: description.trim(),
            reference_type: "manual",
            reference_id: null,
            lines: savedLines,
            created_by: user?.id || null,
          });

      if (result.ok) {
        setShowForm(false);
        setEditingJournalId(null);
        setDescription("");
        setEntryDate(businessTodayISO());
        setLines([
          { id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "" },
          { id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "" },
        ]);
        await fetchPostedJournals();
      } else {
        alert("Failed to save journal entry: " + result.error);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to save: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const openNew = () => {
    setEditingJournalId(null);
    setEntryDate(businessTodayISO());
    setDescription("");
    setLines([
      { id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "" },
      { id: randomUuid(), gl_account_id: "", debit: 0, credit: 0, line_description: "" },
    ]);
    setShowForm(true);
  };

  const openEdit = (journal: PostedJournal) => {
    setEditingJournalId(journal.id);
    setEntryDate(journal.entry_date);
    setDescription(journal.description || "");
    const journalLines = journal.journal_entry_lines || [];
    setLines(journalLines.map((line) => ({
      id: line.id || randomUuid(),
      gl_account_id: line.gl_account_id,
      debit: Number(line.debit || 0),
      credit: Number(line.credit || 0),
      line_description: line.line_description || "",
    })));
    setShowForm(true);
  };

  const filteredJournals = useMemo(() => {
    const descNeedle = descriptionFilter.trim().toLowerCase();
    const accountNeedle = accountFilter.trim().toLowerCase();
    return postedJournals.filter((journal) => {
      if (descNeedle && !journal.description.toLowerCase().includes(descNeedle)) return false;
      if (accountNeedle) {
        const matches = (journal.journal_entry_lines || []).some((line) => {
          const account = line.gl_accounts;
          return account && `${account.account_code} ${account.account_name}`.toLowerCase().includes(accountNeedle);
        });
        if (!matches) return false;
      }
      return true;
    });
  }, [postedJournals, descriptionFilter, accountFilter]);

  const exportCsv = () => {
    const header = ["Journal number", "Date", "Description", "Account", "Line memo", "Debit", "Credit"];
    const rows = filteredJournals.flatMap((journal) =>
      (journal.journal_entry_lines || []).map((line) => [
        journal.transaction_id || "",
        journal.entry_date,
        journal.description,
        line.gl_accounts ? `${line.gl_accounts.account_code} ${line.gl_accounts.account_name}` : "",
        line.line_description || "",
        Number(line.debit || 0).toFixed(2),
        Number(line.credit || 0).toFixed(2),
      ])
    );
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `posted_manual_journals_${businessTodayISO()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="p-6">Loading accounts...</div>;

  return (
    <div className="p-6 md:p-8">
      <div className="flex justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Manual Journals</h1>
            <PageNotes ariaLabel="Manual journals help">
              <p>Enter manual debit and credit journal entries.</p>
              <p>
                Manual journal entries appear on the Journal Entries page with source &quot;Manual&quot;. Other sources include room charges, POS,
                GRN/Bills (including from purchase orders), approvals, vendor payments, vendor credits, and expenses.
              </p>
              <p>
                <strong className="text-slate-800">Expense GLs:</strong> accounts used on <strong>Purchases → Expenses</strong> lines are listed first
                in each picker so you can match manual adjustments to the same codes.
              </p>
              <p>
                <strong className="text-slate-800">VAT:</strong> add lines as needed — e.g. debit expense (net), debit input VAT, credit bank.
                Search by code or name to pick any account, including VAT.
              </p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="bg-brand-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-800"
        >
          <Plus className="w-5 h-5" /> New Manual Entry
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Posted manual journals</h2>
            <p className="text-xs text-slate-500">Showing up to 500 posted entries. Edits are saved with an audit revision.</p>
          </div>
          <button type="button" onClick={exportCsv} disabled={filteredJournals.length === 0} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> Export filtered CSV
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input type="date" value={fromDateFilter} onChange={(e) => setFromDateFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="From date" />
          <input type="date" value={toDateFilter} onChange={(e) => setToDateFilter(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="To date" />
          <input value={journalNumberFilter} onChange={(e) => setJournalNumberFilter(e.target.value)} placeholder="Journal number" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={descriptionFilter} onChange={(e) => setDescriptionFilter(e.target.value)} placeholder="Description" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} placeholder="Account code or name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        {(fromDateFilter || toDateFilter || journalNumberFilter || descriptionFilter || accountFilter) ? (
          <button type="button" onClick={() => { setFromDateFilter(""); setToDateFilter(""); setJournalNumberFilter(""); setDescriptionFilter(""); setAccountFilter(""); }} className="mt-3 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
            <X className="h-4 w-4" /> Clear filters
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-slate-50"><tr><th className="p-3 text-left">Journal number</th><th className="p-3 text-left">Date</th><th className="p-3 text-left">Description</th><th className="p-3 text-left">Debited accounts</th><th className="p-3 text-left">Credited accounts</th><th className="p-3 text-right">Amount</th><th className="p-3 text-center">Action</th></tr></thead>
          <tbody>
            {journalsLoading ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500">Loading posted journals...</td></tr>
            ) : filteredJournals.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-500">No posted manual journals match the filters.</td></tr>
            ) : filteredJournals.map((journal) => {
              const journalLines = journal.journal_entry_lines || [];
              const debitAccounts = journalLines.filter((line) => Number(line.debit) > 0).map((line) => line.gl_accounts ? `${line.gl_accounts.account_code} ${line.gl_accounts.account_name}` : "Unknown").join(", ");
              const creditAccounts = journalLines.filter((line) => Number(line.credit) > 0).map((line) => line.gl_accounts ? `${line.gl_accounts.account_code} ${line.gl_accounts.account_name}` : "Unknown").join(", ");
              const amount = journalLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
              return <tr key={journal.id} className="border-t border-slate-100">
                <td className="p-3 font-mono text-slate-700">{journal.transaction_id || "—"}</td><td className="p-3 whitespace-nowrap">{journal.entry_date}</td><td className="p-3 max-w-[260px] truncate" title={journal.description}>{journal.description}</td>
                <td className="p-3 max-w-[220px] truncate text-emerald-700" title={debitAccounts}>{debitAccounts || "—"}</td><td className="p-3 max-w-[220px] truncate text-violet-700" title={creditAccounts}>{creditAccounts || "—"}</td>
                <td className="p-3 text-right font-medium tabular-nums">{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="p-3 text-center"><button type="button" onClick={() => openEdit(journal)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-50"><Pencil className="h-4 w-4" /> Edit</button></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-8 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">{editingJournalId ? "Edit Posted Manual Journal" : "New Manual Journal Entry"}</h2>
              <button type="button" onClick={() => { setShowForm(false); setEditingJournalId(null); }}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Entry date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description *</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g. Adjustment for March"
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Lines (Debit / Credit)</label>
                  <button type="button" onClick={addLine} className="text-sm text-blue-600 hover:underline">+ Add line</button>
                </div>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {lines.map((line) => (
                    <div key={line.id} className="flex gap-2 items-start flex-wrap border-b border-slate-100 pb-3">
                      <div className="flex-1 min-w-[220px]">
                        <GlAccountPicker
                          value={line.gl_account_id}
                          onChange={(id) => updateLine(line.id, "gl_account_id", id)}
                          options={glOptions}
                          emptyOption={{ label: "Select account" }}
                          placeholder="Search GL (code or name)…"
                          className="w-full"
                        />
                      </div>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.debit || ""}
                        onChange={(e) => {
                          updateLine(line.id, "debit", e.target.value ? Number(e.target.value) : 0);
                          if (Number(e.target.value) > 0) updateLine(line.id, "credit", 0);
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
                          updateLine(line.id, "credit", e.target.value ? Number(e.target.value) : 0);
                          if (Number(e.target.value) > 0) updateLine(line.id, "debit", 0);
                        }}
                        placeholder="Credit"
                        className="w-24 border rounded px-2 py-1.5 text-sm text-right"
                      />
                      <input
                        type="text"
                        value={line.line_description}
                        onChange={(e) => updateLine(line.id, "line_description", e.target.value)}
                        placeholder="Memo"
                        className="flex-1 min-w-[100px] border rounded px-2 py-1.5 text-sm"
                      />
                      <button type="button" onClick={() => removeLine(line.id)} className="p-1 text-red-600 hover:bg-red-50 rounded shrink-0"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
                <p className={`text-sm mt-2 ${isBalanced ? "text-emerald-600" : "text-amber-600"}`}>
                  Total Debits: {totalDebits.toFixed(2)} — Total Credits: {totalCredits.toFixed(2)} {isBalanced ? "✓ Balanced" : "(must be equal)"}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button type="button" onClick={() => { setShowForm(false); setEditingJournalId(null); }} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving || !isBalanced || accounts.length === 0} className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
                <Save className="w-4 h-4" /> {saving ? "Saving…" : editingJournalId ? "Save audited edit" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
