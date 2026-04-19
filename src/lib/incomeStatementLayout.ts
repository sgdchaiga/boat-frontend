import type { BusinessType } from "../contexts/AuthContext";

export type IncomeStatementMode = "school" | "retail" | "manufacturing" | "sacco";

export type AccountTotal = {
  account_id: string;
  account_code: string;
  account_name: string;
  total: number;
  category?: string | null;
  account_type?: "income" | "expense";
};

const norm = (s: string | null | undefined) => (s || "").toLowerCase();

/** Hotel, retail, restaurant, mixed: revenue + COGS + operating expenses. */
function isRetailFamily(bt: BusinessType | null | undefined): boolean {
  return bt === "hotel" || bt === "retail" || bt === "restaurant" || bt === "mixed";
}

export function getIncomeStatementMode(businessType: BusinessType | null | undefined): IncomeStatementMode {
  if (businessType === "school") return "school";
  if (businessType === "sacco") return "sacco";
  if (businessType === "manufacturing") return "manufacturing";
  if (isRetailFamily(businessType)) return "retail";
  // vsla, other, undefined → retail-style P&L (three sections)
  return "retail";
}

function haystack(a: AccountTotal): string {
  return norm(`${a.category} ${a.account_name} ${a.account_code}`);
}

/** Retail / hotel: direct costs vs operating expenses. */
export function classifyRetailExpenseRow(a: AccountTotal): "cogs" | "opex" {
  const h = haystack(a);
  if (
    /\bcogs\b/.test(h) ||
    h.includes("cost of goods") ||
    h.includes("cost of sales") ||
    h.includes("direct cost") ||
    h.includes("direct material") ||
    (h.includes("inventory") && (h.includes("cost") || h.includes("cogs"))) ||
    h.includes("grn") && h.includes("cost")
  ) {
    return "cogs";
  }
  return "opex";
}

/** Manufacturing: COGS bucket includes production / factory costs (retail COGS rules + mfg keywords). */
export function classifyManufacturingExpenseRow(a: AccountTotal): "cogs" | "opex" {
  const h = haystack(a);
  if (classifyRetailExpenseRow(a) === "cogs") return "cogs";
  if (
    h.includes("manufacturing") ||
    h.includes("production") ||
    h.includes("factory") ||
    /\bwip\b/.test(h) ||
    h.includes("bill of material") ||
    h.includes("bom ") ||
    h.includes("variance") && h.includes("production") ||
    (h.includes("overhead") && (h.includes("factory") || h.includes("production")))
  ) {
    return "cogs";
  }
  return "opex";
}

export type SaccoBucket =
  | "interest_income"
  | "interest_expense"
  | "loan_loss_provision"
  | "fee_commission_income"
  | "fee_commission_expense"
  | "other_income"
  | "personnel"
  | "administration"
  | "finance"
  | "income_tax"
  | "fallback_income"
  | "fallback_expense";

function classifySaccoIncome(a: AccountTotal): Exclude<SaccoBucket, "interest_expense" | "loan_loss_provision" | "fee_commission_expense" | "personnel" | "administration" | "finance" | "income_tax" | "fallback_expense"> {
  const h = haystack(a);
  if (h.includes("interest") && (h.includes("income") || h.includes("receivable"))) return "interest_income";
  if (h.includes("fee") && (h.includes("commission") || h.includes("comission"))) return "fee_commission_income";
  return "other_income";
}

function classifySaccoExpense(a: AccountTotal): SaccoBucket {
  const h = haystack(a);
  if (h.includes("interest") && h.includes("expense")) return "interest_expense";
  if (h.includes("loan") && (h.includes("loss") || h.includes("provision"))) return "loan_loss_provision";
  if (h.includes("impairment") && h.includes("loan")) return "loan_loss_provision";
  if ((h.includes("fee") || h.includes("commission")) && h.includes("expense")) return "fee_commission_expense";
  if (h.includes("income tax") || h.includes("tax expense") || /\bit\b.*\btax\b/.test(h)) return "income_tax";
  if (h.includes("personnel") || h.includes("salary") || h.includes("wage") || h.includes("staff cost")) return "personnel";
  if (h.includes("admin") || h.includes("general")) return "administration";
  if (
    h.includes("finance cost") ||
    h.includes("finance charge") ||
    (h.includes("finance") && !h.includes("administration")) ||
    h.includes("bank charge")
  ) {
    return "finance";
  }
  return "fallback_expense";
}

export type SaccoStatementNumbers = {
  interestIncome: number;
  interestExpense: number;
  loanLossProvision: number;
  netInterestIncome: number;
  feeCommissionIncome: number;
  feeCommissionExpense: number;
  otherIncome: number;
  totalIncome: number;
  personnel: number;
  administration: number;
  finance: number;
  totalExpenditure: number;
  profitBeforeTax: number;
  incomeTax: number;
  profitForYear: number;
  /** Accounts rolled into each bucket (for optional drill / detail) */
  buckets: Record<SaccoBucket, AccountTotal[]>;
};

export function buildSaccoStatement(
  incomeRows: AccountTotal[],
  expenseRows: AccountTotal[]
): SaccoStatementNumbers {
  const buckets: Record<SaccoBucket, AccountTotal[]> = {
    interest_income: [],
    interest_expense: [],
    loan_loss_provision: [],
    fee_commission_income: [],
    fee_commission_expense: [],
    other_income: [],
    personnel: [],
    administration: [],
    finance: [],
    income_tax: [],
    fallback_income: [],
    fallback_expense: [],
  };

  const push = (bucket: SaccoBucket, row: AccountTotal) => {
    buckets[bucket].push(row);
  };

  for (const row of incomeRows) {
    push(classifySaccoIncome(row), row);
  }
  for (const row of expenseRows) {
    push(classifySaccoExpense(row), row);
  }

  const sum = (rows: AccountTotal[]) => rows.reduce((s, r) => s + (Number(r.total) || 0), 0);

  const interestIncome = sum(buckets.interest_income);
  const interestExpense = sum(buckets.interest_expense);
  const loanLossProvision = sum(buckets.loan_loss_provision);
  const netInterestIncome = interestIncome - interestExpense - loanLossProvision;
  const feeCommissionIncome = sum(buckets.fee_commission_income);
  const feeCommissionExpense = sum(buckets.fee_commission_expense);
  const otherIncome = sum(buckets.other_income);
  const totalIncome = netInterestIncome + feeCommissionIncome - feeCommissionExpense + otherIncome;

  const personnel = sum(buckets.personnel);
  const administration = sum(buckets.administration) + sum(buckets.fallback_expense);
  const finance = sum(buckets.finance);
  const incomeTax = sum(buckets.income_tax);
  const totalExpenditure = personnel + administration + finance;
  const profitBeforeTax = totalIncome - totalExpenditure;
  const profitForYear = profitBeforeTax - incomeTax;

  return {
    interestIncome,
    interestExpense,
    loanLossProvision,
    netInterestIncome,
    feeCommissionIncome,
    feeCommissionExpense,
    otherIncome,
    totalIncome,
    personnel,
    administration,
    finance,
    totalExpenditure,
    profitBeforeTax,
    incomeTax,
    profitForYear,
    buckets,
  };
}
