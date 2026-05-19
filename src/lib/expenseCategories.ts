import type { NormalizedGlAccount } from "@/lib/glAccountNormalize";

/** Human-facing groups — matches Spend money simple mode. */
export const SIMPLE_EXPENSE_CATEGORIES = ["Staff", "Marketing", "Transport", "Utilities", "Office", "Other"] as const;
export type SimpleExpenseCategory = (typeof SIMPLE_EXPENSE_CATEGORIES)[number];

export const SIMPLE_EXPENSE_CATEGORY_LABELS: Record<SimpleExpenseCategory, string> = {
  Staff: "Staff & salaries",
  Marketing: "Marketing",
  Transport: "Transport & fuel",
  Utilities: "Rent & utilities",
  Office: "Office & admin",
  Other: "Other",
};

const SIMPLE_TYPE_GL_CODES: Record<SimpleExpenseCategory, string[]> = {
  Staff: ["6120", "6130", "6110", "6140", "6150", "6160", "6170", "6100"],
  Marketing: ["6210", "6220"],
  Transport: ["6413", "6411"],
  Utilities: ["6419", "6331", "6332", "6414", "6415"],
  Office: ["6400", "6412", "6410", "6340", "6420"],
  Other: ["6300"],
};

const SIMPLE_TYPE_NAME_FALLBACK: Record<SimpleExpenseCategory, string[]> = {
  Staff: ["staff salar", "nssf", "personnel", "payroll", "welfare", "medical", "bonus", "training"],
  Marketing: ["advert", "marketing", "publicity", "commission"],
  Transport: ["fuel", "transport", "vehicle", "freight"],
  Utilities: ["rent", "electric", "water", "telephone", "internet", "airtime"],
  Office: ["administrative", "office", "stationery", "legal", "insurance", "security"],
  Other: ["general", "misc", "sundry"],
};

function normalizeExpenseAccountCode(account: Pick<NormalizedGlAccount, "account_code">): string {
  const raw = String(account.account_code ?? "")
    .trim()
    .replace(/\s+/g, "");
  const head = raw.split(/[.\-/]/)[0] ?? raw;
  return head.replace(/^0+(?=\d)/, "") || head;
}

function buildGlCodeToSimpleCategoryMap(): Map<string, SimpleExpenseCategory> {
  const m = new Map<string, SimpleExpenseCategory>();
  for (const cat of SIMPLE_EXPENSE_CATEGORIES) {
    for (const code of SIMPLE_TYPE_GL_CODES[cat]) {
      const n = String(code).trim().replace(/^0+(?=\d)/, "");
      if (!m.has(n)) m.set(n, cat);
    }
  }
  return m;
}

const GL_CODE_TO_CATEGORY = buildGlCodeToSimpleCategoryMap();

/** Map an expense GL account to a simple category label for reports. */
export function resolveExpenseCategoryLabel(account: NormalizedGlAccount | null | undefined): string {
  if (!account) return "Uncategorized";
  const code = normalizeExpenseAccountCode(account);
  const fromCode = GL_CODE_TO_CATEGORY.get(code);
  if (fromCode) return SIMPLE_EXPENSE_CATEGORY_LABELS[fromCode];

  const blob = `${account.account_name} ${account.account_code}`.toLowerCase();
  for (const cat of SIMPLE_EXPENSE_CATEGORIES) {
    for (const sub of SIMPLE_TYPE_NAME_FALLBACK[cat]) {
      if (blob.includes(sub)) return SIMPLE_EXPENSE_CATEGORY_LABELS[cat];
    }
  }

  const name = (account.account_name || account.account_code || "").trim();
  return name || "Uncategorized";
}
