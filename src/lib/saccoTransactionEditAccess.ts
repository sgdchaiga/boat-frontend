import type { UserRole } from "@/contexts/AuthContext";
import { canApprove } from "@/lib/permissions";

export type SaccoTransactionEditAccessOpts = {
  isSuperAdmin?: boolean;
  localAuthEnabled?: boolean;
};

/** Admin → Permissions → “Edit SACCO transactions” (default: admin, manager, accountant). */
export function canEditSaccoTransactions(
  role: UserRole | undefined | null,
  opts?: SaccoTransactionEditAccessOpts
): boolean {
  if (opts?.isSuperAdmin) return true;
  const roleKey = String(role || "").toLowerCase();
  if (opts?.localAuthEnabled && (roleKey === "admin" || roleKey === "manager" || roleKey === "accountant")) {
    return true;
  }
  if (!role) return false;
  return canApprove("sacco_transaction_edit", role);
}
