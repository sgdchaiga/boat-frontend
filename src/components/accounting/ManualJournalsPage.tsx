import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Save, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { createJournalEntry, type JournalPostResult } from "../../lib/journal";
import { businessTodayISO } from "../../lib/timezone";
import { orderGlAccountsWithExpensePreferences, fetchExpenseGlAccountPreferenceOrder } from "../../lib/manualJournalGlOptions";
import { GlAccountPicker, type GlAccountOption } from "../common/GlAccountPicker";
import { PageNotes } from "../common/PageNotes";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

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

export function ManualJournalsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [expenseGlPreferenceOrder, setExpenseGlPreferenceOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
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
          .select("id, account_code, account_name, account_type")
          .eq("is_active", true)
          .order("account_code"),
        orgId,
        superAdmin
      ),
      fetchExpenseGlAccountPreferenceOrder(orgId, superAdmin),
    ]);
    setAccounts((accRes.data || []) as GLAccount[]);
    setExpenseGlPreferenceOrder(prefOrder);
    setLoading(false);
  };

  const addLine = () => {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), gl_account_id: "", debit: 0, credit: 0, line_description: "" }]);
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
      const result: JournalPostResult = await createJournalEntry({
        entry_date: entryDate,
        description: description.trim(),
        reference_type: "manual",
        reference_id: null,
        lines: validLines.map((l) => ({
          gl_account_id: l.gl_account_id,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          line_description: l.line_description.trim() || null,
        })),
        created_by: user?.id || null,
      });

      if (result.ok) {
        setShowForm(false);
        setDescription("");
        setEntryDate(businessTodayISO());
        setLines([
          { id: crypto.randomUUID(), gl_account_id: "", debit: 0, credit: 0, line_description: "" },
          { id: crypto.randomUUID(), gl_account_id: "", debit: 0, credit: 0, line_description: "" },
        ]);
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
          onClick={() => setShowForm(true)}
          className="bg-brand-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-brand-800"
        >
          <Plus className="w-5 h-5" /> New Manual Entry
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full my-8 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">New Manual Journal Entry</h2>
              <button type="button" onClick={() => setShowForm(false)}><X className="w-5 h-5" /></button>
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
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
              <button type="button" onClick={handleSave} disabled={saving || !isBalanced || accounts.length === 0} className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
                <Save className="w-4 h-4" /> {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
