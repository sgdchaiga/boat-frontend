export const factoryOverheadLabels = ["Factory electricity", "Factory rent", "Production supervisor salaries", "Factory repairs & maintenance", "Depreciation – factory machinery", "Factory insurance", "Indirect materials", "Other factory overheads"];
export type ManufacturingDetail = {
  openingRaw: number; purchases: number; freight: number; otherRaw: number; closingRaw: number;
  otherDirect: number; overheads: number[]; includedExpenseIds: string[];
};
export type ManufacturingStatement = {
  material: number; labour: number; overhead: number;
  openingWip: number; closingWip: number; cogm: number;
  openingFinished: number; closingFinished: number; costOfSales: number;
  detail?: ManufacturingDetail;
};
export function manufacturingStatementTotals(input: Omit<ManufacturingStatement, "cogm" | "costOfSales">): ManufacturingStatement {
  const cogm = input.openingWip + input.material + input.labour + (input.detail?.otherDirect || 0) + input.overhead - input.closingWip;
  return { ...input, cogm, costOfSales: input.openingFinished + cogm - input.closingFinished };
}
export function manufacturingAccountLines(s: ManufacturingStatement): Array<{ label: string; value: number | null; strong?: boolean }> {
  const d = s.detail;
  if (!d) return [];
  const available = d.openingRaw + d.purchases + d.freight + d.otherRaw;
  const prime = s.material + s.labour + d.otherDirect;
  return [
    { label: "Raw materials", value: null, strong: true },
    { label: "Opening raw materials inventory", value: d.openingRaw },
    { label: "Add: Purchases of raw materials", value: d.purchases },
    { label: "Add: Carriage/freight inward", value: d.freight },
    ...(Math.abs(d.otherRaw) > 0.005 ? [{ label: "Other raw material movements", value: d.otherRaw }] : []),
    { label: "Raw materials available", value: available, strong: true },
    { label: "Less: Closing raw materials inventory", value: -d.closingRaw },
    { label: "Raw materials consumed", value: s.material, strong: true },
    { label: "Direct labour", value: s.labour, strong: true },
    { label: "Other direct production costs", value: d.otherDirect },
    { label: "Prime cost", value: prime, strong: true },
    { label: "Factory overheads:", value: null, strong: true },
    ...factoryOverheadLabels.map((label, index) => ({ label, value: d.overheads[index] })),
    { label: "Total factory overheads", value: s.overhead, strong: true },
    { label: "Total manufacturing cost", value: prime + s.overhead, strong: true },
    { label: "Add: Opening work in progress", value: s.openingWip },
    { label: "Less: Closing work in progress", value: -s.closingWip },
    { label: "Cost of goods manufactured (COGM)", value: s.cogm, strong: true },
  ];
}
/** Classify only specifically named production expenses, not general business costs. */
export function productionExpenseBucket(name: string): "freight" | "labour" | "direct" | number | null {
  const n = name.toLowerCase();
  if (/freight in|freight inward|carriage.*inward/.test(n)) return "freight";
  if (/direct labo[u]?r|production wages/.test(n)) return "labour";
  if (/other direct.*(production|cost)|direct production cost/.test(n)) return "direct";
  if (/indirect material|production consumable/.test(n)) return 6;
  if (/production supervisor/.test(n)) return 2;
  if (!/factory|manufacturing overhead|production overhead/.test(n)) return null;
  if (/electric/.test(n)) return 0;
  if (/rent/.test(n)) return 1;
  if (/repair|maintenance/.test(n)) return 3;
  if (/depreciation/.test(n)) return 4;
  if (/insurance/.test(n)) return 5;
  return 7;
}
