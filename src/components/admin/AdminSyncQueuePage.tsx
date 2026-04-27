import { useEffect, useState } from "react";
import { desktopApi } from "@/lib/desktopApi";
import { pushPendingLocalSyncQueue } from "@/lib/localSyncPush";
import { getDeploymentMode, getTenantIdDetails, setTenantIdOverride } from "@/lib/deployment";
import {
  localBackupStatusEventName,
  readLocalBackupStatus,
  runLocalBackupNow,
  type LocalBackupStatus,
} from "@/lib/localBackup";

type SyncQueueRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
  last_error: string | null;
};

const UUID_V1_TO_V5_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function AdminSyncQueuePage() {
  const [rows, setRows] = useState<SyncQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [backupStatus, setBackupStatus] = useState<LocalBackupStatus>(() => readLocalBackupStatus());
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [tenantOverrideInput, setTenantOverrideInput] = useState("");
  const deploymentMode = getDeploymentMode();
  const tenantDetails = getTenantIdDetails();
  const tenantSourceLabel =
    tenantDetails.source === "vite_tenant_id"
      ? "VITE_TENANT_ID"
      : tenantDetails.source === "vite_local_organization_id"
      ? "VITE_LOCAL_ORGANIZATION_ID"
      : tenantDetails.source === "local_storage_override"
      ? "Local override"
      : "missing";
  const tenantInputTrimmed = tenantOverrideInput.trim();
  const tenantInputLooksValid =
    tenantInputTrimmed.length === 0 || UUID_V1_TO_V5_REGEX.test(tenantInputTrimmed);

  useEffect(() => {
    setTenantOverrideInput(tenantDetails.tenantId || "");
  }, [tenantDetails.tenantId]);

  const load = async () => {
    if (!desktopApi.isAvailable()) {
      setRows([]);
      setLoading(false);
      setError("Sync queue is available in desktop mode only.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await desktopApi.listSyncQueue();
      setRows((data || []) as SyncQueueRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sync queue.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const eventName = localBackupStatusEventName();
    const onStatus = () => setBackupStatus(readLocalBackupStatus());
    onStatus();
    window.addEventListener(eventName, onStatus);
    return () => {
      window.removeEventListener(eventName, onStatus);
    };
  }, []);

  const pushNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await pushPendingLocalSyncQueue();
      await load();
      if (result.total === 0) {
        setError("No pending rows to sync.");
      } else if (result.failed > 0) {
        setError(`Synced ${result.ok}/${result.total}. ${result.failed} failed.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const backupNow = async () => {
    setBackingUp(true);
    setBackupMessage(null);
    try {
      const res = await runLocalBackupNow();
      setBackupMessage(`Backup created: ${res.backupFileName}`);
    } catch (e) {
      setBackupMessage(e instanceof Error ? e.message : "Backup failed.");
    } finally {
      setBackupStatus(readLocalBackupStatus());
      setBackingUp(false);
    }
  };

  const saveTenantOverride = () => {
    const next = tenantOverrideInput.trim();
    if (next && !UUID_V1_TO_V5_REGEX.test(next)) {
      setBackupMessage("Tenant override must be a valid UUID (8-4-4-4-12).");
      return;
    }
    setTenantIdOverride(next || null);
    setBackupMessage(next ? "Tenant override saved for this device." : "Tenant override cleared.");
  };

  if (loading) {
    return <div className="app-card p-6 text-sm text-slate-600">Loading sync queue...</div>;
  }

  return (
    <div className="app-card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Local backup &amp; sync</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="app-btn-secondary text-xs">
            Refresh
          </button>
          <button type="button" onClick={() => void pushNow()} disabled={syncing} className="app-btn-primary text-xs">
            {syncing ? "Syncing..." : "Push Now"}
          </button>
          <button
            type="button"
            onClick={() => void backupNow()}
            disabled={backingUp}
            className="app-btn-secondary text-xs"
          >
            {backingUp ? "Backing up..." : "Backup Now"}
          </button>
        </div>
      </div>
      {error ? <p className="p-4 text-sm text-red-600">{error}</p> : null}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs text-slate-700 space-y-1">
        <p>Scheduled local backup runs every 6 hours while the desktop app is open.</p>
        <p>
          Sync mode: <strong>{deploymentMode}</strong>. Tenant source: <strong>{tenantSourceLabel}</strong>.
        </p>
        <p>
          Active tenant id:{" "}
          <span className="font-mono">{tenantDetails.tenantId || "not configured"}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input
            type="text"
            value={tenantOverrideInput}
            onChange={(e) => setTenantOverrideInput(e.target.value)}
            className={`border rounded px-2 py-1 text-xs min-w-[320px] ${
              tenantInputLooksValid ? "border-slate-300" : "border-red-400 bg-red-50"
            }`}
            placeholder="Optional: set tenant UUID override for this device"
          />
          <button
            type="button"
            onClick={saveTenantOverride}
            disabled={!tenantInputLooksValid}
            className="app-btn-secondary text-xs disabled:opacity-60"
          >
            Save tenant
          </button>
        </div>
        <p className={tenantInputLooksValid ? "text-emerald-700" : "text-red-600"}>
          {tenantInputTrimmed.length === 0
            ? "Leave blank to clear override and rely on env values."
            : tenantInputLooksValid
            ? "UUID format looks valid."
            : "Invalid UUID format. Example: b1a3d17f-6fe7-4154-9577-96813915cb48"}
        </p>
        <p>
          Last backup:{" "}
          {backupStatus.lastSuccessAt ? new Date(backupStatus.lastSuccessAt).toLocaleString() : "No successful backup yet"}
        </p>
        {backupStatus.lastBackupPath ? <p className="break-all">Latest file: {backupStatus.lastBackupPath}</p> : null}
        {backupStatus.lastError ? <p className="text-red-600">Last backup error: {backupStatus.lastError}</p> : null}
        {backupMessage ? <p className="text-brand-700">{backupMessage}</p> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left p-2">Created</th>
              <th className="text-left p-2">Entity</th>
              <th className="text-left p-2">Operation</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">
                  No queued sync events.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2">{r.entity_type}</td>
                  <td className="p-2">{r.operation}</td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2 text-red-700">{r.last_error || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

