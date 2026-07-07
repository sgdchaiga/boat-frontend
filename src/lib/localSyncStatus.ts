import { desktopApi } from "@/lib/desktopApi";
import { getDeploymentMode, getTenantIdFromEnv } from "@/lib/deployment";

export type LocalSyncStatus = {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
};

const LOCAL_SYNC_STATUS_KEY = "boat.local.sync.status.v1";
const LOCAL_SYNC_STATUS_EVENT = "boat-local-sync-status-changed";

const DEFAULT_LOCAL_SYNC_STATUS: LocalSyncStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
};

function emitLocalSyncStatusChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_SYNC_STATUS_EVENT));
}

export function writeLocalSyncStatus(next: LocalSyncStatus) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_SYNC_STATUS_KEY, JSON.stringify(next));
    emitLocalSyncStatusChanged();
  } catch {
    // Ignore storage errors for non-critical sync status metadata.
  }
}

export function readLocalSyncStatus(): LocalSyncStatus {
  if (typeof window === "undefined") return DEFAULT_LOCAL_SYNC_STATUS;
  try {
    const raw = window.localStorage.getItem(LOCAL_SYNC_STATUS_KEY);
    if (!raw) return DEFAULT_LOCAL_SYNC_STATUS;
    const parsed = JSON.parse(raw) as Partial<LocalSyncStatus>;
    return {
      lastAttemptAt: typeof parsed.lastAttemptAt === "number" ? parsed.lastAttemptAt : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === "number" ? parsed.lastSuccessAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    };
  } catch {
    return DEFAULT_LOCAL_SYNC_STATUS;
  }
}

export function localSyncStatusEventName(): string {
  return LOCAL_SYNC_STATUS_EVENT;
}

export function canRunLocalSyncWorker(): boolean {
  return getDeploymentMode() === "lan" && desktopApi.isAvailable() && Boolean(getTenantIdFromEnv());
}
