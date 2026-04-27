import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  applyLocalSubscriptionRenewalToken,
  localSubscriptionChangedEventName,
  readLocalSubscriptionProfile,
} from "@/lib/localSubscriptionLicense";

const DEFAULT_LOCAL_ORGANIZATION_ID = "00000000-0000-0000-0000-000000000001";

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString();
}

export function AdminSubscriptionRenewalPage() {
  const { user, refreshUserFlags } = useAuth();
  const organizationId =
    user?.organization_id ||
    (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim() ||
    DEFAULT_LOCAL_ORGANIZATION_ID;
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const eventName = localSubscriptionChangedEventName();
    const onChanged = () => setTick((v) => v + 1);
    window.addEventListener(eventName, onChanged);
    return () => window.removeEventListener(eventName, onChanged);
  }, []);

  const profile = useMemo(() => readLocalSubscriptionProfile(organizationId), [organizationId, tick]);

  const applyToken = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await applyLocalSubscriptionRenewalToken({
        token: tokenInput,
        organizationId,
      });
      setMessage(
        `Subscription updated: ${next.status.toUpperCase()} (${next.period_start || "—"} to ${
          next.period_end || "—"
        }).`
      );
      setTokenInput("");
      await refreshUserFlags();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply token.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Subscription renewal</h2>
        <p className="text-sm text-slate-600 mt-1">
          Paste a signed renewal token from BOAT superuser. Token must match this organization ID.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 space-y-1">
        <p>
          Organization ID: <span className="font-mono">{organizationId}</span>
        </p>
        <p>
          Current status: <strong>{(profile?.status || user?.subscription_status || "none").toUpperCase()}</strong>
        </p>
        <p>Current period start: {fmtDate(profile?.period_start)}</p>
        <p>Current period end: {fmtDate(profile?.period_end || user?.subscription_period_end)}</p>
        <p>Current plan: {profile?.plan_code || user?.subscription_plan_code || "—"}</p>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">Renewal token</label>
        <textarea
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          className="w-full min-h-[120px] border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono"
          placeholder="Paste JWT token here"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void applyToken()}
          disabled={saving || !tokenInput.trim()}
          className="app-btn-primary disabled:opacity-60"
        >
          {saving ? "Applying..." : "Apply renewal token"}
        </button>
        {message ? <span className="text-sm text-emerald-700">{message}</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    </div>
  );
}

