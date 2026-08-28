import type { BusinessType } from "@/contexts/AuthContext";

import {

  defaultLandingPageForRole,

  defaultLandingStateForRole,

  getRolePageAllowList,

} from "@/lib/roleNavigation";
import { pageAccessDecision } from "@/lib/permissions";
import { isPracticePageAllowed, practiceLandingPage } from "@/lib/practiceRoleAccess";



export type NavRoleExperience =

  | "full"

  | "waitress"

  | "bartender"

  | "hotel_operations_assistant"

  | "kitchen"

  | "cashier"

  | "accountant"

  | "manager"

  | "storekeeper"
  | "housekeeping";



/** Maps org role_key values to a nav experience (admin → full sidebar). */

export function normalizeNavRoleKey(roleKey: string | undefined | null): string {

  const r = (roleKey ?? "").trim().toLowerCase();

  if (r === "waiter" || r === "waitress") return "waitress";

  if (r === "barman" || r === "bartender" || r === "bar_staff") return "bartender";

  if (r === "hotel_operations_assistant" || r === "hotel_ops_assistant" || r === "operations_assistant") {

    return "hotel_operations_assistant";

  }

  if (r === "kitchen_staff" || r === "chef" || r === "cook" || r === "kitchen") return "kitchen";

  if (r === "supervisor") return "manager";

  return r;

}



export function getNavRoleExperience(roleKey: string | undefined | null): NavRoleExperience {

  const r = normalizeNavRoleKey(roleKey);

  if (!r || r === "admin" || r === "super_admin") return "full";

  if (r === "waitress") return "waitress";

  if (r === "bartender") return "bartender";

  if (r === "hotel_operations_assistant") return "hotel_operations_assistant";

  if (r === "kitchen") return "kitchen";

  if (r === "cashier") return "cashier";

  if (r === "accountant") return "accountant";

  if (r === "manager") return "manager";

  if (r === "storekeeper") return "storekeeper";

  if (r === "housekeeping" || r === "room_attendant") return "housekeeping";

  return "full";

}



export function shouldApplyNavRoleScope(businessType: BusinessType | null | undefined): boolean {

  if (!businessType) return false;

  return (

    businessType === "hotel" ||

    businessType === "mixed" ||

    businessType === "restaurant" ||

    businessType === "retail" ||

    businessType === "clinic" ||

    businessType === "manufacturing"

  );

}



export function shouldApplyStorekeeperScope(businessType: BusinessType | null | undefined): boolean {

  return shouldApplyNavRoleScope(businessType) || businessType === "manufacturing";

}



export function isPageAllowedForNavRole(

  page: string,

  _roleKey: string | undefined | null,

  _businessType: BusinessType | null | undefined

): boolean {

  if (_businessType === "accounting_practice") {
    return isPracticePageAllowed(page, _roleKey);
  }

  const xp = getNavRoleExperience(_roleKey);

  if (xp === "hotel_operations_assistant" && shouldApplyNavRoleScope(_businessType)) {

    const configuredDecision = pageAccessDecision(page);

    if (configuredDecision !== null) return configuredDecision;

    return getRolePageAllowList(xp)?.has(page) === true;

  }

  if (xp === "housekeeping" && shouldApplyNavRoleScope(_businessType)) {

    return page === "housekeeping";

  }

  const configuredDecision = pageAccessDecision(page);

  if (configuredDecision !== null) return configuredDecision;
  return true;

}



export function defaultLandingPageForNavRole(

  roleKey: string | undefined | null,

  businessType: BusinessType | null | undefined

): string | null {

  if (businessType === "accounting_practice") return practiceLandingPage(roleKey);

  const xp = getNavRoleExperience(roleKey);

  if (xp === "full") return null;

  if (xp === "storekeeper" && !shouldApplyStorekeeperScope(businessType)) return null;

  if (xp !== "storekeeper" && !shouldApplyNavRoleScope(businessType)) return null;

  return defaultLandingPageForRole(roleKey, businessType);

}



export function defaultLandingStateForNavRole(

  roleKey: string | undefined | null

): Record<string, unknown> | undefined {

  return defaultLandingStateForRole(roleKey);

}


