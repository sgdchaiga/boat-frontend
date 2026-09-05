function isDateReference(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  // Historical manual references use DDMMYYYY, MMDDYYYY, or YYYYMMDD.
  const candidates = [
    [Number(value.slice(4)), Number(value.slice(2, 4)), Number(value.slice(0, 2))],
    [Number(value.slice(4)), Number(value.slice(0, 2)), Number(value.slice(2, 4))],
    [Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6))],
  ];
  return candidates.some(([year, month, day]) => {
    if (year < 1900 || year > 2199) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  });
}

/** Start a new order independently of entry dates and historical date references. */
export function nextProductionOrderSerial(previous: unknown[]): string {
  const highest = previous.reduce<number>((max, serial) => {
    const match = /^(\d+)(?:_\d+)?$/.exec(String(serial ?? "").trim());
    return match && !isDateReference(match[1]) ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${highest + 1}_1`;
}

export function nextProductionLineSerial(previous: string): string {
  const value = previous.trim();
  const match = /^(.*)_(\d+)$/.exec(value);
  return match ? `${match[1]}_${Number(match[2]) + 1}` : `${value}_2`;
}
