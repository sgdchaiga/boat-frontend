import type { GlAccountOption } from "@/components/common/GlAccountPicker";
import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";

/** GL accounts used on expense lines first (order preserved), then remaining accounts by code. */
export function orderGlAccountsWithExpensePreferences(
  accounts: { id: string; account_code: string; account_name: string }[],
  preferredIds: string[]
): GlAccountOption[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: GlAccountOption[] = [];
  for (const id of preferredIds) {
    if (!id || seen.has(id)) continue;
    const a = byId.get(id);
    if (a) {
      seen.add(id);
      out.push({ id: a.id, account_code: a.account_code, account_name: a.account_name });
    }
  }
  const rest = [...accounts]
    .filter((a) => !seen.has(a.id))
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
  for (const a of rest) {
    out.push({ id: a.id, account_code: a.account_code, account_name: a.account_name });
  }
  return out;
}

/**
 * Distinct GL ids from this org’s expense lines, in encounter order (expense GL, then cash, VAT, bank charges per line).
 */
export async function fetchExpenseGlAccountPreferenceOrder(
  orgId: string | undefined,
  isSuperAdmin: boolean
): Promise<string[]> {
  if (!orgId) return [];
  let q = supabase.from("expenses").select("id").eq("organization_id", orgId);
  q = filterByOrganizationId(q, orgId, isSuperAdmin);
  const { data: exps, error } = await q;
  if (error || !exps?.length) return [];
  const expenseIds = (exps as { id: string }[]).map((e) => e.id);
  const order: string[] = [];
  const push = (x: string | null | undefined) => {
    if (x && !order.includes(x)) order.push(x);
  };
  const chunkSize = 300;
  for (let i = 0; i < expenseIds.length; i += chunkSize) {
    const chunk = expenseIds.slice(i, i + chunkSize);
    const { data: lines } = await supabase
      .from("expense_lines")
      .select("expense_gl_account_id, source_cash_gl_account_id, vat_gl_account_id, bank_charges_gl_account_id")
      .in("expense_id", chunk);
    for (const row of lines || []) {
      const r = row as {
        expense_gl_account_id: string;
        source_cash_gl_account_id: string;
        vat_gl_account_id: string | null;
        bank_charges_gl_account_id: string | null;
      };
      push(r.expense_gl_account_id);
      push(r.source_cash_gl_account_id);
      push(r.vat_gl_account_id);
      push(r.bank_charges_gl_account_id);
    }
  }
  return order;
}
