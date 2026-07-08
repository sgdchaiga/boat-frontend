import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Upload } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { randomUuid } from "../../lib/randomUuid";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId, filterStockMovementsByOrganizationId } from "../../lib/supabaseOrgFilter";
import { ensureActiveOrganization, loadStockBulkImportContext } from "../../lib/stockBulkImport";
import { PageNotes } from "../common/PageNotes";
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

type InventoryMovementType =
  | "purchase"
  | "sale_auto"
  | "consumption"
  | "physical_count"
  | "damage"
  | "theft"
  | "expiry"
  | "internal_use"
  | "transfer"
  | "manufacturing_issue"
  | "manufacturing_receipt";

type MovementDirection = "in" | "out" | "count" | "transfer" | "automatic";

type InventoryMovementOption = {
  id: InventoryMovementType;
  label: string;
  purpose: string;
  debit: string;
  credit: string;
  plClassification: string;
  direction: MovementDirection;
  noteLabel: string;
};

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

const INVENTORY_MOVEMENT_OPTIONS: InventoryMovementOption[] = [
  {
    id: "purchase",
    label: "Purchase",
    purpose: "Buy inventory",
    debit: "Inventory",
    credit: "Cash / Creditors",
    plClassification: "None",
    direction: "in",
    noteLabel: "Purchase",
  },
  {
    id: "sale_auto",
    label: "Sale (automatic)",
    purpose: "Sell inventory",
    debit: "COGS",
    credit: "Inventory",
    plClassification: "COGS",
    direction: "automatic",
    noteLabel: "Sale (automatic)",
  },
  {
    id: "consumption",
    label: "Consumption",
    purpose: "Inventory used in operations",
    debit: "Department COGS / Expense",
    credit: "Inventory",
    plClassification: "Usually COGS",
    direction: "out",
    noteLabel: "Consumption",
  },
  {
    id: "physical_count",
    label: "Physical Count",
    purpose: "Count stock and post gain/loss",
    debit: "Inventory or adjustment expense",
    credit: "Inventory gain or inventory",
    plClassification: "Other income / Operating expense",
    direction: "count",
    noteLabel: "Physical Count",
  },
  {
    id: "damage",
    label: "Damage",
    purpose: "Damaged stock",
    debit: "Damaged Stock Expense",
    credit: "Inventory",
    plClassification: "Operating Expense",
    direction: "out",
    noteLabel: "Damage",
  },
  {
    id: "theft",
    label: "Theft",
    purpose: "Missing stock",
    debit: "Inventory Shrinkage",
    credit: "Inventory",
    plClassification: "Operating Expense",
    direction: "out",
    noteLabel: "Theft",
  },
  {
    id: "expiry",
    label: "Expiry",
    purpose: "Expired goods",
    debit: "Expired Stock Expense",
    credit: "Inventory",
    plClassification: "Operating Expense",
    direction: "out",
    noteLabel: "Expiry",
  },
  {
    id: "internal_use",
    label: "Internal Use",
    purpose: "Office/staff use",
    debit: "Department Expense",
    credit: "Inventory",
    plClassification: "Operating Expense",
    direction: "out",
    noteLabel: "Internal Use",
  },
  {
    id: "transfer",
    label: "Transfer",
    purpose: "Move between stores",
    debit: "Inventory",
    credit: "Inventory",
    plClassification: "No P&L",
    direction: "transfer",
    noteLabel: "Transfer",
  },
  {
    id: "manufacturing_issue",
    label: "Manufacturing Issue",
    purpose: "Issue raw materials to production",
    debit: "Work in Progress",
    credit: "Raw Materials Inventory",
    plClassification: "None until costing",
    direction: "out",
    noteLabel: "Production Issue",
  },
  {
    id: "manufacturing_receipt",
    label: "Manufacturing Receipt",
    purpose: "Receive finished goods from production",
    debit: "Finished Goods Inventory",
    credit: "Work in Progress",
    plClassification: "None",
    direction: "in",
    noteLabel: "Production Receipt",
  },
];

const INVENTORY_MOVEMENT_BY_ID = new Map(INVENTORY_MOVEMENT_OPTIONS.map((option) => [option.id, option]));

function signedDeltaForMovement(direction: MovementDirection, amount: number): number {
  if (!Number.isFinite(amount)) return Number.NaN;
  if (direction === "in") return Math.abs(amount);
  if (direction === "out") return -Math.abs(amount);
  if (direction === "transfer" || direction === "automatic") return 0;
  return amount;
}

