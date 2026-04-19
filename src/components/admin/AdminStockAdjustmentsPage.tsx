import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { randomUuid } from "../../lib/randomUuid";
import { PageNotes } from "../common/PageNotes";

interface Product {
  id: string;
  name: string;
  track_inventory?: boolean | null;
}

interface GLAccount {
  id: string;
  account_code: string;
  account_name: string;
}

interface AdjustmentRow {
  id: string;
  product_id: string;
  currentQty: number;
  newQty: string;
  qtyDelta: string;
}

export function AdminStockAdjustmentsPage({ highlightAdjustmentSourceId }: { highlightAdjustmentSourceId?: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [currentStock, setCurrentStock] = useState<Record<string, number>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [glAccountId, setGlAccountId] = useState("");
  const [rows, setRows] = useState<AdjustmentRow[]>([
    {
      id: randomUuid(),
      product_id: "",
      currentQty: 0,
      newQty: "",
      qtyDelta: "",
    },
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      const [{ data: productsData }, { data: moves }, { data: glData }] = await Promise.all([
        supabase.from("products").select("id, name, track_inventory").order("name"),
        supabase
          .from("product_stock_movements")
          .select("product_id, quantity_in, quantity_out"),
        supabase
          .from("gl_accounts")
          .select("id, account_code, account_name, account_type")
          .eq("account_type", "asset")
          .order("account_code"),
      ]);
      setProducts((productsData || []) as Product[]);
      setGlAccounts(
        (glData || []) as GLAccount[]
      );
      const stock: Record<string, number> = {};
      (moves || []).forEach((m: any) => {
        const pid = m.product_id as string;
        const delta = Number(m.quantity_in) - Number(m.quantity_out);
        stock[pid] = (stock[pid] || 0) + delta;
      });
      setCurrentStock(stock);
      setLoading(false);
    };
    loadData();
  }, []);

  const handleProductChange = (id: string, product_id: string) => {
    const currentQty = currentStock[product_id] ?? 0;
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              product_id,
              currentQty,
              newQty: "",
              qtyDelta: "",
            }
          : r
      )
    );
  };

  const handleNewQtyChange = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const newQtyNum = value === "" ? NaN : Number(value);
        const delta = !isNaN(newQtyNum) ? (newQtyNum - r.currentQty).toString() : "";
        return { ...r, newQty: value, qtyDelta: delta };
      })
    );
  };

  const handleDeltaChange = (id: string, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const deltaNum = value === "" ? NaN : Number(value);
        const newQtyVal = !isNaN(deltaNum)
          ? (r.currentQty + deltaNum).toString()
          : "";
        return { ...r, qtyDelta: value, newQty: newQtyVal };
      })
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: randomUuid(),
        product_id: "",
        currentQty: 0,
        newQty: "",
        qtyDelta: "",
      },
    ]);
  };

  const handleSave = async () => {
    const validRows = rows.filter((r) => {
      const delta = Number(r.qtyDelta);
      return r.product_id && !isNaN(delta) && delta !== 0;
    });
    if (validRows.length === 0) {
      alert("Enter at least one valid adjustment row (product and non-zero amount).");
      return;
    }
    if (!glAccountId) {
      if (!confirm("No GL account selected. Continue without tagging an account?")) {
        return;
      }
    }
    setSaving(true);
    try {
      const payload = validRows.map((r) => {
        const delta = Number(r.qtyDelta);
        return {
          product_id: r.product_id,
          movement_date: date
            ? new Date(date).toISOString()
            : new Date().toISOString(),
          source_type: "adjustment",
          source_id: null,
          quantity_in: delta > 0 ? delta : 0,
          quantity_out: delta < 0 ? Math.abs(delta) : 0,
          unit_cost: null,
          note:
            (glAccountId
              ? `GL ${glAccounts.find((g) => g.id === glAccountId)?.account_code ?? ""} - ${
                  glAccounts.find((g) => g.id === glAccountId)?.account_name ?? ""
                } | `
              : "") + (reason.trim() || "Manual adjustment"),
        };
      });
      await supabase.from("product_stock_movements").insert(payload);
      alert("Stock adjusted.");
      // Refresh current stock and reset rows
      const { data: moves } = await supabase
        .from("product_stock_movements")
        .select("product_id, quantity_in, quantity_out");
      const stock: Record<string, number> = {};
      (moves || []).forEach((m: any) => {
        const pid = m.product_id as string;
        const delta = Number(m.quantity_in) - Number(m.quantity_out);
        stock[pid] = (stock[pid] || 0) + delta;
      });
      setCurrentStock(stock);
      setRows([
        {
          id: randomUuid(),
          product_id: "",
          currentQty: 0,
          newQty: "",
          qtyDelta: "",
        },
      ]);
    } catch (e) {
      console.error(e);
      alert("Failed to save adjustments.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-8 text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      {highlightAdjustmentSourceId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Adjustment deep-link received ({highlightAdjustmentSourceId}), but this page currently has no adjustment history list to auto-highlight a specific row.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Stock Adjustments</h2>
        <PageNotes ariaLabel="Stock adjustments help">
          <p>Enter date and reason once, then adjust one or more items. Use either new quantity or amount adjusted per line.</p>
        </PageNotes>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 overflow-x-auto max-w-5xl">
        <div className="flex flex-wrap gap-4 mb-2">
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              className="border rounded-lg px-3 py-2"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Reason</label>
            <input
              className="border rounded-lg px-3 py-2 w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Stock count adjustment"
            />
          </div>
          <div className="min-w-[220px]">
            <label className="block text-sm font-medium mb-1">GL account affected (optional)</label>
            <select
              className="border rounded-lg px-3 py-2 w-full"
              value={glAccountId}
              onChange={(e) => setGlAccountId(e.target.value)}
            >
              <option value="">None</option>
              {glAccounts.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.account_code} – {g.account_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-right">Current Qty</th>
              <th className="p-2 text-right">New Qty</th>
              <th className="p-2 text-right">Amount Adjusted</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-2">
                  <select
                    className="border rounded-lg px-2 py-1 w-full"
                    value={r.product_id}
                    onChange={(e) => handleProductChange(r.id, e.target.value)}
                  >
                    <option value="">Select product</option>
                    {products
                      .filter((p) => p.track_inventory ?? true)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="p-2 text-right">
                  {r.currentQty.toFixed(2)}
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    className="border rounded-lg px-2 py-1 w-full text-right"
                    value={r.newQty}
                    onChange={(e) => handleNewQtyChange(r.id, e.target.value)}
                    placeholder="New quantity"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    className="border rounded-lg px-2 py-1 w-full text-right"
                    value={r.qtyDelta}
                    onChange={(e) => handleDeltaChange(r.id, e.target.value)}
                    placeholder="Amount adjusted"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between items-center pt-3">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
          >
            <Plus className="w-4 h-4" />
            Add row
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save adjustments"}
          </button>
        </div>
      </div>
    </div>
  );
}

