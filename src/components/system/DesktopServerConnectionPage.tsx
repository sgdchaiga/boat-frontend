import React, { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Monitor, Server, Wifi } from "lucide-react";
import { desktopApi } from "@/lib/desktopApi";
import { staticBoatApiBaseUrl } from "@/lib/boatApi";
import type { BoatApiHealth, BoatDesktopSettings } from "@/types/desktop-api";

type Props = {
  onConnected: () => void;
};

const DEFAULT_SETTINGS: BoatDesktopSettings = {
  apiBaseUrl: "http://127.0.0.1:3001",
  deploymentMode: "lan",
  businessType: "school",
};

export const DesktopServerConnectionPage: React.FC<Props> = ({ onConnected }) => {
  const envUrl = staticBoatApiBaseUrl();
  const [form, setForm] = useState<BoatDesktopSettings>({
    ...DEFAULT_SETTINGS,
    apiBaseUrl: envUrl || DEFAULT_SETTINGS.apiBaseUrl,
  });
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<BoatApiHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const settings = await desktopApi.getSettings();
        if (cancelled) return;
        setForm({
          ...DEFAULT_SETTINGS,
          ...settings,
          apiBaseUrl: envUrl || settings.apiBaseUrl || DEFAULT_SETTINGS.apiBaseUrl,
        });
        if (envUrl || settings.apiBaseUrl) {
          const health = await desktopApi.checkApiHealth(envUrl || settings.apiBaseUrl);
          if (cancelled) return;
          setResult(health);
          if (health.ok) onConnected();
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load desktop settings.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [envUrl, onConnected]);

  const saveAndTest = async (event: React.FormEvent) => {
    event.preventDefault();
    setTesting(true);
    setError(null);
    setResult(null);
    try {
      const saved = envUrl
        ? { ...form, apiBaseUrl: envUrl }
        : await desktopApi.updateSettings({
            apiBaseUrl: form.apiBaseUrl,
            deploymentMode: form.deploymentMode,
            businessType: form.businessType,
          });
      setForm(saved);
      const health = await desktopApi.checkApiHealth(saved.apiBaseUrl);
      setResult(health);
      if (!health.ok) {
        setError(health.message || "The BOAT server did not respond successfully.");
        return;
      }
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save server settings.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-emerald-500 flex items-center justify-center">
              <Server size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Connect BOAT Desktop</h1>
              <p className="text-sm text-slate-300">Server-backed school mode</p>
            </div>
          </div>
        </div>

        <form onSubmit={saveAndTest} className="p-6 space-y-5">
          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">BOAT server URL</span>
              <input
                value={form.apiBaseUrl}
                disabled={Boolean(envUrl)}
                onChange={(e) => setForm((prev) => ({ ...prev, apiBaseUrl: e.target.value }))}
                placeholder="http://192.168.1.10:3001"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Connection</span>
              <select
                value={form.deploymentMode}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, deploymentMode: e.target.value as BoatDesktopSettings["deploymentMode"] }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              >
                <option value="lan">LAN client</option>
                <option value="server">This PC is server</option>
                <option value="wan">WAN / secure URL</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3">
              <Monitor className="text-slate-500" size={18} />
              <p className="mt-2 text-sm font-medium text-slate-800">Desktop app</p>
              <p className="text-xs text-slate-500">Runs on each workstation.</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <Wifi className="text-slate-500" size={18} />
              <p className="mt-2 text-sm font-medium text-slate-800">LAN/WAN API</p>
              <p className="text-xs text-slate-500">All business data goes through the server.</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <CheckCircle2 className="text-slate-500" size={18} />
              <p className="mt-2 text-sm font-medium text-slate-800">Postgres source</p>
              <p className="text-xs text-slate-500">Shared database on the server PC.</p>
            </div>
          </div>

          {loading && <p className="text-sm text-slate-500">Checking saved server settings...</p>}
          {result && (
            <div className={`rounded-md px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {result.ok ? `Connected to ${result.service || "BOAT server"}.` : result.message || "Connection failed."}
            </div>
          )}
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <button
            type="submit"
            disabled={testing || loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {testing && <Loader2 size={16} className="animate-spin" />}
            Save and connect
          </button>
        </form>
      </div>
    </div>
  );
};
