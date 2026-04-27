export type DeploymentMode = "online" | "lan";
export type TenantIdSource = "vite_tenant_id" | "vite_local_organization_id" | "local_storage_override" | "missing";
const LOCAL_TENANT_OVERRIDE_KEY = "boat.local.tenant.id.override.v1";

/**
 * `online` — hosted Supabase (default).
 * `lan` — on-prem Supabase URL; successful writes can enqueue `sync_outbox` for cloud backup.
 */
export function getDeploymentMode(): DeploymentMode {
  const m = import.meta.env.VITE_DEPLOYMENT_MODE?.toLowerCase();
  return m === "lan" ? "lan" : "online";
}

/**
 * Stable id for multi-tenant cloud rows (per business / LAN server).
 * Often matches `organizations.id` or your cloud `tenant_settings.cloud_tenant_id`.
 */
export function getTenantIdFromEnv(): string | null {
  const explicitTenantId = import.meta.env.VITE_TENANT_ID?.trim();
  if (explicitTenantId) return explicitTenantId;

  // Backward-compatible fallback for desktop/LAN installs that already pin a stable local org id.
  const localOrganizationId = import.meta.env.VITE_LOCAL_ORGANIZATION_ID?.trim();
  if (localOrganizationId) return localOrganizationId;

  return getTenantIdOverrideFromStorage();
}

export function getTenantIdDetails(): { tenantId: string | null; source: TenantIdSource } {
  const explicitTenantId = import.meta.env.VITE_TENANT_ID?.trim();
  if (explicitTenantId) {
    return { tenantId: explicitTenantId, source: "vite_tenant_id" };
  }
  const localOrganizationId = import.meta.env.VITE_LOCAL_ORGANIZATION_ID?.trim();
  if (localOrganizationId) {
    return { tenantId: localOrganizationId, source: "vite_local_organization_id" };
  }
  const override = getTenantIdOverrideFromStorage();
  if (override) {
    return { tenantId: override, source: "local_storage_override" };
  }
  return { tenantId: null, source: "missing" };
}

function getTenantIdOverrideFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_TENANT_OVERRIDE_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function setTenantIdOverride(tenantId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const value = tenantId?.trim() || "";
    if (!value) {
      window.localStorage.removeItem(LOCAL_TENANT_OVERRIDE_KEY);
      return;
    }
    window.localStorage.setItem(LOCAL_TENANT_OVERRIDE_KEY, value);
  } catch {
    // Ignore storage errors.
  }
}

export function shouldEnqueueLanSync(): boolean {
  return getDeploymentMode() === "lan" && Boolean(getTenantIdFromEnv());
}
