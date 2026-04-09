import type { UserRole } from "@/contexts/AuthContext";
import { canApprove } from "@/lib/approvalRights";

/** Uses Admin → Approval rights → “Savings & member settings” (default: admin + manager). */
export function canEditSaccoSavingsSettings(role: UserRole | undefined | null): boolean {
  if (!role) return false;
  return canApprove("sacco_savings_settings", role);
}
