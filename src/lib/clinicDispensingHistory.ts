import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";

export type ClinicDispensedLine = {
  saleId: string;
  saleAt: string;
  description: string;
  quantity: number;
  lineTotal: number;
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Loose match for comparing patient phone to retail customer phone. */
export function phonesLikelyMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (da.length >= 9 && db.length >= 9) return da.slice(-9) === db.slice(-9);
  if (!da || !db) return true;
  return da === db;
}

/**
 * Retail sale ids in period (by `sale_at`, same as POS Orders).
 * Used with `isClinicPosPayment` / sale-level clinic rules for analytics filters.
 */
export async function fetchClinicDispensingSaleIdsInRange(
  orgId: string | undefined,
  superAdmin: boolean,
  from: Date,
  to: Date
): Promise<Set<string>> {
  let q = supabase
    .from("retail_sales")
    .select("id")
    .gte("sale_at", from.toISOString())
    .lt("sale_at", to.toISOString());
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => String((r as { id: string }).id)));
}

export async function fetchClinicPatientDispensedLines(
  orgId: string | undefined,
  superAdmin: boolean,
  patientId: string
): Promise<ClinicDispensedLine[]> {
  let salesQ = supabase
    .from("retail_sales")
    .select("id,sale_at")
    .eq("clinic_patient_id", patientId)
    .eq("sale_status", "posted")
    .order("sale_at", { ascending: false })
    .limit(100);
  salesQ = filterByOrganizationId(salesQ, orgId, superAdmin);
  const { data: sales, error: sErr } = await salesQ;
  if (sErr) throw new Error(sErr.message);
  const saleRows = (sales || []) as Array<{ id: string; sale_at: string }>;
  if (saleRows.length === 0) return [];

  const saleIds = saleRows.map((s) => s.id);
  const saleAtById = new Map(saleRows.map((s) => [s.id, s.sale_at]));

  const lines: ClinicDispensedLine[] = [];
  const chunk = 40;
  for (let i = 0; i < saleIds.length; i += chunk) {
    const slice = saleIds.slice(i, i + chunk);
    const { data: lrows, error: lErr } = await supabase
      .from("retail_sale_lines")
      .select("sale_id,description,quantity,line_total")
      .in("sale_id", slice)
      .order("line_no", { ascending: true });
    if (lErr) throw new Error(lErr.message);
    for (const r of (lrows || []) as Array<{
      sale_id: string;
      description: string;
      quantity: number | string;
      line_total: number | string;
    }>) {
      lines.push({
        saleId: r.sale_id,
        saleAt: saleAtById.get(r.sale_id) || "",
        description: String(r.description || "").trim() || "Item",
        quantity: Number(r.quantity ?? 0),
        lineTotal: Number(r.line_total ?? 0),
      });
    }
  }
  lines.sort((a, b) => b.saleAt.localeCompare(a.saleAt));
  return lines;
}

/** Best-effort: credit balance on retail customer row matching patient name + phone. */
export async function fetchRetailCreditBalanceForPatient(
  orgId: string | undefined,
  superAdmin: boolean,
  patient: { name: string; phone: string }
): Promise<number | null> {
  let q = supabase.from("retail_customers").select("id,name,phone,current_credit_balance");
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data || []) as Array<{
    name: string;
    phone: string | null;
    current_credit_balance: number | null;
  }>;
  const nameLo = patient.name.trim().toLowerCase();
  const match = rows.find((r) => {
    if (r.name.trim().toLowerCase() !== nameLo) return false;
    return phonesLikelyMatch(patient.phone, r.phone || "");
  });
  if (!match) return null;
  return Number(match.current_credit_balance ?? 0);
}
