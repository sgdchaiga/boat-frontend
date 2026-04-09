export type DeploymentMode = "online" | "lan";

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
  const id = import.meta.env.VITE_TENANT_ID?.trim();
  return id || null;
}

export function shouldEnqueueLanSync(): boolean {
  return getDeploymentMode() === "lan" && Boolean(getTenantIdFromEnv());
}
