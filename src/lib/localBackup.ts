import { desktopApi } from "@/lib/desktopApi";

export type LocalBackupStatus = {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastBackupPath: string | null;
};

const LOCAL_BACKUP_STATUS_KEY = "boat.local.backup.status.v1";
const LOCAL_BACKUP_STATUS_EVENT = "boat-local-backup-status-changed";
const DEFAULT_LOCAL_BACKUP_STATUS: LocalBackupStatus = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastBackupPath: null,
};

function emitLocalBackupStatusChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_BACKUP_STATUS_EVENT));
}

function writeLocalBackupStatus(next: LocalBackupStatus) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_BACKUP_STATUS_KEY, JSON.stringify(next));
    emitLocalBackupStatusChanged();
  } catch {
    // Ignore storage errors for backup status metadata.
  }
}

export function readLocalBackupStatus(): LocalBackupStatus {
  if (typeof window === "undefined") return DEFAULT_LOCAL_BACKUP_STATUS;
  try {
    const raw = window.localStorage.getItem(LOCAL_BACKUP_STATUS_KEY);
    if (!raw) return DEFAULT_LOCAL_BACKUP_STATUS;
    const parsed = JSON.parse(raw) as Partial<LocalBackupStatus>;
    return {
      lastAttemptAt: typeof parsed.lastAttemptAt === "number" ? parsed.lastAttemptAt : null,
      lastSuccessAt: typeof parsed.lastSuccessAt === "number" ? parsed.lastSuccessAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      lastBackupPath: typeof parsed.lastBackupPath === "string" ? parsed.lastBackupPath : null,
    };
  } catch {
    return DEFAULT_LOCAL_BACKUP_STATUS;
  }
}

export function localBackupStatusEventName(): string {
  return LOCAL_BACKUP_STATUS_EVENT;
}

export function canRunLocalBackup(): boolean {
  return desktopApi.isAvailable();
}

export async function runLocalBackupNow() {
  const startedAt = Date.now();
  const previous = readLocalBackupStatus();
  writeLocalBackupStatus({
    ...previous,
    lastAttemptAt: startedAt,
    lastError: null,
  });

  try {
    const result = await desktopApi.createLocalBackup();
    if (!result.ok) {
      throw new Error("Local backup is available in desktop mode only.");
    }
    writeLocalBackupStatus({
      lastAttemptAt: startedAt,
      lastSuccessAt: Date.now(),
      lastError: null,
      lastBackupPath: result.backupPath,
    });
    return result;
  } catch (e) {
    writeLocalBackupStatus({
      lastAttemptAt: startedAt,
      lastSuccessAt: previous.lastSuccessAt,
      lastError: e instanceof Error ? e.message : "Local backup failed",
      lastBackupPath: previous.lastBackupPath,
    });
    throw e;
  }
}
