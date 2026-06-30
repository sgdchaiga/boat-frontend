import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Upload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { randomUuid } from "../../lib/randomUuid";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterStockMovementsByOrganizationId } from "../../lib/supabaseOrgFilter";
import { ensureActiveOrganization, loadStockBulkImportContext } from "../../lib/stockBulkImport";
import { PageNotes } from "../common/PageNotes";
import { normalizeGlAccountRows } from "../../lib/glAccountNormalize";
import { StockBulkImportPanel } from "../inventory/StockBulkImportPanel";
import { businessTodayISO, toBusinessDateString } from "../../lib/timezone";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import { canApprove } from "../../lib/permissions";
import { createJournalForStockAdjustment, deleteJournalEntryByReference } from "../../lib/journal";

interface Product {
  id: string;
  name: string;
  track_inventory?: boolean | null;
}

interface GLAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

interface AdjustmentRow {
  id: string;
  product_id: string;
  currentQty: number;
  newQty: string;
  qtyDelta: string;
}

interface AdjustmentHistoryRow {
  source_id: string;
  movement_date: string;
  created_at: string | null;
  created_by_staff_id: string | null;
  created_by_name: string | null;
  note: string | null;
  lines: number;
  totalAmount: number;
  closingStock: number | null;
}

type AdjustmentTab = "manual" | "import";

function closingStockFromNote(note: string | null): number | null {
  const raw = /\[CLOSING_STOCK:([+-]?\d+(?:\.\d+)?)\]/.exec(String(note || ""))?.[1];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function adjustmentReasonFromNote(note: string | null): string {
  return String(note || "Manual adjustment")
    .replace(/^GL .*?\| /, "")
    .replace(/\s*\[CLOSING_STOCK:[^\]]+\]\s*$/, "")
    .trim();
}

