export type BomMaterial = { item_id: string; item_name: string; qty: number; unit: string };
export type ManufacturingBom = {
  id: string; product_id: string; product_name: string; version: string;
  output_qty: number; output_unit: string; status: "Draft" | "Active" | "Archived";
  materials: BomMaterial[]; expected_scrap_qty?: number; updated_at?: string;
};
export function preferredBom(boms: ManufacturingBom[]): ManufacturingBom | undefined {
  return [...boms].sort((a, b) => {
    const rank = { Active: 0, Draft: 1, Archived: 2 };
    return rank[a.status] - rank[b.status] || String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  })[0];
}
export function hasUsableBom(boms: ManufacturingBom[]): boolean {
  return boms.some((bom) => bom.status === "Active" || bom.status === "Draft");
}
export function validateBom(bom: Pick<ManufacturingBom, "output_qty" | "output_unit" | "materials" | "expected_scrap_qty" | "version">): string | null {
  if (!bom.version.trim()) return "Enter a BOM version.";
  if (!Number.isFinite(bom.output_qty) || bom.output_qty <= 0) return "Output quantity must be greater than zero.";
  if (!bom.output_unit.trim()) return "Enter an output unit.";
  if (!Number.isFinite(bom.expected_scrap_qty ?? 0) || (bom.expected_scrap_qty ?? 0) < 0) return "Expected scrap must be zero or greater.";
  if (!bom.materials.length) return "Add at least one material.";
  if (bom.materials.some((m) => !m.item_id || !m.unit.trim() || !Number.isFinite(m.qty) || m.qty <= 0)) return "Select each material and enter a positive quantity and unit.";
  if (new Set(bom.materials.map((m) => m.item_id)).size !== bom.materials.length) return "Combine duplicate material lines into one quantity.";
  return null;
}
export function suggestedScrap(bom: { output_qty: number; expected_scrap_qty?: number } | undefined, producedQty: number): string {
  if (!bom || !Number.isFinite(producedQty) || producedQty <= 0 || bom.output_qty <= 0) return "";
  return String(Math.round((bom.expected_scrap_qty || 0) * producedQty / bom.output_qty * 1000) / 1000);
}
