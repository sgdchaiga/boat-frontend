/**
 * Statement of cash flows — direct and indirect operating sections.
 * Cash pool = cash-equivalent asset accounts (category cash / typical names).
 */

export type GlAccountRow = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  category: string | null;
};

export type JournalLineRow = {
  gl_account_id: string;
  debit: number;
  credit: number;
};

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function accountBalanceDelta(accountType: string, debit: number, credit: number): number {
  const dr = Number(debit) || 0;
  const cr = Number(credit) || 0;
  if (accountType === "asset" || accountType === "expense") return dr - cr;
  return cr - dr;
}

/** Cash and cash equivalents (bank, mobile money) — asset accounts only. */
export function isCashEquivalentAccount(a: GlAccountRow): boolean {
  if (a.account_type !== "asset") return false;
  const c = (a.category || "").toLowerCase();
  if (c === "cash") return true;
  const n = (a.account_name || "").toLowerCase();
  if (/\b(cash on hand|petty cash)\b/.test(n)) return true;
  if (/\b(bank|mobile money|momo|mpesa|airtel)\b/.test(n)) return true;
  return false;
}

export function isReceivableAccount(a: GlAccountRow): boolean {
  if (a.account_type !== "asset") return false;
  if (isCashEquivalentAccount(a)) return false;
  const c = (a.category || "").toLowerCase();
  if (c.includes("receivable")) return true;
  return (a.account_name || "").toLowerCase().includes("receivable");
}

export function isInventoryAccount(a: GlAccountRow): boolean {
  if (a.account_type !== "asset") return false;
  if (isCashEquivalentAccount(a)) return false;
  const c = (a.category || "").toLowerCase();
  if (c.includes("inventory")) return true;
  const n = (a.account_name || "").toLowerCase();
  return n.includes("inventory") || n.includes("stock");
}

export function isPayableAccount(a: GlAccountRow): boolean {
  if (a.account_type !== "liability") return false;
  const c = (a.category || "").toLowerCase();
  if (c.includes("payable")) return true;
  return (a.account_name || "").toLowerCase().includes("payable");
}

export function isEquityAccount(a: GlAccountRow): boolean {
  return a.account_type === "equity";
}

/** Non-current / investing-style assets (rough heuristic). */
export function isFixedAssetAccount(a: GlAccountRow): boolean {
  if (a.account_type !== "asset") return false;
  if (isCashEquivalentAccount(a) || isReceivableAccount(a) || isInventoryAccount(a)) return false;
  const c = (a.category || "").toLowerCase();
  if (c.includes("fixed") || c.includes("ppe")) return true;
  const n = (a.account_name || "").toLowerCase();
  if (/\b(furniture|equipment|vehicle|building|land|accumulated depreciation|computer)\b/.test(n)) return true;
  return false;
}

export function isDepreciationExpenseAccount(a: GlAccountRow): boolean {
  if (a.account_type !== "expense") return false;
  const n = (a.account_name || "").toLowerCase();
  return n.includes("depreciation") || n.includes("amortization");
}

/** Cumulative balance by account from journal lines (same rules as balance sheet). */
export function cumulativeBalances(
  accounts: GlAccountRow[],
  lines: JournalLineRow[]
): Record<string, number> {
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const byAccount: Record<string, number> = {};
  for (const l of lines) {
    const acc = accMap[l.gl_account_id];
    if (!acc) continue;
    if (!byAccount[l.gl_account_id]) byAccount[l.gl_account_id] = 0;
    byAccount[l.gl_account_id] += accountBalanceDelta(acc.account_type, l.debit, l.credit);
  }
  return byAccount;
}

export function sumAccountGroup(
  balances: Record<string, number>,
  accounts: GlAccountRow[],
  predicate: (a: GlAccountRow) => boolean
): number {
  let s = 0;
  for (const a of accounts) {
    if (!predicate(a)) continue;
    s += balances[a.id] ?? 0;
  }
  return roundMoney(s);
}

export function netIncomeFromLines(
  accounts: GlAccountRow[],
  lines: JournalLineRow[]
): { totalRevenue: number; totalExpense: number; netIncome: number } {
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  let tr = 0,
    te = 0;
  for (const l of lines) {
    const acc = accMap[l.gl_account_id];
    if (!acc) continue;
    const dr = Number(l.debit) || 0;
    const cr = Number(l.credit) || 0;
    if (acc.account_type === "income") tr += cr - dr;
    else if (acc.account_type === "expense") te += dr - cr;
  }
  tr = roundMoney(tr);
  te = roundMoney(te);
  return { totalRevenue: tr, totalExpense: te, netIncome: roundMoney(tr - te) };
}

