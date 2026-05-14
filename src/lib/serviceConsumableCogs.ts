import { supabase } from "@/lib/supabase";

export type CogsLineInput = {
  quantity: number;
  unitCost: number;
  departmentId: string | null;
};

type SaleLineLite = {
  productId: string | null;
  quantity: number;
  trackInventory: boolean;
};

/**
 * Extra COGS rows from `product_service_consumables` when services are sold (components × service qty).
 */
export async function fetchServiceConsumableCogsLines(
  organizationId: string,
  saleLines: SaleLineLite[]
): Promise<CogsLineInput[]> {
  const serviceIds = saleLines.filter((l) => !l.trackInventory && l.productId).map((l) => l.productId as string);
  if (serviceIds.length === 0) return [];

  const { data: links, error: linkErr } = await supabase
    .from("product_service_consumables")
    .select("service_product_id, component_product_id, quantity_per_unit")
    .eq("organization_id", organizationId)
    .in("service_product_id", serviceIds);
  if (linkErr || !links?.length) return [];

  const componentIds = [...new Set(links.map((r) => r.component_product_id as string))];
  const { data: prods, error: prodErr } = await supabase
    .from("products")
    .select("id, cost_price, department_id, track_inventory")
    .eq("organization_id", organizationId)
    .in("id", componentIds);
  if (prodErr || !prods?.length) return [];

  const prodMap = new Map(
    (prods as Array<{ id: string; cost_price: number | null; department_id: string | null; track_inventory: boolean | null }>).map(
      (p) => [p.id, p]
    )
  );

  const out: CogsLineInput[] = [];
  for (const sl of saleLines) {
    if (sl.trackInventory || !sl.productId) continue;
    const rows = links.filter((l) => l.service_product_id === sl.productId);
    for (const r of rows) {
      const p = prodMap.get(r.component_product_id as string);
      if (!p || p.track_inventory === false) continue;
      const q = Number(sl.quantity || 0) * Number(r.quantity_per_unit ?? 1);
      if (!(q > 0)) continue;
      out.push({
        quantity: q,
        unitCost: Number(p.cost_price ?? 0),
        departmentId: p.department_id ?? null,
      });
    }
  }
  return out;
}

export type StockMoveInsert = {
  product_id: string;
  source_type: string;
  source_id: string;
  quantity_in: number;
  quantity_out: number;
  unit_cost: number | null;
  note: string;
};

export async function fetchServiceConsumableStockMoves(
  organizationId: string,
  saleId: string,
  saleLines: SaleLineLite[]
): Promise<StockMoveInsert[]> {
  const serviceIds = saleLines.filter((l) => !l.trackInventory && l.productId).map((l) => l.productId as string);
  if (serviceIds.length === 0) return [];

  const { data: links } = await supabase
    .from("product_service_consumables")
    .select("service_product_id, component_product_id, quantity_per_unit")
    .eq("organization_id", organizationId)
    .in("service_product_id", serviceIds);
  if (!links?.length) return [];

  const componentIds = [...new Set(links.map((l) => l.component_product_id as string))];
  const { data: prods } = await supabase
    .from("products")
    .select("id, cost_price, track_inventory")
    .eq("organization_id", organizationId)
    .in("id", componentIds);
  if (!prods?.length) return [];

  const prodMap = new Map(
    (prods as Array<{ id: string; cost_price: number | null; track_inventory: boolean | null }>).map((p) => [p.id, p])
  );

  const moves: StockMoveInsert[] = [];
  for (const sl of saleLines) {
    if (sl.trackInventory || !sl.productId) continue;
    for (const r of links.filter((l) => l.service_product_id === sl.productId)) {
      const p = prodMap.get(r.component_product_id as string);
      if (!p || p.track_inventory === false) continue;
      const q = Number(sl.quantity || 0) * Number(r.quantity_per_unit ?? 1);
      if (!(q > 0)) continue;
      moves.push({
        product_id: r.component_product_id as string,
        source_type: "sale",
        source_id: saleId,
        quantity_in: 0,
        quantity_out: q,
        unit_cost: p.cost_price == null ? null : Number(p.cost_price),
        note: "POS service consumable",
      });
    }
  }
  return moves;
}
