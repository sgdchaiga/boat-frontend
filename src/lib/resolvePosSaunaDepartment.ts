import { supabase } from "./supabase";
import { filterByOrganizationId } from "./supabaseOrgFilter";
import type { Database } from "./database.types";

export type DepartmentRow = Database["public"]["Tables"]["departments"]["Row"];

/**
 * Same rules as Sauna orders: explicit `pos_sauna_department_id` in hotel config, else first department
 * whose name contains "sauna" or "spa".
 */
export function pickPosSaunaDepartmentFromList(
  departments: DepartmentRow[],
  configuredDepartmentId: string | null | undefined
): DepartmentRow | null {
  if (!departments.length) return null;
  const configured = configuredDepartmentId?.trim() || null;
  return (
    (configured ? departments.find((d) => d.id === configured) : null) ||
    departments.find((d) => {
      const n = d.name.toLowerCase();
      return n.includes("sauna") || n.includes("spa");
    }) ||
    null
  );
}

export async function resolvePosSaunaDepartment(
  orgId: string | undefined,
  superAdmin: boolean,
  configuredDepartmentId: string | null | undefined
): Promise<DepartmentRow | null> {
  if (!orgId) return null;
  let q = supabase.from("departments").select("id,name");
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error || !data?.length) return null;
  return pickPosSaunaDepartmentFromList(data as DepartmentRow[], configuredDepartmentId);
}
