/** Standard drug shelf categories for clinic / pharmacy tenants (products.drug_category). */
export const CLINIC_DRUG_CATEGORIES = [
  "antibiotics",
  "painkillers",
  "syrups",
  "injections",
  "consumables",
] as const;

export type ClinicDrugCategory = (typeof CLINIC_DRUG_CATEGORIES)[number];