export function AdminStockAdjustmentsPage({
  highlightAdjustmentSourceId,
  readOnly = false,
}: {
  highlightAdjustmentSourceId?: string;
  readOnly?: boolean;
}) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = Boolean(isSuperAdmin);
  const canDeleteAdjustments = superAdmin || canApprove("stock_adjustments_delete", user?.role);
  const [tab, setTab] = useState<AdjustmentTab>("manual");
  const [products, setProducts] = useState<Product[]>([]);
  const [currentStock, setCurrentStock] = useState<Record<string, number>>({});
  const [date, setDate] = useState(businessTodayISO);
  const [reason, setReason] = useState("");
  const [glAccounts, setGlAccounts] = useState<GLAccount[]>([]);
  const [inventoryGlAccountId, setInventoryGlAccountId] = useState("");
  const [stockGainLossGlAccountId, setStockGainLossGlAccountId] = useState("");
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
  const [loadingStockSnapshot, setLoadingStockSnapshot] = useState(false);
  const [history, setHistory] = useState<AdjustmentHistoryRow[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);

  const loadStockSnapshot = async (asAtDate = date) => {
    if (orgId) await ensureActiveOrganization(orgId);
    const context = await loadStockBulkImportContext(orgId, superAdmin, asAtDate);
    const stock = context.currentStock;
    setCurrentStock(stock);
    return stock;
  };

  const handleDateChange = async (nextDate: string) => {
    setDate(nextDate);
    if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
    setLoadingStockSnapshot(true);
    try {
      const stock = await loadStockSnapshot(nextDate);
      setRows((prev) =>
        prev.map((row) => {
          if (!row.product_id) return row;
          const currentQty = stock[row.product_id] ?? 0;
          const newQtyNumber = row.newQty === "" ? Number.NaN : Number(row.newQty);
          return {
            ...row,
            currentQty,
            qtyDelta: Number.isFinite(newQtyNumber) ? String(newQtyNumber - currentQty) : "",
          };
        })
      );
    } catch (e) {
      console.error("[Stock adjustments] dated stock snapshot failed:", e);
      alert("Failed to load stock balances for the selected date.");
    } finally {
      setLoadingStockSnapshot(false);
    }
  };

  const loadAdjustmentHistory = async () => {
    if (orgId) await ensureActiveOrganization(orgId);
    const { data } = await filterStockMovementsByOrganizationId(
      supabase
        .from("product_stock_movements")
        .select("source_id,movement_date,created_at,created_by_staff_id,note,quantity_in,quantity_out")
        .eq("source_type", "adjustment")
        .not("source_id", "is", null)
        .order("created_at", { ascending: false }),
      orgId
    );
    const staffIds = Array.from(
      new Set(
        (data || [])
          .map((row: any) => String(row.created_by_staff_id || ""))
          .filter(Boolean)
      )
    );
    const staffNameById = new Map<string, string>();
    if (staffIds.length > 0) {
      const { data: staffData } = await filterByOrganizationId(
        supabase.from("staff").select("id,full_name").in("id", staffIds),
        orgId,
        superAdmin
      );
      (staffData || []).forEach((staff: { id: string; full_name: string }) => {
        staffNameById.set(staff.id, staff.full_name);
      });
    }
    const grouped = new Map<string, AdjustmentHistoryRow>();
    (data || []).forEach((row: any) => {
      const sourceId = String(row.source_id || "");
      if (!sourceId) return;
      const qtyDelta = Number(row.quantity_in || 0) - Number(row.quantity_out || 0);
      const createdByStaffId = row.created_by_staff_id ? String(row.created_by_staff_id) : null;
      const prev = grouped.get(sourceId) || {
        source_id: sourceId,
        movement_date: String(row.movement_date || new Date().toISOString()),
        created_at: row.created_at ? String(row.created_at) : null,
        created_by_staff_id: createdByStaffId,
        created_by_name: createdByStaffId ? staffNameById.get(createdByStaffId) ?? null : null,
        note: (row.note as string | null) ?? null,
        lines: 0,
        totalAmount: 0,
        closingStock: closingStockFromNote((row.note as string | null) ?? null),
      };
      prev.lines += 1;
      prev.totalAmount += qtyDelta;
      if (prev.lines > 1) prev.closingStock = null;
      if (new Date(row.movement_date).getTime() > new Date(prev.movement_date).getTime()) {
        prev.movement_date = row.movement_date;
      }
      if (
        row.created_at &&
        (!prev.created_at || new Date(row.created_at).getTime() > new Date(prev.created_at).getTime())
      ) {
        prev.created_at = row.created_at;
        prev.created_by_staff_id = createdByStaffId;
        prev.created_by_name = createdByStaffId ? staffNameById.get(createdByStaffId) ?? null : null;
      }
      grouped.set(sourceId, prev);
    });
    setHistory(
      Array.from(grouped.values()).sort(
        (a, b) =>
          new Date(b.created_at || b.movement_date).getTime() -
          new Date(a.created_at || a.movement_date).getTime()
      )
    );
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        if (orgId) await ensureActiveOrganization(orgId);
        const [{ data: productsData }, stockContext, { data: glData }] = await Promise.all([
          filterByOrganizationId(
            supabase.from("products").select("id, name, track_inventory").order("name"),
            orgId,
            superAdmin
          ),
          loadStockBulkImportContext(orgId, superAdmin, date),
          supabase.from("gl_accounts").select("*").order("account_code"),
        ]);
        setProducts((productsData || []) as Product[]);
        const normalizedGl = normalizeGlAccountRows((glData || []) as unknown[])
          .map((row) => ({
            id: row.id,
            account_code: row.account_code,
            account_name: row.account_name,
            account_type: row.account_type,
          }));
        setGlAccounts(normalizedGl as GLAccount[]);
        const stock: Record<string, number> = {};
        Object.assign(stock, stockContext.currentStock);
        setCurrentStock(stock);
        await loadAdjustmentHistory();
      } catch (e) {
        console.error("[Stock adjustments] load failed:", e);
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, [orgId, superAdmin]);

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

  const openAdjustmentDetails = async (sourceId: string) => {
    if (orgId) await ensureActiveOrganization(orgId);
    const { data } = await filterStockMovementsByOrganizationId(
      supabase
        .from("product_stock_movements")
        .select("id,product_id,movement_date,note,quantity_in,quantity_out")
        .eq("source_type", "adjustment")
        .eq("source_id", sourceId)
        .order("movement_date", { ascending: true }),
      orgId
    );
    const rowsData = (data || []) as Array<{
      product_id: string;
      movement_date: string;
      note: string | null;
      quantity_in: number;
      quantity_out: number;
    }>;
    if (rowsData.length === 0) return;
    const effectiveDate = toBusinessDateString(rowsData[0].movement_date);
    const { data: allMovementData } = await filterStockMovementsByOrganizationId(
      supabase
        .from("product_stock_movements")
        .select("product_id,source_id,movement_date,quantity_in,quantity_out,source_type,note"),
      orgId
    );
    const effectiveEnd = new Date(`${effectiveDate}T23:59:59.999+03:00`).getTime();
    setSelectedSourceId(sourceId);
    setEditingSourceId(sourceId);
    setDate(effectiveDate);
    setReason(adjustmentReasonFromNote(rowsData[0].note));
    const glCode = /^GL\s+(.+?)\s+-\s+/.exec(String(rowsData[0].note || ""))?.[1]?.trim();
    const inventoryGlFromNote = /\[INV_GL:([0-9a-f-]{32,36})\]/i.exec(String(rowsData[0].note || ""))?.[1] ?? null;
    const plGlFromNote = /\[PL_GL:([0-9a-f-]{32,36})\]/i.exec(String(rowsData[0].note || ""))?.[1] ?? null;
    setInventoryGlAccountId(
      inventoryGlFromNote ?? (glCode ? glAccounts.find((account) => account.account_code === glCode)?.id ?? "" : "")
    );
    setStockGainLossGlAccountId(plGlFromNote ?? "");
    setRows(
      rowsData.map((row) => {
        const qtyDelta = Number(row.quantity_in || 0) - Number(row.quantity_out || 0);
        const recordedClosingQty = closingStockFromNote(row.note);
        const currentQty = (allMovementData || []).reduce((total: number, movement: any) => {
          if (String(movement.product_id) !== row.product_id || String(movement.source_id || "") === sourceId) return total;
          const movementMs = new Date(movement.movement_date).getTime();
          if (!Number.isFinite(movementMs) || movementMs > effectiveEnd) return total;
          const { inQty, outQty } = effectiveStockMovementInOut(movement);
          return total + inQty - outQty;
        }, 0);
        return {
          id: randomUuid(),
          product_id: row.product_id,
          currentQty,
          newQty: String(recordedClosingQty ?? currentQty + qtyDelta),
          qtyDelta: qtyDelta.toString(),
        };
      })
    );
  };

  const deleteAdjustmentBatch = async (adjustment: AdjustmentHistoryRow) => {
    if (readOnly || !canDeleteAdjustments || deletingSourceId) return;
    const effectiveDate = toBusinessDateString(adjustment.movement_date);
    const confirmed = window.confirm(
      `Delete stock adjustment ${adjustment.source_id.slice(0, 8)}?\n\n` +
        `Effective date: ${effectiveDate}\n` +
        `Reason: ${adjustmentReasonFromNote(adjustment.note)}\n` +
        `Lines: ${adjustment.lines}\n` +
        `Net stock effect: ${adjustment.totalAmount.toFixed(2)}\n\n` +
        "This removes every stock movement in this adjustment batch and recalculates stock balances."
    );
    if (!confirmed) return;

    setDeletingSourceId(adjustment.source_id);
    try {
      if (orgId) await ensureActiveOrganization(orgId);
      const { data: deletedCount, error } = await supabase.rpc("delete_stock_adjustment_batch", {
        p_source_id: adjustment.source_id,
      });
      if (error) throw error;
      if (Number(deletedCount || 0) === 0) {
        throw new Error("No movements were deleted. Check your permission or whether this adjustment still exists.");
      }
      const retiredJournal = await deleteJournalEntryByReference("stock_adjustment", adjustment.source_id, orgId);
      if (!retiredJournal.ok) {
        throw new Error(`Movements were deleted, but the stock adjustment journal could not be retired: ${retiredJournal.error}`);
      }
      if (editingSourceId === adjustment.source_id) {
        setEditingSourceId(null);
        setSelectedSourceId(null);
      }
      await Promise.all([loadStockSnapshot(), loadAdjustmentHistory()]);
    } catch (e) {
      console.error("[Stock adjustments] delete failed:", e);
      alert(e instanceof Error ? `Failed to delete adjustment: ${e.message}` : "Failed to delete adjustment.");
    } finally {
      setDeletingSourceId(null);
    }
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
    if (!inventoryGlAccountId) {
      alert("Select the inventory stock GL account before saving the adjustment.");
      return;
    }
    if (!stockGainLossGlAccountId) {
      alert("Select the P&L stock gain/loss GL account before saving the adjustment.");
      return;
    }
    if (inventoryGlAccountId === stockGainLossGlAccountId) {
      alert("Inventory and P&L accounts must be different.");
      return;
    }
    setSaving(true);
    try {
      if (orgId) await ensureActiveOrganization(orgId);
      const sourceId = editingSourceId || randomUuid();
      const movementDateIso = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00.000Z` : new Date().toISOString();
      const payload = validRows.map((r) => {
        const delta = Number(r.qtyDelta);
        const closingStock = r.currentQty + delta;
        const inventoryGl = glAccounts.find((g) => g.id === inventoryGlAccountId);
        const gainLossGl = glAccounts.find((g) => g.id === stockGainLossGlAccountId);
        const row: Record<string, unknown> = {
          product_id: r.product_id,
          movement_date: movementDateIso,
          source_type: "adjustment",
          source_id: sourceId,
          quantity_in: delta > 0 ? delta : 0,
          quantity_out: delta < 0 ? Math.abs(delta) : 0,
          unit_cost: null,
          note:
            `GL ${inventoryGl?.account_code ?? ""} - ${inventoryGl?.account_name ?? ""} | ` +
            `${reason.trim() || "Manual adjustment"} [CLOSING_STOCK:${closingStock}] ` +
            `[INV_GL:${inventoryGlAccountId}] [PL_GL:${stockGainLossGlAccountId}]` +
            (gainLossGl ? ` [PL:${gainLossGl.account_code} - ${gainLossGl.account_name}]` : ""),
        };
        if (orgId) row.organization_id = orgId;
        return row;
      });
      if (editingSourceId) {
        await filterStockMovementsByOrganizationId(
          supabase
            .from("product_stock_movements")
            .delete()
            .eq("source_type", "adjustment")
            .eq("source_id", editingSourceId),
          orgId
        );
      }
      const { data: inserted, error: insertErr } = await supabase
        .from("product_stock_movements")
        .insert(payload)
        .select("id");
      if (insertErr) throw insertErr;
      if ((inserted?.length ?? 0) !== payload.length) {
        throw new Error(`Only ${inserted?.length ?? 0} of ${payload.length} movement(s) were saved.`);
      }
      const journal = await createJournalForStockAdjustment(sourceId, user?.id ?? null, {
        organizationId: orgId,
        inventoryGlAccountId,
        stockGainLossGlAccountId,
        replaceExisting: true,
      });
      if (!journal.ok) {
        alert(`Stock adjusted, but the journal was not posted: ${journal.error}`);
      } else {
        alert("Stock adjusted and journal posted.");
      }
      // Refresh current stock and reset rows
      await loadStockSnapshot();
      await loadAdjustmentHistory();
      setRows([
        {
          id: randomUuid(),
          product_id: "",
          currentQty: 0,
          newQty: "",
          qtyDelta: "",
        },
      ]);
      setSelectedSourceId(null);
      setEditingSourceId(null);
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
          Adjustment deep-link received ({highlightAdjustmentSourceId}). Click the linked amount in history to open details.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Stock Adjustments</h2>
        <PageNotes ariaLabel="Stock adjustments help">
          <p>
            Enter adjustments manually or import many lines from CSV/Excel. Use either new quantity or amount adjusted per
            line.
          </p>
        </PageNotes>
      </div>

      <div className="flex gap-1 border-b border-slate-200 max-w-5xl">
        <button
          type="button"
          onClick={() => setTab("manual")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            tab === "manual"
              ? "border-brand-700 text-brand-800"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          Manual
        </button>
        <button
          type="button"
          onClick={() => setTab("import")}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
            tab === "import"
              ? "border-brand-700 text-brand-800"
              : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Upload className="w-4 h-4" />
          Import file
        </button>
      </div>

      {tab === "import" ? (
        <StockBulkImportPanel
          readOnly={readOnly}
          onApplied={() => {
            void loadStockSnapshot();
            void loadAdjustmentHistory();
          }}
        />
      ) : null}

      {tab === "manual" ? (
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 overflow-x-auto max-w-5xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-slate-900">
            {editingSourceId ? `Edit adjustment ${editingSourceId.slice(0, 8)}` : "New adjustment"}
          </h3>
          {editingSourceId ? (
            <button
              type="button"
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
              onClick={() => {
                setEditingSourceId(null);
                setSelectedSourceId(null);
                setRows([
                  {
                    id: randomUuid(),
                    product_id: "",
                    currentQty: 0,
                    newQty: "",
                    qtyDelta: "",
                  },
                ]);
              }}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-4 mb-2">
          <div>
            <label className="block text-sm font-medium mb-1">Effective date</label>
            <input
              type="date"
              className="border rounded-lg px-3 py-2"
              value={date}
              onChange={(e) => void handleDateChange(e.target.value)}
              disabled={loadingStockSnapshot}
            />
            <p className="mt-1 text-xs text-slate-500">
              {loadingStockSnapshot ? "Loading balance for selected date..." : "Current Qty is shown as at this date."}
            </p>
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
            <label className="block text-sm font-medium mb-1">Inventory stock account (required)</label>
            <select
              className="border rounded-lg px-3 py-2 w-full"
              value={inventoryGlAccountId}
              onChange={(e) => setInventoryGlAccountId(e.target.value)}
            >
              <option value="">None</option>
              {glAccounts.filter((g) => g.account_type === "asset").map((g) => (
                <option key={g.id} value={g.id}>
                  {g.account_code} – {g.account_name}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[240px]">
            <label className="block text-sm font-medium mb-1">P&L stock gain/loss account (required)</label>
            <select
              className="border rounded-lg px-3 py-2 w-full"
              value={stockGainLossGlAccountId}
              onChange={(e) => setStockGainLossGlAccountId(e.target.value)}
            >
              <option value="">None</option>
              {glAccounts.filter((g) => g.account_type === "expense" || g.account_type === "income").map((g) => (
                <option key={g.id} value={g.id}>
                  {g.account_code} â€“ {g.account_name}
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
            disabled={saving || loadingStockSnapshot}
            className="inline-flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save adjustments"}
          </button>
        </div>
      </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-6 overflow-x-auto max-w-5xl">
        <h3 className="text-base font-semibold text-slate-900 mb-3">Adjustments history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No saved adjustments yet.</p>
        ) : (
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-2 text-left">Staff</th>
                <th className="p-2 text-left">Done at</th>
                <th className="p-2 text-left">Effective date</th>
                <th className="p-2 text-left">Reference</th>
                <th className="p-2 text-left">Reason</th>
                <th className="p-2 text-right">Lines</th>
                <th className="p-2 text-right">Closing stock</th>
                <th className="p-2 text-right">Net adjustment</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.source_id}
                  className={`border-t border-slate-100 ${selectedSourceId === h.source_id ? "bg-amber-50" : ""}`}
                >
                  <td className="p-2">{h.created_by_name || "Unknown / legacy"}</td>
                  <td className="p-2 whitespace-nowrap">
                    {h.created_at ? new Date(h.created_at).toLocaleString() : "Not recorded (legacy)"}
                  </td>
                  <td className="p-2 whitespace-nowrap">{toBusinessDateString(h.movement_date)}</td>
                  <td className="p-2 font-mono text-xs">{h.source_id.slice(0, 8)}</td>
                  <td className="p-2">{adjustmentReasonFromNote(h.note)}</td>
                  <td className="p-2 text-right">{h.lines}</td>
                  <td className="p-2 text-right">
                    {h.closingStock === null ? (h.lines > 1 ? "View lines" : "Not recorded") : h.closingStock.toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      className="text-blue-700 hover:underline"
                      onClick={() => void openAdjustmentDetails(h.source_id)}
                    >
                      {h.totalAmount.toFixed(2)}
                    </button>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      type="button"
                      disabled={readOnly || !canDeleteAdjustments || deletingSourceId !== null}
                      onClick={() => void deleteAdjustmentBatch(h)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        readOnly
                          ? "Read-only access"
                          : !canDeleteAdjustments
                            ? "You do not have permission to delete stock adjustments"
                            : "Delete this entire adjustment batch"
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deletingSourceId === h.source_id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
