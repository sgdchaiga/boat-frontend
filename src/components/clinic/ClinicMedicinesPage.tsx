import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Layers, Pill } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { PageNotes } from "@/components/common/PageNotes";
import { CLINIC_DRUG_CATEGORIES } from "@/lib/clinicDrugCatalog";

type ProductRow = {
  id: string;
  name: string;
  sales_price: number | null;
  expiry_date: string | null;
  drug_category: string | null;
};

export function ClinicMedicinesPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let q = supabase
        .from("products")
        .select("id,name,sales_price,expiry_date,drug_category")
        .eq("active", true)
        .order("name");
      q = filterByOrganizationId(q, orgId, superAdmin);
      const { data, err } = await q;
      if (err) throw new Error(err.message);
      setRows(
        ((data || []) as ProductRow[]).map((r) => ({
          ...r,
          sales_price: r.sales_price == null ? null : Number(r.sales_price),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load medicines");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryOptions = useMemo(() => [...CLINIC_DRUG_CATEGORIES], []);

  const patchLocal = (id: string, patch: Partial<ProductRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const saveRow = async (r: ProductRow) => {
    if (!orgId) return;
    setSavingId(r.id);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("products")
        .update({
          expiry_date: r.expiry_date || null,
          drug_category: r.drug_category?.trim() || null,
        })
        .eq("id", r.id);
      if (upErr) throw new Error(upErr.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingId(null);
    }
  };

  if (!orgId) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
        <p className="text-sm text-slate-600">Select an organization to manage medicines.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Medicines &amp; stock</h1>
              <PageNotes ariaLabel="Clinic medicines help">
                <p>
                  <strong>Expiry tracking:</strong> optional per-item expiry date for shelf control.
                  <strong className="ml-1">Drug categories:</strong> antibiotics, painkillers, syrups, injections, consumables — used for reporting and sorting.
                </p>
              </PageNotes>
            </div>
            <p className="text-slate-600 text-sm mt-1 flex items-center gap-2">
              <Pill className="w-4 h-4 text-emerald-600 shrink-0" />
              Same product catalog as POS; changes apply at the next sync on the till.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div> : null}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-4 py-3">Medicine</th>
                  <th className="px-4 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" aria-hidden />
                      Expiry
                    </span>
                  </th>
                  <th className="px-4 py-3">
                    <span className="inline-flex items-center gap-1">
                      <Layers className="w-3.5 h-3.5" aria-hidden />
                      Category
                    </span>
                  </th>
                  <th className="px-4 py-3 w-32">Save</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-slate-600">
                      No active products. Add items under Stock → Items, then return here.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="text-xs text-slate-500">
                          Price: {r.sales_price != null ? Number(r.sales_price).toFixed(2) : "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <input
                          type="date"
                          value={r.expiry_date ? r.expiry_date.slice(0, 10) : ""}
                          onChange={(e) => patchLocal(r.id, { expiry_date: e.target.value || null })}
                          className="w-full min-w-[10rem] border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                        />
                      </td>
                      <td className="px-4 py-2 align-top">
                        <select
                          value={r.drug_category || ""}
                          onChange={(e) => patchLocal(r.id, { drug_category: e.target.value || null })}
                          className="w-full min-w-[10rem] border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white"
                        >
                          <option value="">—</option>
                          {categoryOptions.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <button
                          type="button"
                          disabled={savingId === r.id}
                          onClick={() => void saveRow(r)}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {savingId === r.id ? "Saving…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
