import type { UserRole } from "@/contexts/AuthContext";
import { canApprove } from "@/lib/approvalRights";

export type SaccoSavingsSettingsAccessOpts = {
  isSuperAdmin?: boolean;
  /** Desktop / offline install (`VITE_LOCAL_AUTH`). */
  localAuthEnabled?: boolean;
};

/** Uses Admin → Permissions → “Savings settings” (default: admin + manager). */
export function canEditSaccoSavingsSettings(
  role: UserRole | undefined | null,
  opts?: SaccoSavingsSettingsAccessOpts
): boolean {
  if (opts?.isSuperAdmin) return true;
  const roleKey = String(role || "").toLowerCase();
  if (opts?.localAuthEnabled && (roleKey === "admin" || roleKey === "manager")) return true;
  if (!role) return false;
  return canApprove("sacco_savings_settings", role);
}

export function isLocalAuthEnvEnabled(): boolean {
  return ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
}
