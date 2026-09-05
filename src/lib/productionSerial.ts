/** Start a new order independently of entry dates and line suffixes. */
export function nextProductionOrderSerial(previous: unknown[]): string {
  const highest = previous.reduce<number>((max, serial) => {
    const match = /^(\d+)(?:_\d+)?$/.exec(String(serial ?? "").trim());
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${highest + 1}_1`;
}

export function nextProductionLineSerial(previous: string): string {
  const value = previous.trim();
  const match = /^(.*)_(\d+)$/.exec(value);
  return match ? `${match[1]}_${Number(match[2]) + 1}` : `${value}_2`;
}
