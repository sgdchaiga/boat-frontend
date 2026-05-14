/** How POS lists items: dishes (recipes → ingredients) vs retail SKUs (bar/sauna). Set per department in Admin → Products. */
export type PosCatalogMode = "dish_menu" | "product_catalog";

/**
 * Resolved catalog mode for POS / kitchen queues. Treats kitchen-facing department names as
 * `dish_menu` even when `pos_catalog_mode` was left at DB default `product_catalog` (new orgs),
 * matching {@link KitchenDisplayPage} name rules.
 */
export function effectivePosCatalogMode(d: { name: string; pos_catalog_mode?: string | null }): PosCatalogMode {
  const raw = d.pos_catalog_mode;
  const n = (d.name || "").toLowerCase();

  if (raw === "dish_menu") return "dish_menu";

  if (/\broom\b/.test(n) || n.includes("room service")) return "product_catalog";

  if (/\bbar\b/.test(n) || n.includes("sauna") || n.includes("spa")) return "product_catalog";

  const kitchenLike =
    n.includes("kitchen") || n.includes("restaurant") || n.includes("food") || n.includes("dining");
  if (kitchenLike) return "dish_menu";

  if (/\b(bar|sauna|spa|minibar|shop|lounge)\b/.test(n)) return "product_catalog";

  return "product_catalog";
}

/**
 * Hide bar / room-service / generic retail lines from the Kitchen Orders queue (shared `kitchen_orders` table).
 * Uses the same resolution as {@link effectivePosCatalogMode}. Unassigned products (no department) stay visible.
 */
export function excludeLineFromKitchenQueue(
  deptName: string | null | undefined,
  posCatalogMode?: string | null
): boolean {
  const name = deptName ?? "";
  const raw = posCatalogMode;
  if (!name.trim() && (raw == null || raw === undefined)) return false;
  return effectivePosCatalogMode({ name, pos_catalog_mode: raw }) === "product_catalog";
}

/** Default `pos_catalog_mode` when inserting a department (name-based; can be changed later via Edit). */
export function defaultPosCatalogModeForNewDepartmentName(name: string): PosCatalogMode {
  const trimmed = (name || "").trim();
  if (!trimmed) return "product_catalog";
  return effectivePosCatalogMode({ name: trimmed, pos_catalog_mode: "product_catalog" });
}
