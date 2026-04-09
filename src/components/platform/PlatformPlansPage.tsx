import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageNotes } from "@/components/common/PageNotes";

type Plan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number | null;
  sort_order: number;
  business_type_code: string | null;
};

type BusinessTypeRow = { id: string; code: string; name: string };

/** Standard tier columns (must match `subscription_plans.code` for each business type). */
const PLAN_TIER_COLUMNS = [
  { code: "starter", label: "Starter" },
  { code: "professional", label: "Professional" },
  { code: "enterprise", label: "Enterprise" },
] as const;

const emptyForm = (businessTypeCode: string) => ({
  business_type_code: businessTypeCode,
  code: "",
  name: "",
  description: "",
  price_monthly: "",
  price_yearly: "",
  sort_order: "0",
});

export function PlatformPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [businessTypes, setBusinessTypes] = useState<BusinessTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"edit" | "add" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(() => emptyForm("hotel"));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaultBusinessTypeCode = businessTypes[0]?.code ?? "hotel";

  const loadPlans = useCallback(async () => {
    setLoading(true);
    const [plansRes, btRes] = await Promise.all([
      supabase.from("subscription_plans").select("*").order("sort_order"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any).from("business_types").select("id,code,name,sort_order").order("sort_order", { ascending: true }),
    ]);
    if (plansRes.error) console.error(plansRes.error);
    const list = ((plansRes.data as Plan[]) || []).slice().sort((a, b) => {
      const bt = (a.business_type_code || "hotel").localeCompare(b.business_type_code || "hotel");
      if (bt !== 0) return bt;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    });
    setPlans(list);
    if (!btRes.error && btRes.data?.length) {
      setBusinessTypes(btRes.data as BusinessTypeRow[]);
    } else {
      setBusinessTypes([{ id: "hotel", code: "hotel", name: "Hotel" }]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const openEdit = (p: Plan) => {
    setErr(null);
    setEditingId(p.id);
    setForm({
      business_type_code: p.business_type_code || "hotel",
      code: p.code,
      name: p.name,
      description: p.description ?? "",
      price_monthly: String(p.price_monthly),
      price_yearly: String(p.price_yearly ?? ""),
      sort_order: String(p.sort_order ?? 0),
    });
    setModal("edit");
  };

  const openAdd = () => {
    setErr(null);
    setEditingId(null);
    setForm(emptyForm(defaultBusinessTypeCode));
    setModal("add");
  };

  const openAddForTier = (businessTypeCode: string, tierCode: string, tierLabel: string) => {
    setErr(null);
    setEditingId(null);
    setForm({
      ...emptyForm(businessTypeCode),
      code: tierCode,
      name: tierLabel,
    });
    setModal("add");
  };

  const applyMonthlyToYearly = () => {
    const m = parseFloat(form.price_monthly);
    if (!Number.isFinite(m)) return;
    setForm((f) => ({ ...f, price_yearly: String((Math.round(m * 12 * 100) / 100).toFixed(2)) }));
  };

  const handleSave = async () => {
    const code = form.code.trim().toLowerCase().replace(/\s+/g, "_");
    const name = form.name.trim();
    if (!code || !name) {
      setErr("Code and name are required.");
      return;
    }
    const pm = parseFloat(form.price_monthly);
    const py = parseFloat(form.price_yearly);
    if (!Number.isFinite(pm) || pm < 0) {
      setErr("Valid monthly price required.");
      return;
    }
    if (!Number.isFinite(py) || py < 0) {
      setErr("Valid yearly price required.");
      return;
    }
    const sort = parseInt(form.sort_order, 10);
    const sort_order = Number.isFinite(sort) ? sort : 0;
    const business_type_code = (form.business_type_code || "hotel").trim().toLowerCase();

    setSaving(true);
    setErr(null);

    if (modal === "add") {
      const { error } = await supabase.from("subscription_plans").insert({
        business_type_code,
        code,
        name,
        description: form.description.trim() || null,
        price_monthly: pm,
        price_yearly: py,
        sort_order,
      });
      setSaving(false);
      if (error) {
        setErr(error.message);
        return;
      }
    } else if (editingId) {
      const { error } = await supabase
        .from("subscription_plans")
        .update({
          business_type_code,
          code,
          name,
          description: form.description.trim() || null,
          price_monthly: pm,
          price_yearly: py,
          sort_order,
        })
        .eq("id", editingId);
      setSaving(false);
      if (error) {
        setErr(error.message);
        return;
      }
    }

    setModal(null);
    loadPlans();
  };

  const matrixRows = useMemo(() => {
    const rows: { code: string; name: string }[] = businessTypes.map((b) => ({ code: b.code, name: b.name }));
    const seen = new Set(rows.map((r) => r.code));
    const extraCodes = [
      ...new Set(plans.map((p) => p.business_type_code || "hotel").filter((c) => c && !seen.has(c))),
    ];
    extraCodes.sort().forEach((c) => {
      seen.add(c);
      rows.push({ code: c, name: c });
    });
    return rows;
  }, [businessTypes, plans]);

  if (loading) return <div className="p-8 text-slate-600">Loading plans…</div>;

  const typeCodes = new Set(businessTypes.map((b) => b.code));
  const orphanPlans = plans.filter((p) => !typeCodes.has(p.business_type_code || "hotel"));

  const planAt = (businessTypeCode: string, tierCode: string) =>
    plans.find((p) => (p.business_type_code || "hotel") === businessTypeCode && p.code === tierCode);

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Subscription plans</h1>
          <PageNotes ariaLabel="Subscription plans help">
            <p>Pricing is per business type (hotel, retail, …). The same plan code can exist once per type.</p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand-800 text-white rounded-lg hover:bg-brand-900 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Add plan
        </button>
      </div>

      <div className="mb-10 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm text-left">
          <caption className="sr-only">Subscription price matrix by business type and tier</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th scope="col" className="p-3 font-semibold text-slate-800 whitespace-nowrap">
                Business type
              </th>
              {PLAN_TIER_COLUMNS.map((col) => (
                <th key={col.code} scope="col" className="p-3 font-semibold text-slate-800 text-right whitespace-nowrap">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixRows.length === 0 ? (
              <tr>
                <td colSpan={1 + PLAN_TIER_COLUMNS.length} className="p-6 text-slate-500 text-center">
                  Add business types under Business types, then define plans below or use Add plan.
                </td>
              </tr>
            ) : (
              matrixRows.map((row) => (
                <tr key={row.code} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <th scope="row" className="p-3 font-medium text-slate-900 align-top whitespace-nowrap">
                    {row.name}
                  </th>
                  {PLAN_TIER_COLUMNS.map((col) => {
                    const p = planAt(row.code, col.code);
                    return (
                      <td key={col.code} className="p-3 text-right align-top">
                        {p ? (
                          <div className="inline-flex flex-col items-end gap-1">
                            <span className="font-semibold tabular-nums text-slate-900">
                              {Number(p.price_monthly).toFixed(2)}
                              <span className="text-slate-500 font-normal text-xs ml-1">/ mo</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => openEdit(p)}
                              className="text-xs text-brand-800 hover:underline"
                            >
                              Edit
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex flex-col items-end gap-0.5">
                            <span className="text-slate-300 tabular-nums">—</span>
                            <button
                              type="button"
                              onClick={() => openAddForTier(row.code, col.code, col.label)}
                              className="text-xs text-brand-800 hover:underline"
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-100 bg-slate-50/80">
          Rows follow Business types (plus any types that only appear on plans). Columns use plan codes{" "}
          <span className="font-mono">starter</span>, <span className="font-mono">professional</span>,{" "}
          <span className="font-mono">enterprise</span>. Click a dash to add that tier.
        </p>
      </div>

      <div className="space-y-6">
        {plans.length === 0 && (
          <p className="text-slate-500 text-sm border border-dashed border-slate-200 rounded-xl p-8 text-center">
            No subscription plans yet. Add one for each business type you support.
          </p>
        )}
        {businessTypes.map((bt) => {
          const rows = plans.filter((p) => (p.business_type_code || "hotel") === bt.code);
          if (rows.length === 0) return null;
          return (
            <div key={bt.code}>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{bt.name}</h2>
              <div className="space-y-4">
                {rows.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 flex justify-between items-start gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-900">{p.name}</h3>
                      <p className="text-xs text-slate-500 uppercase tracking-wide mt-1">{p.code}</p>
                      {p.description && <p className="text-sm text-slate-600 mt-2">{p.description}</p>}
                      <p className="text-xs text-slate-400 mt-2">Sort order: {p.sort_order}</p>
                    </div>
                    <div className="flex items-start gap-3 shrink-0">
                      <div className="text-right">
                        <p className="text-xl font-bold text-slate-900">{Number(p.price_monthly).toFixed(2)}</p>
                        <p className="text-xs text-slate-500">/ month</p>
                        {p.price_yearly != null && Number(p.price_yearly) >= 0 && (
                          <p className="text-sm text-slate-600 mt-1">
                            {Number(p.price_yearly).toFixed(2)} / year
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200"
                        title="Edit plan"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {orphanPlans.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3">
              Other business types (not in Business types list)
            </h2>
            <div className="space-y-4">
              {orphanPlans.map((p) => (
                <div
                  key={p.id}
                  className="bg-amber-50/80 border border-amber-200 rounded-xl p-5 flex justify-between items-start gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-amber-800 font-mono mb-1">{p.business_type_code || "hotel"}</p>
                    <h3 className="font-semibold text-slate-900">{p.name}</h3>
                    <p className="text-xs text-slate-500 uppercase tracking-wide mt-1">{p.code}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="p-2 text-slate-600 hover:bg-white rounded-lg border border-amber-300"
                    title="Edit plan"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              {modal === "add" ? "New subscription plan" : "Edit plan"}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              Code is a stable key (lowercase, underscores). Changing code does not affect existing
              subscriptions (they use plan ID).
            </p>
            {err && <p className="text-red-600 text-sm mb-3">{err}</p>}

            <label className="block text-sm font-medium text-slate-700 mb-1">Business type</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 bg-white"
              value={form.business_type_code}
              onChange={(e) => setForm((f) => ({ ...f, business_type_code: e.target.value }))}
            >
              {businessTypes.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>

            <label className="block text-sm font-medium text-slate-700 mb-1">Code</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 font-mono text-sm"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. professional"
            />

            <label className="block text-sm font-medium text-slate-700 mb-1">Display name</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />

            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 text-sm min-h-[72px]"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />

            <div className="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Monthly</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={form.price_monthly}
                  onChange={(e) => setForm((f) => ({ ...f, price_monthly: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Yearly</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                  value={form.price_yearly}
                  onChange={(e) => setForm((f) => ({ ...f, price_yearly: e.target.value }))}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={applyMonthlyToYearly}
              className="text-sm text-indigo-600 hover:underline mb-3"
            >
              Set yearly to 12 × monthly
            </button>

            <label className="block text-sm font-medium text-slate-700 mb-1">Sort order</label>
            <input
              type="number"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 max-w-[120px]"
              value={form.sort_order}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
            />

            <div className="flex gap-2 justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="inline-flex items-center gap-2 px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
