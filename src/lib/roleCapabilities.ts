import { normalizeNavRoleKey, type NavRoleExperience } from "@/lib/navRoleExperience";

export type RoleCapabilities = {
  canEditPrices: boolean;
  canCancelInvoices: boolean;
  canAccessFinance: boolean;
  hidePricing: boolean;
  canApplyDiscounts: boolean;
};

const FULL: RoleCapabilities = {
  canEditPrices: true,
  canCancelInvoices: true,
  canAccessFinance: true,
  hidePricing: false,
  canApplyDiscounts: true,
};

/** Operational roles — capability matrix aligned to recommended visibility. */
export function getRoleCapabilities(roleKey: string | undefined | null): RoleCapabilities {
  const r = normalizeNavRoleKey(roleKey);
  switch (r) {
    case "waitress":
      return {
        canEditPrices: false,
        canCancelInvoices: false,
        canAccessFinance: false,
        hidePricing: false,
        canApplyDiscounts: false,
      };
    case "bartender":
      return {
        canEditPrices: false,
        canCancelInvoices: false,
        canAccessFinance: false,
        hidePricing: false,
        canApplyDiscounts: false,
      };
    case "kitchen":
      return {
        canEditPrices: false,
        canCancelInvoices: false,
        canAccessFinance: false,
        hidePricing: true,
        canApplyDiscounts: false,
      };
    case "cashier":
      return {
        canEditPrices: false,
        canCancelInvoices: false,
        canAccessFinance: false,
        hidePricing: false,
        canApplyDiscounts: true,
      };
    case "accountant":
      return {
        canEditPrices: false,
        canCancelInvoices: true,
        canAccessFinance: true,
        hidePricing: false,
        canApplyDiscounts: false,
      };
    case "manager":
      return {
        canEditPrices: true,
        canCancelInvoices: true,
        canAccessFinance: true,
        hidePricing: false,
        canApplyDiscounts: true,
      };
    case "storekeeper":
      return {
        canEditPrices: false,
        canCancelInvoices: false,
        canAccessFinance: false,
        hidePricing: false,
        canApplyDiscounts: false,
      };
    default:
      return FULL;
  }
}

export function navExperienceUsesCapabilities(xp: NavRoleExperience): boolean {
  return xp !== "full";
}
