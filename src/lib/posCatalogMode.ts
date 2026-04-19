/** How POS lists items: dishes (recipes → ingredients) vs retail SKUs (bar/sauna). Set per department in Admin → Products. */
export type PosCatalogMode = "dish_menu" | "product_catalog";

export function effectivePosCatalogMode(d: { name: string; pos_catalog_mode?: string | null }): PosCatalogMode {
  const raw = d.pos_catalog_mode;
  if (raw === "dish_menu" || raw === "product_catalog") return raw;
  const n = (d.name || "").toLowerCase();
  if (/\b(bar|sauna|spa|minibar|shop|lounge)\b/.test(n)) return "product_catalog";
  if (/(kitchen|restaurant|food|dining)/.test(n) && !/bar/.test(n)) return "dish_menu";
  return "product_catalog";
}
