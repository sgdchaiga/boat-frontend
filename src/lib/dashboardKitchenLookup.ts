import { supabase } from "./supabase";
import { filterByOrganizationId } from "./supabaseOrgFilter";

/**
 * Resolve which `transaction_id` values refer to `kitchen_orders` (for legacy rows without `payment_source`).
 */
export async function fetchKitchenOrderIdsForPayments(
  payments: Array<{ transaction_id?: string | null; payment_source?: string | null }>,
  orgId: string | undefined,
  superAdmin: boolean
): Promise<Set<string>> {
  const needLegacy = payments.some((p) => !p.payment_source && p.transaction_id);
  if (!needLegacy) return new Set();
  const uuids = [
    ...new Set(
      payments
        .map((p) => p.transaction_id)
        .filter((id): id is string => !!id && /^[0-9a-fA-F-]{36}$/.test(String(id)))
    ),
  ];
  if (uuids.length === 0) return new Set();
  const out = new Set<string>();
  const chunk = 150;
  for (let i = 0; i < uuids.length; i += chunk) {
    let q = supabase.from("kitchen_orders").select("id").in("id", uuids.slice(i, i + chunk));
    q = filterByOrganizationId(q, orgId, superAdmin);
    const { data } = await q;
    (data || []).forEach((r: { id: string }) => out.add(r.id));
  }
  return out;
}
