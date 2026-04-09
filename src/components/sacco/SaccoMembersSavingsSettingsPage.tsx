import { useCallback, useEffect, useState } from "react";
import { Hash, Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AdminSaccoAccountNumberSettingsPage } from "@/components/admin/AdminSaccoAccountNumberSettingsPage";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { PageNotes } from "@/components/common/PageNotes";
import { canEditSaccoSavingsSettings } from "@/lib/saccoSavingsSettingsAccess";
import {
  deleteSavingsProductType,
  fetchSavingsProductTypes,
  insertSavingsProductType,
  updateSavingsProductType,
  type SaccoSavingsProductTypeRow,
} from "@/lib/saccoSavingsProductTypes";

type TabId = "types" | "numbers";

type SaccoMembersSavingsSettingsPageProps = {
  /** Subscription / global read-only (e.g. inactive plan). */
  readOnly?: boolean;
};

export function SaccoMembersSavingsSettingsPage({ readOnly: subscriptionReadOnly = false }: SaccoMembersSavingsSettingsPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const canEdit = canEditSaccoSavingsSettings(user?.role) && !subscriptionReadOnly;

  const [tab, setTab] = useState<TabId>("types");
  const [rows, setRows] = useState<SaccoSavingsProductTypeRow[]>([]);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SaccoSavingsProductTypeRow | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formSort, setFormSort] = useState("0");

  const loadTypes = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      setTableMissing(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { rows: list, tableMissing: missing } = await fetchSavingsProductTypes(orgId);
      setRows(list);
      setTableMissing(missing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load account types");
      setRows([]);
      setTableMissing(false);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const openNew = () => {
    setEditing(null);
    setFormCode("");
    setFormName("");
    setFormDesc("");
    setFormSort("0");
    setShowModal(true);
  };

  const openEdit = (r: SaccoSavingsProductTypeRow) => {
    setEditing(r);
    setFormCode(r.code);
    setFormName(r.name);
    setFormDesc(r.description ?? "");
    setFormSort(String(r.sort_order));
    setShowModal(true);
  };

  const saveModal = async () => {
    if (!orgId || !canEdit) return;
    const code = formCode.trim().replace(/\s+/g, "");
    const name = formName.trim();
    if (!code || !name) {
      alert("Code and name are required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateSavingsProductType(editing.id, {
          code,
          name,
          description: formDesc.trim() || null,
          sort_order: parseInt(formSort, 10) || 0,
        });
      } else {
        await insertSavingsProductType(orgId, {
          code,
          name,
          description: formDesc.trim() || null,
          sort_order: parseInt(formSort, 10) || 0,
        });
      }
      setShowModal(false);
      await loadTypes();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: SaccoSavingsProductTypeRow) => {
    if (!canEdit) return;
    if (!confirm(`Remove savings type “${r.name}” (${r.code})?`)) return;
    try {
      await deleteSavingsProductType(r.id);
      await loadTypes();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const toggleActive = async (r: SaccoSavingsProductTypeRow) => {
    if (!canEdit) return;
    try {
      await updateSavingsProductType(r.id, { is_active: !r.is_active });
      await loadTypes();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (!orgId) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-slate-600 text-sm">Link your staff account to an organization to manage savings settings.</div>
    );
  }

  const tabBtn = (id: TabId, label: string, Icon: typeof Layers) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        tab === id ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </button>
  );

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Savings settings</h1>
        <PageNotes ariaLabel="Savings settings help">
          <p className="text-sm text-slate-700">
            Define savings account types (codes used when opening accounts) and the account number format. Who may edit is controlled in{" "}
            <strong className="font-medium text-slate-800">Admin → Approval rights → Savings &amp; member settings</strong>.
          </p>
        </PageNotes>
      </header>

      {subscriptionReadOnly && <ReadOnlyNotice message="Subscription inactive — changes are disabled." />}

      {!subscriptionReadOnly && !canEditSaccoSavingsSettings(user?.role) ? (
        <ReadOnlyNotice message="Your role cannot edit these settings. Ask an administrator to grant access under Admin → Approval rights → Savings & member settings." />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tabBtn("types", "Account types", Layers)}
        {tabBtn("numbers", "Account number format", Hash)}
      </div>

      {tab === "types" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
            <p className="text-sm text-slate-600">
              Each type has a <strong>code</strong> (e.g. <span className="font-mono">12</span>) — use the same code as the product code when opening a
              savings account.
            </p>
            <button
              type="button"
              onClick={openNew}
              disabled={!canEdit || tableMissing}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add type
            </button>
          </div>

          {tableMissing && (
            <div className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              The database table for savings account types is not installed yet (browser may show a 404 on that request). In{" "}
              <strong>Supabase → SQL Editor</strong>, run migration{" "}
              <code className="rounded bg-amber-100 px-1 font-mono text-xs">20260426120006_sacco_savings_product_types.sql</code>, then reload this page.
            </div>
          )}

          {error && (
            <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
              {error.includes("sacco_savings_product_types") || error.includes("schema") ? (
                <span className="block mt-1 text-xs">
                  Run migration <code className="font-mono bg-amber-100 px-1 rounded">20260426120006_sacco_savings_product_types.sql</code> on Supabase.
                </span>
              ) : null}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-slate-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
              Loading…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                    <th className="p-3 font-semibold">Code</th>
                    <th className="p-3 font-semibold">Name</th>
                    <th className="p-3 font-semibold">Order</th>
                    <th className="p-3 font-semibold">Status</th>
                    <th className="p-3 font-semibold text-right w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-emerald-50/40">
                      <td className="p-3 font-mono font-medium text-emerald-900">{r.code}</td>
                      <td className="p-3 text-slate-900">{r.name}</td>
                      <td className="p-3 text-slate-600 tabular-nums">{r.sort_order}</td>
                      <td className="p-3">
                        {r.is_active ? (
                          <span className="text-emerald-700 text-xs font-medium">Active</span>
                        ) : (
                          <span className="text-slate-500 text-xs">Inactive</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => void toggleActive(r)}
                            disabled={!canEdit}
                            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                          >
                            {r.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEdit(r)}
                            disabled={!canEdit}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(r)}
                            disabled={!canEdit}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && !error && (
                <p className="p-8 text-center text-sm text-slate-500">No account types yet. Add codes that match your savings products.</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "numbers" && <AdminSaccoAccountNumberSettingsPage readOnly={!canEdit} />}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">{editing ? "Edit account type" : "New account type"}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Code</label>
              <input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                placeholder="e.g. 12"
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="e.g. Ordinary savings"
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description (optional)</label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                rows={2}
                disabled={!canEdit}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Sort order</label>
              <input
                type="number"
                value={formSort}
                onChange={(e) => setFormSort(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                disabled={!canEdit}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveModal()}
                disabled={!canEdit || saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
