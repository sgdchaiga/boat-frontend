export const SCHOOL_PAYMENT_METHODS = [
  { code: "cash", label: "Cash" },
  { code: "mobile_money", label: "Mobile money" },
  { code: "bank", label: "Bank" },
  { code: "transfer", label: "Transfer" },
  { code: "school_pay", label: "SchoolPay" },
  { code: "wallet", label: "Wallet" },
  { code: "other", label: "Other" },
] as const;

export type SchoolPaymentMethod = (typeof SCHOOL_PAYMENT_METHODS)[number]["code"];
export const DEFAULT_SCHOOL_PAYMENT_METHODS: SchoolPaymentMethod[] = SCHOOL_PAYMENT_METHODS.map((m) => m.code);

export function normalizeSchoolPaymentMethods(value: unknown): SchoolPaymentMethod[] {
  if (!Array.isArray(value)) return [...DEFAULT_SCHOOL_PAYMENT_METHODS];
  const allowed = new Set<string>(SCHOOL_PAYMENT_METHODS.map((m) => m.code));
  const result = value.map(String).filter((v): v is SchoolPaymentMethod => allowed.has(v));
  return result.length ? result : ["cash"];
}
