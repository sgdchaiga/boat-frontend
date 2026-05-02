import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, KeyRound, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

type VoidLogRow = {
  id: string;
  payment_id: string | null;
  status: "pending" | "approved" | "rejected";
  reason: string;
  created_at: string;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
};

export function AdminHotelPosControlsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const role = (user?.role || "").toLowerCase();
  const canManage = role === "manager" || role === "supervisor" || role === "admin" || role === "accountant";

  const [pinA, setPinA] = useState("");
  const [pinB, setPinB] = useState("");
  const [settingPin, setSettingPin] = useState(false);
  const [pinStatus, setPinStatus] = useState<"unknown" | "set" | "not_set">("unknown");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<VoidLogRow[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [advancedModeEnabled, setAdvancedModeEnabled] = useState(true);
  const [savingAdvancedMode, setSavingAdvancedMode] = useState(false);

  const pendingRows = useMemo(() => rows.filter((r) => r.status === "pending"), [rows]);

  const loadPinStatus = async () => {
    if (!orgId) return;
    try {
      const res = await filterByOrganizationId(
        (supabase as any).from("pos_manager_pin_hashes").select("staff_id").eq("staff_id", user?.id),
        orgId,
        superAdmin
      );
      if (!res.error) {
        setPinStatus((res.data || []).length > 0 ? "set" : "not_set");
        return;
      }
    } catch {
      // If migration not applied yet, keep unknown.
    }
    setPinStatus("unknown");
  };

  const loadVoidLogs = async () => {
    setError(null);
    try {
      if (!orgId) {
        setRows([]);
        return;
      }
      const res = await filterByOrganizationId(
        (supabase as any)
          .from("pos_void_logs")
          .select("id,payment_id,status,reason,created_at,requested_by,approved_by,approved_at")
          .order("created_at", { ascending: false }),
        orgId,
        superAdmin
      );
      if (res.error) throw res.error;
      setRows((res.data || []) as VoidLogRow[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load void logs.");
      setRows([]);
    }
  };

  const loadAdvancedMode = async () => {
    if (!orgId) return;
    try {
      const { data, error } = await supabase
        .from("organization_permissions")
        .select("id,allowed")
        .eq("organization_id", orgId)
        .eq("role_key", "__org__")
        .eq("permission_key", "retail_pos_advanced_mode")
        .maybeSingle();
      if (error) throw error;
      if (typeof data?.allowed === "boolean") {
        setAdvancedModeEnabled(!!data.allowed);
      } else {
        setAdvancedModeEnabled(true);
      }
    } catch {
      setAdvancedModeEnabled(true);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await Promise.all([loadPinStatus(), loadVoidLogs(), loadAdvancedMode()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, superAdmin]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([loadPinStatus(), loadVoidLogs(), loadAdvancedMode()]);
    setRefreshing(false);
  };

  const toggleAdvancedMode = async () => {
    if (!orgId) return;
    if (!canManage && !superAdmin) {
      alert("Only supervisor/manager can change this setting.");
      return;
    }
    setSavingAdvancedMode(true);
    const next = !advancedModeEnabled;
    try {
      const { data, error } = await supabase
        .from("organization_permissions")
        .select("id")
        .eq("organization_id", orgId)
        .eq("role_key", "__org__")
        .eq("permission_key", "retail_pos_advanced_mode")
        .maybeSingle();
      if (error) throw error;
      if (data?.id) {
        const { error: updErr } = await supabase
          .from("organization_permissions")
          .update({ allowed: next, updated_at: new Date().toISOString() })
          .eq("id", data.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from("organization_permissions").insert({
          organization_id: orgId,
          role_key: "__org__",
          permission_key: "retail_pos_advanced_mode",
          allowed: next,
        });
        if (insErr) throw insErr;
      }
      setAdvancedModeEnabled(next);
      alert(`Retail POS advanced mode ${next ? "enabled" : "disabled"}.`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update advanced mode setting.");
    } finally {
      setSavingAdvancedMode(false);
    }
  };

  const setManagerPin = async () => {
    if (!orgId) {
      alert("No organization on this user.");
      return;
    }
    if (!canManage) {
      alert("Only supervisor/manager can set a manager PIN.");
      return;
    }
    const a = pinA.trim();
    const b = pinB.trim();
    if (!a || a.length < 4) {
      alert("PIN must be at least 4 digits/characters.");
      return;
    }
    if (a !== b) {
      alert("PIN confirmation does not match.");
      return;
    }
    setSettingPin(true);
    try {
      const res = await (supabase as any).rpc("set_my_manager_pin", { pin: a, org_id: orgId });
      if (res?.error) throw res.error;
      setPinA("");
      setPinB("");
      await loadPinStatus();
      alert("Manager PIN updated.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to set manager PIN. Ensure migration is applied.");
    } finally {
      setSettingPin(false);
    }
  };

  const updateVoid = async (id: string, status: "approved" | "rejected") => {
    if (!canManage) {
      alert("Only supervisor/manager can approve/reject void requests.");
      return;
    }
    setUpdatingId(id);
    try {
      const { error } = await (supabase as any)
        .from("pos_void_logs")
        .update({
          status,
          approved_by: user?.id ?? null,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      await loadVoidLogs();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update void request.");
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Retail POS Advanced Mode</h2>
            <p className="text-sm text-slate-600">Enable or disable advanced payment features in Retail POS.</p>
          </div>
          <button
            type="button"
            onClick={toggleAdvancedMode}
            disabled={savingAdvancedMode || (!canManage && !superAdmin)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold border ${
              advancedModeEnabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-300 bg-white text-slate-700"
            } disabled:opacity-50`}
          >
            {savingAdvancedMode ? "Saving..." : advancedModeEnabled ? "On" : "Off"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-900">Manager PIN Override</h2>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          This PIN is used to authorize waiter overrides for void/refund workflows. Stored securely (hashed) in Supabase.
        </p>
        <p className="text-sm mb-3">
          Status:{" "}
          <span className={`font-semibold ${pinStatus === "set" ? "text-emerald-700" : "text-amber-700"}`}>
            {pinStatus === "set" ? "Set" : pinStatus === "not_set" ? "Not set" : "Unknown (migration not applied?)"}
          </span>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">New PIN</label>
            <input
              type="password"
              value={pinA}
              onChange={(e) => setPinA(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="••••"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Confirm PIN</label>
            <input
              type="password"
              value={pinB}
              onChange={(e) => setPinB(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="••••"
            />
          </div>
          <button
            type="button"
            onClick={setManagerPin}
            disabled={settingPin || !canManage}
            className="app-btn-primary justify-center disabled:opacity-50"
          >
            {settingPin ? "Saving…" : "Set / Rotate PIN"}
          </button>
        </div>
        {!canManage ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Your role ({role || "staff"}) cannot set manager PIN. Ask a supervisor/manager.
          </p>
        ) : null}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Void / Refund Approvals</h2>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Review pending requests created by POS edits and approve or reject.
        </p>
        {error ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">{error}</div>
        ) : null}
        {pendingRows.length === 0 ? (
          <p className="text-sm text-slate-500">No pending void/refund requests.</p>
        ) : (
          <div className="space-y-3">
            {pendingRows.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Request #{r.id.slice(0, 8)}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(r.created_at).toLocaleString()} · Payment: {r.payment_id?.slice(0, 8) || "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateVoid(r.id, "approved")}
                      disabled={updatingId === r.id || !canManage}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => updateVoid(r.id, "rejected")}
                      disabled={updatingId === r.id || !canManage}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                </div>
                <p className="text-sm text-slate-700 mt-3">
                  <span className="font-medium">Reason:</span> {r.reason}
                </p>
              </div>
            ))}
          </div>
        )}
        {!canManage ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            Your role ({role || "staff"}) cannot approve/reject requests.
          </p>
        ) : null}
      </div>
    </div>
  );
}

