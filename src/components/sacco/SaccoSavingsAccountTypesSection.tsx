import { useCallback, useEffect, useState } from "react";
import { Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  deleteSavingsProductType,
  fetchSavingsProductTypes,
  insertSavingsProductType,
  updateSavingsProductType,
  type SaccoSavingsProductTypeRow,
} from "@/lib/saccoSavingsProductTypes";

type SaccoSavingsAccountTypesSectionProps = {
  readOnly?: boolean;
  /** Compact layout for embedding on the account-number format screen. */
  compact?: boolean;
  /** Highlight / use a type code (e.g. numbering preview). */
  selectedCode?: string;
  onSelectCode?: (code: string) => void;
  /** Called after types are added, updated, or removed. */
  onTypesChanged?: () => void;
};

export function SaccoSavingsAccountTypesSection({
  readOnly = false,
  compact = false,
  selectedCode,
  onSelectCode,
  onTypesChanged,
}: SaccoSavingsAccountTypesSectionProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;

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

  const notifyTypesChanged = async () => {
    await loadTypes();
    onTypesChanged?.();
  };

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  const openNew = () => {
    setEditing(null);
    setFormCode("");
    setFormName("");
    setFormDesc("");
    setFormSort(String(rows.length));
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
    if (!orgId || readOnly) return;
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
      await notifyTypesChanged();
      if (!editing) onSelectCode?.(code);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: SaccoSavingsProductTypeRow) => {
    if (readOnly) return;
    if (!confirm(`Remove savings type “${r.name}” (${r.code})?`)) return;
    try {
      await deleteSavingsProductType(r.id);
      await notifyTypesChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const toggleActive = async (r: SaccoSavingsProductTypeRow) => {
    if (readOnly) return;
    try {
      await updateSavingsProductType(r.id, { is_active: !r.is_active });
      await notifyTypesChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    }
  };

  if (!orgId) return null;

  return (
    <div className={compact ? "rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3" : "space-y-3"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Layers className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Savings account types</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Each type has a numeric <strong>code</strong> (e.g. <span className="font-mono">12</span>) used in account numbers and when opening accounts.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openNew}
          disabled={readOnly || tableMissing}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add account type
        </button>
      </div>

      {tableMissing && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          The database table is not installed yet. In <strong>Supabase → SQL Editor</strong>, run migration{" "}
          <code className="rounded bg-amber-100 px-1 font-mono text-xs">20260426120006_sacco_savings_product_types.sql</code>, then reload.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-slate-500 text-sm justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          Loading account types…
        </div>
      ) : rows.length === 0 && !error ? (
        <p className="text-sm text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-lg bg-white">
          No account types yet. Click <strong>Add account type</strong> to define codes for ordinary savings, shares, fixed deposit, etc.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <th className="p-2.5 font-semibold">Code</th>
                <th className="p-2.5 font-semibold">Name</th>
                {!compact && <th className="p-2.5 font-semibold">Order</th>}
                <th className="p-2.5 font-semibold">Status</th>
                <th className="p-2.5 font-semibold text-right w-32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const isSelected = selectedCode != null && selectedCode === r.code;
                return (
                  <tr
                    key={r.id}
                    className={`hover:bg-emerald-50/40 ${isSelected ? "bg-emerald-50/70" : ""} ${onSelectCode ? "cursor-pointer" : ""}`}
                    onClick={onSelectCode ? () => onSelectCode(r.code) : undefined}
                  >
                    <td className="p-2.5 font-mono font-medium text-emerald-900">{r.code}</td>
                    <td className="p-2.5 text-slate-900">{r.name}</td>
                    {!compact && <td className="p-2.5 text-slate-600 tabular-nums">{r.sort_order}</td>}
                    <td className="p-2.5">
                      {r.is_active ? (
                        <span className="text-emerald-700 text-xs font-medium">Active</span>
                      ) : (
                        <span className="text-slate-500 text-xs">Inactive</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        {onSelectCode ? (
                          <button
                            type="button"
                            onClick={() => onSelectCode(r.code)}
                            className="rounded px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 font-medium"
                          >
                            Use
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void toggleActive(r)}
                          disabled={readOnly}
                          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          {r.is_active ? "Off" : "On"}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={readOnly}
                          className="inline-flex items-center rounded px-2 py-1 text-xs border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(r)}
                          disabled={readOnly}
                          className="inline-flex items-center rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">{editing ? "Edit account type" : "New account type"}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Code</label>
              <input
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.replace(/\s/g, ""))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                placeholder="e.g. 12"
                disabled={readOnly}
                inputMode="numeric"
              />
              <p className="text-[10px] text-slate-500 mt-1">Numeric code padded into the account-type segment of savings account numbers.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                placeholder="e.g. Ordinary savings"
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Description (optional)</label>
              <textarea
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                rows={2}
                disabled={readOnly}
              />
            </div>
            {!compact && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sort order</label>
                <input
                  type="number"
                  value={formSort}
                  onChange={(e) => setFormSort(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  disabled={readOnly}
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveModal()}
                disabled={readOnly || saving}
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
