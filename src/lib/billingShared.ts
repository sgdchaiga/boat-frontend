import type { Database } from "./database.types";

export type BillingRow = Database["public"]["Tables"]["billing"]["Row"];
export type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];

export interface ActiveStayOption {
  id: string;
  room_id: string;
  property_customer_id?: string | null;
  rooms: { room_number: string } | null;
  hotel_customers: { first_name: string; last_name: string } | null;
  /** Set when API selects `actual_check_in` (active stay rows). */
  actual_check_in?: string;
}

export interface BillingWithCustomer extends BillingRow {
  stays?: {
    rooms: { room_number: string } | null;
    hotel_customers: { first_name: string; last_name: string } | null;
  } | null;
}

export interface PaymentWithCustomer extends PaymentRow {
  stays?: {
    rooms?: { room_number: string } | null;
    hotel_customers: { first_name: string; last_name: string } | null;
  } | null;
  property_customer?: { first_name: string; last_name: string } | null;
  retail_customer?: { name: string } | null;
  /** JSON from DB: [{ path, name }] */
  source_documents?: unknown;
}

export function guestDisplayName(g: { first_name: string; last_name: string } | null | undefined) {
  return g ? `${g.first_name} ${g.last_name}`.trim() : "";
}

/** Display name for Payments Received rows (customer-linked, stay-linked, or retail). */
export function paymentReceivedCustomerLabel(p: PaymentWithCustomer): string {
  if (p.property_customer) return guestDisplayName(p.property_customer);
  if (p.retail_customer?.name) return p.retail_customer.name.trim();
  return guestDisplayName(p.stays?.hotel_customers ?? null) || "—";
}

export function toLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type BillingRangePreset = "all" | "today" | "yesterday" | "this_month" | "last_month";

export function billingRangeToDates(range: BillingRangePreset): { from: string; to: string } {
  const now = new Date();
  switch (range) {
    case "all":
      return { from: "", to: "" };
    case "today":
      return { from: toLocalYMD(now), to: toLocalYMD(now) };
    case "yesterday": {
      const y = new Date(now.getTime() - 864e5);
      return { from: toLocalYMD(y), to: toLocalYMD(y) };
    }
    case "this_month":
      return {
        from: toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toLocalYMD(now),
      };
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toLocalYMD(first), to: toLocalYMD(last) };
    }
    default:
      return { from: "", to: "" };
  }
}