function normalizeInventoryMovementType(value: string | null | undefined): InventoryMovementType {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "sale" || raw === "sale_auto") return "sale_auto";
  if (raw === "physical_count" || raw === "physical count" || raw.includes("physical count") || raw.includes("stock count")) return "physical_count";
  if (raw === "expired" || raw === "expiry" || raw.includes("expir")) return "expiry";
  if (raw === "internal_use" || raw === "internal use" || raw.includes("internal")) return "internal_use";
  if (raw === "manufacturing_issue" || raw.includes("production issue") || raw.includes("manufacturing issue")) return "manufacturing_issue";
  if (raw === "manufacturing_receipt" || raw.includes("production receipt") || raw.includes("manufacturing receipt")) return "manufacturing_receipt";
  if (raw.includes("consumption") || raw === "consume") return "consumption";
  if (raw.includes("damage")) return "damage";
  if (raw.includes("theft") || raw.includes("shrinkage")) return "theft";
  if (raw.includes("transfer")) return "transfer";
  if (raw.includes("purchase")) return "purchase";
  return "physical_count";
}

function movementTypeFromNote(note: string | null): InventoryMovementType {
  const explicit = /\[MOVEMENT_TYPE:([a-z_]+)\]/i.exec(String(note || ""))?.[1];
  return normalizeInventoryMovementType(explicit || adjustmentReasonFromNote(note));
}