export function depreciationAddBackForPeriod(
  accounts: GlAccountRow[],
  lines: JournalLineRow[]
): number {
  const accMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  let d = 0;
  for (const l of lines) {
    const acc = accMap[l.gl_account_id];
    if (!acc || !isDepreciationExpenseAccount(acc)) continue;
    d += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  }
  return roundMoney(Math.max(0, d));
}

export type EntryClassification = "operating" | "investing" | "financing";

export function classifyEntryCashFlow(
  lines: JournalLineRow[],
  accMap: Record<string, GlAccountRow>,
  cashPoolIds: Set<string>
): EntryClassification {
  const nonCash = lines.filter((l) => !cashPoolIds.has(l.gl_account_id));
  let hasEquity = false;
  let hasFixed = false;
  let hasLongTermLiab = false;
  for (const l of nonCash) {
    const a = accMap[l.gl_account_id];
    if (!a) continue;
    if (isEquityAccount(a)) hasEquity = true;
    if (isFixedAssetAccount(a)) hasFixed = true;
    if (a.account_type === "liability" && !isPayableAccount(a)) hasLongTermLiab = true;
  }
  if (hasEquity || hasLongTermLiab) return "financing";
  if (hasFixed) return "investing";
  return "operating";
}

/** Net cash movement on cash pool for one entry (Dr − Cr on cash accounts). */
export function cashNetOnPool(lines: JournalLineRow[], cashPoolIds: Set<string>): number {
  let n = 0;
  for (const l of lines) {
    if (!cashPoolIds.has(l.gl_account_id)) continue;
    n += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  }
  return roundMoney(n);
}

export type DirectOperatingSplit = {
  /** Customer receipts, collections (cash in). */
  receiptsFromCustomers: number;
  /** Supplier, expense, inventory, AP payments (cash out, stored positive). */
  paymentsOperating: number;
};

/**
 * Split operating cash into receipts vs payments (direct method detail).
 * Uses non-cash lines: income/receivable → receipt; expense/payable/inventory → payment.
 */
export function splitDirectOperating(
  cashNet: number,
  lines: JournalLineRow[],
  accMap: Record<string, GlAccountRow>,
  cashPoolIds: Set<string>
): DirectOperatingSplit {
  if (cashNet === 0) return { receiptsFromCustomers: 0, paymentsOperating: 0 };
  const nonCash = lines.filter((l) => !cashPoolIds.has(l.gl_account_id));
  let receiptHint = false;
  let paymentHint = false;
  for (const l of nonCash) {
    const a = accMap[l.gl_account_id];
    if (!a) continue;
    if (a.account_type === "income" || isReceivableAccount(a)) receiptHint = true;
    if (a.account_type === "expense" || isPayableAccount(a) || isInventoryAccount(a)) paymentHint = true;
  }
  if (cashNet > 0) {
    if (paymentHint && !receiptHint) {
      return { receiptsFromCustomers: 0, paymentsOperating: -cashNet };
    }
    return { receiptsFromCustomers: cashNet, paymentsOperating: 0 };
  }
  return { receiptsFromCustomers: 0, paymentsOperating: -cashNet };
}

export type IndirectOperatingResult = {
  netIncome: number;
  depreciationAddBack: number;
  deltaReceivables: number;
  deltaInventory: number;
  deltaPayables: number;
  netCashOperatingIndirect: number;
};

export function buildIndirectOperating(
  netIncome: number,
  depreciationAddBack: number,
  arBegin: number,
  arEnd: number,
  invBegin: number,
  invEnd: number,
  apBegin: number,
  apEnd: number
): IndirectOperatingResult {
  const deltaReceivables = roundMoney(arEnd - arBegin);
  const deltaInventory = roundMoney(invEnd - invBegin);
  const deltaPayables = roundMoney(apEnd - apBegin);
  const netCashOperatingIndirect = roundMoney(
    netIncome + depreciationAddBack - deltaReceivables - deltaInventory + deltaPayables
  );
  return {
    netIncome,
    depreciationAddBack,
    deltaReceivables,
    deltaInventory,
    deltaPayables,
    netCashOperatingIndirect,
  };
}
