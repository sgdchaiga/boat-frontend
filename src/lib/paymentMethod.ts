import type { SupabaseClient } from "@supabase/supabase-js";

/** Values stored in `payments.payment_method` and used by POS. */
export type PaymentMethodCode =
  | "cash"
  | "card"
  | "bank_transfer"
  | "mtn_mobile_money"
  | "airtel_money";

export const PAYMENT_METHOD_SELECT_OPTIONS: { value: PaymentMethodCode; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "mtn_mobile_money", label: "MTN Mobile Money" },
  { value: "airtel_money", label: "Airtel Money" },
];

const METHOD_VALUES = new Set<string>(PAYMENT_METHOD_SELECT_OPTIONS.map((o) => o.value));

/** Normalize DB/API values (maps legacy `mobile_money` → MTN). */
export function normalizePaymentMethod(raw: string | null | undefined): PaymentMethodCode {
  const m = String(raw || "cash").trim();
  if (m === "mobile_money") return "mtn_mobile_money";
  if (METHOD_VALUES.has(m)) return m as PaymentMethodCode;
  return "cash";
}

export function formatPaymentMethodLabel(method: string | null | undefined): string {
  const m = String(method || "").trim();
  if (m === "mobile_money") return "MTN Mobile Money";
  const found = PAYMENT_METHOD_SELECT_OPTIONS.find((o) => o.value === m);
  if (found) return found.label;
  if (!m) return "—";
  return m.charAt(0).toUpperCase() + m.slice(1).replace(/_/g, " ");
}

/**
 * Postgres CHECK on `payments.payment_method` differs by migration:
 * - older: `mobile_money` only
 * - newer: `mtn_mobile_money` + `airtel_money` (no `mobile_money`)
 * Try preferred first, then legacy `mobile_money` for MTN/Airtel so both DBs work.
 */
export function paymentMethodVariantsForInsert(preferred: PaymentMethodCode): string[] {
  if (preferred === "mtn_mobile_money" || preferred === "airtel_money") {
    return [preferred, "mobile_money"];
  }
  return [preferred];
}

export function isPaymentMethodCheckViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const msg = String(e?.message ?? "");
  if (e?.code === "23514") return true;
  return /payment_method_check|check constraint|violates check/i.test(msg);
}

/** Insert `payments` row; retries with `mobile_money` when DB only has the legacy CHECK. */
export async function insertPaymentWithMethodCompat(
  client: SupabaseClient,
  insertPayload: Record<string, unknown>,
  preferred: PaymentMethodCode
): Promise<{ data: { id: string; paid_at?: string } | null; error: unknown }> {
  const variants = paymentMethodVariantsForInsert(preferred);
  let lastErr: unknown = null;
  for (let i = 0; i < variants.length; i++) {
    const pm = variants[i];
    const { data, error } = await client
      .from("payments")
      .insert({ ...insertPayload, payment_method: pm })
      .select("id, paid_at")
      .single();
    if (!error) {
      return { data: data as { id: string; paid_at?: string }, error: null };
    }
    lastErr = error;
    if (!isPaymentMethodCheckViolation(error)) {
      return { data: null, error };
    }
    if (i === variants.length - 1) {
      return { data: null, error };
    }
  }
  return { data: null, error: lastErr };
}
