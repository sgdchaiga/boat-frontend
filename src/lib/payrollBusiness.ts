export function payrollBusinessLabel(businessType?: string | null): string {
  if (!businessType) return "Business";
  return businessType.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

export function payrollStaffTypes(businessType?: string | null): string[] {
  if (businessType === "school") return ["Teaching", "Non-Teaching"];
  if (businessType === "manufacturing") return ["Production", "Maintenance", "Quality Control", "Warehouse & Logistics", "Administration", "Sales & Distribution"];
  return ["Operations", "Administration", "Sales", "Support"];
}

export function payrollStaffCostReport(businessType?: string | null): string {
  return businessType === "school" ? "Teaching vs Non-teaching Cost" : "Payroll Cost by Staff Type";
}

/** Explicit nulls clear optional employment fields; omitted fields retain saved values. */
export function mergePayrollProfile<T extends Record<string, unknown>>(existing: T, draft: Partial<T>): T {
  return { ...existing, ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)) };
}
