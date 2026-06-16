import { supabase } from "./supabase";
import { ensureActiveOrganization } from "./stockBulkImport";

export type StockLedgerMovement = {
  product_id: string;
  movement_date: string | null;
  quantity_in: number | null;
  quantity_out: number | null;
  unit_cost?: number | null;
  location?: string | null;
  source_type: string | null;
  source_id?: string | null;
  note: string | null;
};

const STOCK_MOVEMENT_SELECT =
  "product_id,movement_date,quantity_in,quantity_out,unit_cost,location,source_type,source_id,note";

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function fetchStockLedgerMovementsForProducts(
  organizationId: string | null | undefined,
  productIds: string[]
): Promise<StockLedgerMovement[]> {
  const ids = uniq(productIds);
  if (ids.length === 0) return [];
  if (organizationId) await ensureActiveOrganization(organizationId);

  const rows: StockLedgerMovement[] = [];
  const seen = new Set<string>();

  async function fetchScope(scope: "org" | "legacy-null") {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = supabase
        .from("product_stock_movements")
        .select(STOCK_MOVEMENT_SELECT)
        .in("product_id", ids)
        .order("movement_date", { ascending: true })
        .range(from, from + pageSize - 1);

      if (scope === "org" && organizationId) {
        query = query.eq("organization_id", organizationId);
      } else if (scope === "legacy-null" && organizationId) {
        query = query.is("organization_id", null);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || "Failed to load stock movements.");

      const page = (data || []) as StockLedgerMovement[];
      for (const row of page) {
        const key = [
          row.product_id,
          row.movement_date ?? "",
          row.quantity_in ?? "",
          row.quantity_out ?? "",
          row.source_type ?? "",
          row.source_id ?? "",
          row.note ?? "",
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
      if (page.length < pageSize) break;
    }
  }

  await fetchScope("org");
  if (organizationId) await fetchScope("legacy-null");

  return rows.sort((a, b) => new Date(a.movement_date || "").getTime() - new Date(b.movement_date || "").getTime());
}
