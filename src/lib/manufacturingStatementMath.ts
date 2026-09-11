export type ManufacturingStatement = {
  material: number; labour: number; overhead: number;
  openingWip: number; closingWip: number; cogm: number;
  openingFinished: number; closingFinished: number; costOfSales: number;
};
export function manufacturingStatementTotals(input: Omit<ManufacturingStatement, "cogm" | "costOfSales">): ManufacturingStatement {
  const cogm = input.openingWip + input.material + input.labour + input.overhead - input.closingWip;
  return { ...input, cogm, costOfSales: input.openingFinished + cogm - input.closingFinished };
}