function closingStockFromNote(note: string | null): number | null {
  const raw = /\[CLOSING_STOCK:([+-]?\d+(?:\.\d+)?)\]/.exec(String(note || ""))?.[1];
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function adjustmentReasonFromNote(note: string | null): string {
  return String(note || "Manual movement")
    .replace(/^GL .*?\| /, "")
    .replace(/\s*\[[^\]]+\]\s*/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .replace(/\s+\|\s*$/, "")
    .trim();
}

function movementLabelFromNote(note: string | null): string {
  const movement = INVENTORY_MOVEMENT_BY_ID.get(movementTypeFromNote(note));
  return movement?.label ?? "Physical Count";
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
  const [movementType, setMovementType] = useState<InventoryMovementType>("physical_count");
  const [reason, setReason] = useState("");
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
  const selectedMovement = INVENTORY_MOVEMENT_BY_ID.get(movementType) || INVENTORY_MOVEMENT_OPTIONS[0];

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
          const amount = row.qtyDelta === "" ? Number.NaN : Number(row.qtyDelta);
          const newQtyNumber = row.newQty === "" ? Number.NaN : Number(row.newQty);
          const signedDelta =
            selectedMovement.direction === "count"
              ? Number.isFinite(newQtyNumber)
                ? newQtyNumber - currentQty
                : Number.NaN
              : signedDeltaForMovement(selectedMovement.direction, amount);
          return {
            ...row,
            currentQty,
            qtyDelta: selectedMovement.direction === "count" && Number.isFinite(signedDelta) ? String(signedDelta) : row.qtyDelta,
            newQty: Number.isFinite(signedDelta) ? String(currentQty + signedDelta) : "",
          };
        })
      );
    } catch (e) {
      console.error("[Inventory movements] dated stock snapshot failed:", e);
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
        const [{ data: productsData }, stockContext] = await Promise.all([
          filterByOrganizationId(
            supabase.from("products").select("id, name, track_inventory").order("name"),
            orgId,
            superAdmin
          ),
          loadStockBulkImportContext(orgId, superAdmin, date),
        ]);
        setProducts((productsData || []) as Product[]);
        const stock: Record<string, number> = {};
        Object.assign(stock, stockContext.currentStock);
        setCurrentStock(stock);
        await loadAdjustmentHistory();
      } catch (e) {
        console.error("[Inventory movements] load failed:", e);
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
    if (selectedMovement.direction !== "count") return;
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
        const signedDelta = signedDeltaForMovement(selectedMovement.direction, deltaNum);
        const newQtyVal = !isNaN(deltaNum) ? (r.currentQty + signedDelta).toString() : "";
        return { ...r, qtyDelta: value, newQty: newQtyVal };
      })
    );
  };

  const handleMovementTypeChange = (nextType: InventoryMovementType) => {
    const next = INVENTORY_MOVEMENT_BY_ID.get(nextType) || INVENTORY_MOVEMENT_OPTIONS[0];
    setMovementType(nextType);
    setReason("");
    setRows((prev) =>
      prev.map((row) => {
        const amount = row.qtyDelta === "" ? Number.NaN : Number(row.qtyDelta);
        if (!Number.isFinite(amount)) return { ...row, newQty: "" };
        const signed = signedDeltaForMovement(next.direction, amount);
        return { ...row, newQty: String(row.currentQty + signed) };
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
    const nextMovementType = movementTypeFromNote(rowsData[0].note);
    setMovementType(nextMovementType);
    setReason(adjustmentReasonFromNote(rowsData[0].note));
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
      `Delete inventory movement ${adjustment.source_id.slice(0, 8)}?\n\n` +
        `Effective date: ${effectiveDate}\n` +
        `Movement type: ${movementLabelFromNote(adjustment.note)}\n` +
        `Memo: ${adjustmentReasonFromNote(adjustment.note)}\n` +
        `Lines: ${adjustment.lines}\n` +
        `Net stock effect: ${adjustment.totalAmount.toFixed(2)}\n\n` +
        "This removes every stock movement in this batch and recalculates stock balances."
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
        throw new Error(`Movements were deleted, but the inventory movement journal could not be retired: ${retiredJournal.error}`);
      }
      if (editingSourceId === adjustment.source_id) {
        setEditingSourceId(null);
        setSelectedSourceId(null);
      }
      await Promise.all([loadStockSnapshot(), loadAdjustmentHistory()]);
    } catch (e) {
      console.error("[Inventory movements] delete failed:", e);
      alert(e instanceof Error ? `Failed to delete movement: ${e.message}` : "Failed to delete movement.");
    } finally {
      setDeletingSourceId(null);
    }
  };

  const handleSave = async () => {
    if (selectedMovement.direction === "automatic") {
      alert("Sale movements are automatic. Use POS / sales workflows so stock, revenue, COGS, and payments stay in sync.");
      return;
    }
    const validRows = rows.filter((r) => {
      const qty = Number(r.qtyDelta);
      if (!r.product_id || !Number.isFinite(qty)) return false;
      if (selectedMovement.direction === "count") return qty !== 0;
      return Math.abs(qty) > 0;
    });
    if (validRows.length === 0) {
      alert("Enter at least one valid movement row (product and non-zero quantity).");
      return;
    }
    setSaving(true);
    try {
      if (orgId) await ensureActiveOrganization(orgId);
      const sourceId = editingSourceId || randomUuid();
      const movementDateIso = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00.000Z` : new Date().toISOString();
      const payload = validRows.map((r) => {
        const rawQty = Number(r.qtyDelta);
        const delta =
          signedDeltaForMovement(selectedMovement.direction, rawQty);
        const transferQty = selectedMovement.direction === "transfer" ? Math.abs(rawQty) : 0;
        const closingStock = r.currentQty + delta;
        const physicalCountLabel =
          selectedMovement.direction === "count"
            ? delta > 0
              ? "Physical Count Surplus"
              : "Physical Count Shortage"
            : selectedMovement.noteLabel;
        const noteParts = [
          physicalCountLabel,
          reason.trim(),
          `[MOVEMENT_TYPE:${movementType}]`,
          `[CLOSING_STOCK:${closingStock}]`,
        ].filter(Boolean);
        const row: Record<string, unknown> = {
          product_id: r.product_id,
          movement_date: movementDateIso,
          source_type: "adjustment",
          source_id: sourceId,
          quantity_in: selectedMovement.direction === "transfer" ? transferQty : delta > 0 ? delta : 0,
          quantity_out: selectedMovement.direction === "transfer" ? transferQty : delta < 0 ? Math.abs(delta) : 0,
          unit_cost: null,
          note: noteParts.join(" | "),
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
      if (selectedMovement.direction === "transfer") {
        await deleteJournalEntryByReference("stock_adjustment", sourceId, orgId);
        alert("Inventory transfer saved. No P&L journal was posted because the global stock value is unchanged.");
      } else {
        const journal = await createJournalForStockAdjustment(sourceId, user?.id ?? null, {
          organizationId: orgId,
          replaceExisting: true,
        });
        if (!journal.ok) {
          alert(`Inventory movement saved, but the journal was not posted: ${journal.error}`);
        } else {
          alert("Inventory movement saved and journal posted.");
        }
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
      alert("Failed to save inventory movement.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-8 text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      {highlightAdjustmentSourceId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Inventory movement deep-link received ({highlightAdjustmentSourceId}). Click the linked amount in history to open details.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Inventory Movements</h2>
        <PageNotes ariaLabel="Inventory movements help">
          <p>
            Record inventory purchases, consumption, losses, counts, transfers, and manufacturing movements. Sales stay
            automatic from POS and sales workflows.
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
            {editingSourceId ? `Edit movement ${editingSourceId.slice(0, 8)}` : "New inventory movement"}
          </h3>
          {editingSourceId ? (
            <button
              type="button"
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
              onClick={() => {
                setEditingSourceId(null);
                setSelectedSourceId(null);
                setMovementType("physical_count");
                setReason("");
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
          <div className="min-w-[240px] flex-1">
            <label className="block text-sm font-medium mb-1">Movement type</label>
            <select
              className="border rounded-lg px-3 py-2 w-full"
              value={movementType}
              onChange={(e) => handleMovementTypeChange(e.target.value as InventoryMovementType)}
            >
              {INVENTORY_MOVEMENT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">{selectedMovement.purpose}</p>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Memo / details</label>
            <input
              className="border rounded-lg px-3 py-2 w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={selectedMovement.direction === "count" ? "Optional count notes" : "Optional reference or explanation"}
            />
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase text-slate-500">Debit</p>
            <p className="font-medium text-slate-900">{selectedMovement.debit}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-slate-500">Credit</p>
            <p className="font-medium text-slate-900">{selectedMovement.credit}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-slate-500">P&L</p>
            <p className="font-medium text-slate-900">{selectedMovement.plClassification}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-slate-500">Posting</p>
            <p className="font-medium text-slate-900">
              {selectedMovement.direction === "automatic" ? "Automatic" : selectedMovement.direction === "count" ? "Count gain/loss" : "Manual"}
            </p>
          </div>
        </div>

        <details className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-slate-700">Recommended GL mappings</summary>
          <table className="mt-3 w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Transaction</th>
                <th className="px-3 py-2 text-left">Purpose</th>
                <th className="px-3 py-2 text-left">Debit</th>
                <th className="px-3 py-2 text-left">Credit</th>
                <th className="px-3 py-2 text-left">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {INVENTORY_MOVEMENT_OPTIONS.map((option) => (
                <tr key={option.id}>
                  <td className="px-3 py-2 font-medium">{option.label}</td>
                  <td className="px-3 py-2">{option.purpose}</td>
                  <td className="px-3 py-2">{option.debit}</td>
                  <td className="px-3 py-2">{option.credit}</td>
                  <td className="px-3 py-2">{option.plClassification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        {selectedMovement.direction === "automatic" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Sale movements are posted automatically from POS and sales workflows.
          </div>
        ) : null}

        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-2 text-left">Item</th>
              <th className="p-2 text-right">Current Qty</th>
              <th className="p-2 text-right">{selectedMovement.direction === "count" ? "New Qty" : "Resulting Qty"}</th>
              <th className="p-2 text-right">{selectedMovement.direction === "count" ? "Amount Adjusted" : "Quantity moved"}</th>
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
                    placeholder={selectedMovement.direction === "count" ? "New quantity" : "Auto"}
                    disabled={selectedMovement.direction !== "count"}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="number"
                    className="border rounded-lg px-2 py-1 w-full text-right"
                    value={r.qtyDelta}
                    onChange={(e) => handleDeltaChange(r.id, e.target.value)}
                    placeholder={selectedMovement.direction === "count" ? "Amount adjusted" : "Quantity"}
                    disabled={selectedMovement.direction === "automatic"}
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
            disabled={saving || loadingStockSnapshot || selectedMovement.direction === "automatic"}
            className="inline-flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving…" : "Save movement"}
          </button>
        </div>
      </div>
      ) : null}

      <div className="bg-white border border-slate-200 rounded-xl p-6 overflow-x-auto max-w-5xl">
        <h3 className="text-base font-semibold text-slate-900 mb-3">Inventory movement history</h3>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No saved movements yet.</p>
        ) : (
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-2 text-left">Staff</th>
                <th className="p-2 text-left">Done at</th>
                <th className="p-2 text-left">Effective date</th>
                <th className="p-2 text-left">Reference</th>
                <th className="p-2 text-left">Movement type</th>
                <th className="p-2 text-left">Memo</th>
                <th className="p-2 text-right">Lines</th>
                <th className="p-2 text-right">Closing stock</th>
                <th className="p-2 text-right">Net movement</th>
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
                  <td className="p-2">{movementLabelFromNote(h.note)}</td>
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
                            ? "You do not have permission to delete inventory movements"
                            : "Delete this entire movement batch"
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
