import { supabase } from "./supabase";

/**
 * Post stock-in movements from a purchase order's line items when a GRN/bill is finalized.
 * Used from bill approval and from PO→GRN convert when bill approval is skipped.
 */
export async function postStockInFromPurchaseOrderForBill(
  billId: string,
  purchaseOrderId: string
): Promise<{ unmatchedDescriptions: string[] }> {
  let poItems: Array<{
    product_id?: string | null;
    description?: string | null;
    quantity?: number | null;
    cost_price?: number | null;
  }> = [];

  const withProduct = await supabase
    .from("purchase_order_items")
    .select("product_id, description, quantity, cost_price")
    .eq("purchase_order_id", purchaseOrderId);

  if (withProduct.error) {
    const msg = String(withProduct.error.message || "").toLowerCase();
    if (!msg.includes("product_id")) throw withProduct.error;
    const fallback = await supabase
      .from("purchase_order_items")
      .select("description, quantity, cost_price")
      .eq("purchase_order_id", purchaseOrderId);
    if (fallback.error) throw fallback.error;
    poItems = (fallback.data || []) as typeof poItems;
  } else {
    poItems = (withProduct.data || []) as typeof poItems;
  }

  const missingDescriptions = Array.from(
    new Set(
      poItems
        .filter((it) => !it.product_id && it.description)
        .map((it) => String(it.description).trim())
        .filter(Boolean)
    )
  );
  const productByName = new Map<string, string>();
  if (missingDescriptions.length > 0) {
    const { data: productsByName } = await supabase.from("products").select("id, name").in("name", missingDescriptions);
    (productsByName || []).forEach((p: { id?: string; name?: string }) => {
      if (p.id && p.name) productByName.set(String(p.name).trim().toLowerCase(), String(p.id));
    });
  }

  const movementDate = new Date().toISOString();
  const unmatchedDescriptions = new Set<string>();
  const stockInMoves = (poItems || [])
    .map((it) => {
      const normalizedDesc = String(it.description || "").trim();
      const productId =
        (it.product_id as string | null) || productByName.get(normalizedDesc.toLowerCase()) || null;
      const qty = Number(it.quantity) || 0;
      const unitCost = Number(it.cost_price) || 0;
      if (!productId) {
        if (normalizedDesc) unmatchedDescriptions.add(normalizedDesc);
        return null;
      }
      if (qty <= 0) return null;
      return {
        product_id: productId,
        movement_date: movementDate,
        source_type: "bill",
        source_id: billId,
        quantity_in: qty,
        quantity_out: 0,
        unit_cost: unitCost > 0 ? unitCost : null,
        location: "default",
        note: `GRN/Bill approved: ${billId}`,
      };
    })
    .filter(Boolean) as Array<{
    product_id: string;
    movement_date: string;
    source_type: string;
    source_id: string;
    quantity_in: number;
    quantity_out: number;
    unit_cost: number | null;
    location: string;
    note: string;
  }>;

  if (stockInMoves.length > 0) {
    const { error: stockErr } = await supabase.from("product_stock_movements").insert(stockInMoves);
    if (stockErr) throw stockErr;
  }

  return { unmatchedDescriptions: Array.from(unmatchedDescriptions).sort((a, b) => a.localeCompare(b)) };
}
