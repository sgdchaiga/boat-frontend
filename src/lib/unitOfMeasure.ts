const UNIT_LABELS: Record<string, string> = {
  ea: "Each",
  each: "Each",
  unit: "Unit",
  units: "Units",
  pc: "Piece",
  pcs: "Pieces",
  piece: "Piece",
  pieces: "Pieces",
  kg: "kg",
  g: "g",
  mg: "mg",
  l: "L",
  litre: "Litre",
  litres: "Litres",
  liter: "Litre",
  liters: "Litres",
  ml: "mL",
  box: "Box",
  boxes: "Boxes",
  bottle: "Bottle",
  bottles: "Bottles",
  pack: "Pack",
  packs: "Packs",
  carton: "Carton",
  cartons: "Cartons",
  dozen: "Dozen",
  pair: "Pair",
  pairs: "Pairs",
  metre: "Metre",
  meter: "Metre",
  m: "m",
};

/** Converts stored UOM codes into consistent user-facing report labels. */
export function formatUnitOfMeasure(value: string | null | undefined, fallback = "Each"): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return UNIT_LABELS[raw.toLowerCase()] || raw;
}
