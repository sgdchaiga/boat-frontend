import { useEffect, useState } from "react";
import { Building2, Save, MapPin, Phone, Mail, DollarSign } from "lucide-react";
import {
  loadHotelConfig,
  saveHotelConfig,
  mergeHotelConfigWithOrg,
  type HotelConfig,
  DEFAULT_CONFIG,
} from "../../lib/hotelConfig";
import { DEFAULT_KITCHEN_BAR_FLOW, normalizeKitchenBarStatusFlow } from "../../lib/hotelPosOrderStatus";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { desktopApi } from "../../lib/desktopApi";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

const LOCAL_AUTH_ON = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
const USE_LOCAL_SQLITE = LOCAL_AUTH_ON && desktopApi.isAvailable();

const POS_FLOW_PRESETS: Record<string, string[]> = {
  full: ["pending", "preparing", "ready", "served"],
  skip_preparing: ["pending", "ready", "served"],
  quick: ["pending", "served"],
};

function flowPresetKey(flow: string[] | undefined): string {
  const n = normalizeKitchenBarStatusFlow(flow).join(",");
  if (n === "pending,preparing,ready,served") return "full";
  if (n === "pending,ready,served") return "skip_preparing";
  if (n === "pending,served") return "quick";
  return "custom";
}

type OrgRow = {
  id: string;
  name: string | null;
  slug: string | null;
  address: string | null;
  logo_url?: string | null;
};

export function AdminHotelConfigPage() {
  const { user, refreshUserFlags } = useAuth();
  const organizationId = user?.organization_id ?? null;
  const isSuperAdmin = !!user?.isSuperAdmin;
  const [config, setConfig] = useState<HotelConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organization, setOrganization] = useState<OrgRow | null>(null);
  const [billLogoUrl, setBillLogoUrl] = useState("");
  const [purchasesRequirePoApproval, setPurchasesRequirePoApproval] = useState(true);
  const [purchasesRequireBillApproval, setPurchasesRequireBillApproval] = useState(true);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [kitchenSelectOverride, setKitchenSelectOverride] = useState<string | null>(null);
  const [barSelectOverride, setBarSelectOverride] = useState<string | null>(null);
  const [kitchenFlowDraft, setKitchenFlowDraft] = useState("");
  const [barFlowDraft, setBarFlowDraft] = useState("");
  const [posDepartmentOptions, setPosDepartmentOptions] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const base = loadHotelConfig(organizationId);
        if (!organizationId) {
          if (!cancelled) {
            setConfig(base);
            setOrganization(null);
            setBillLogoUrl("");
          }
          return;
        }
        const { data, error } = await supabase
          .from("organizations")
          .select("id,name,slug,address,logo_url,purchases_require_po_approval,purchases_require_bill_approval")
          .eq("id", organizationId)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error(error);
          if (!cancelled) {
            setConfig(base);
            setOrganization(null);
            setBillLogoUrl("");
          }
          return;
        }
        const row = data as OrgRow | null;
        if (!cancelled) {
          setOrganization(row);
          setBillLogoUrl((row?.logo_url ?? "").trim());
          setPurchasesRequirePoApproval((data as { purchases_require_po_approval?: boolean | null }).purchases_require_po_approval !== false);
          setPurchasesRequireBillApproval((data as { purchases_require_bill_approval?: boolean | null }).purchases_require_bill_approval !== false);
          setConfig(mergeHotelConfigWithOrg(base, row));
        }
      } catch (e) {
        console.error("[Business configuration] load failed:", e);
        if (!cancelled) {
          setConfig(loadHotelConfig(organizationId));
          setOrganization(null);
          setBillLogoUrl("");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    setKitchenSelectOverride(null);
    setBarSelectOverride(null);
  }, [organizationId]);

  useEffect(() => {
    if (loading) return;
    setKitchenFlowDraft(normalizeKitchenBarStatusFlow(config.pos_kitchen_status_flow).join(", "));
    setBarFlowDraft(normalizeKitchenBarStatusFlow(config.pos_bar_status_flow).join(", "));
  }, [loading, organizationId]);

  useEffect(() => {
    let cancelled = false;
    if (!organizationId) {
      setPosDepartmentOptions([]);
      return;
    }
    void (async () => {
      const q = filterByOrganizationId(
        supabase.from("departments").select("id,name").order("name"),
        organizationId,
        isSuperAdmin
      );
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error("[Admin hotel config] departments:", error);
        setPosDepartmentOptions([]);
        return;
      }
      setPosDepartmentOptions((data || []) as Array<{ id: string; name: string }>);
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, isSuperAdmin]);

  const handleSave = async () => {
    setSaving(true);
    try {
      saveHotelConfig(config, organizationId);
      if (organizationId && !USE_LOCAL_SQLITE) {
        const { error: rpcErr } = await supabase.rpc("save_organization_guest_bill_profile", {
          p_address: config.address?.trim() ?? "",
          p_logo_url: billLogoUrl.trim(),
        });
        if (rpcErr) {
          console.warn("[Business configuration] guest bill profile sync:", rpcErr);
        } else {
          setOrganization((o) =>
            o
              ? {
                  ...o,
                  address: config.address?.trim() ? config.address.trim() : null,
                  logo_url: billLogoUrl.trim() || null,
                }
              : o
          );
        }
      } else if (organizationId && USE_LOCAL_SQLITE) {
        try {
          const updated = await desktopApi.localUpdate({
            table: "organizations",
            filters: [{ column: "id", operator: "eq", value: organizationId }],
            patch: {
              address: config.address?.trim() || null,
              logo_url: billLogoUrl.trim() || null,
            },
          });
          if (updated.length) {
            setOrganization((o) =>
              o
                ? {
                    ...o,
                    address: config.address?.trim() ? config.address.trim() : null,
                    logo_url: billLogoUrl.trim() || null,
                  }
                : o
            );
          }
        } catch (e) {
          console.warn("[Business configuration] local org bill fields:", e);
        }
      }
      alert("Business configuration saved.");
    } catch (e) {
      alert("Failed to save.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const kitchenSelectValue = kitchenSelectOverride ?? flowPresetKey(config.pos_kitchen_status_flow);
  const barSelectValue = barSelectOverride ?? flowPresetKey(config.pos_bar_status_flow);

  const applyKitchenFlowDraft = () => {
    const parts = kitchenFlowDraft.split(",").map((s) => s.trim()).filter(Boolean);
    const norm = normalizeKitchenBarStatusFlow(parts);
    setConfig((c) => ({ ...c, pos_kitchen_status_flow: [...norm] }));
    setKitchenFlowDraft(norm.join(", "));
    if (flowPresetKey(norm) !== "custom") setKitchenSelectOverride(null);
  };

  const applyBarFlowDraft = () => {
    const parts = barFlowDraft.split(",").map((s) => s.trim()).filter(Boolean);
    const norm = normalizeKitchenBarStatusFlow(parts);
    setConfig((c) => ({ ...c, pos_bar_status_flow: [...norm] }));
    setBarFlowDraft(norm.join(", "));
    if (flowPresetKey(norm) !== "custom") setBarSelectOverride(null);
  };

  const handleSavePurchaseWorkflow = async () => {
    if (!organizationId) return;
    setWorkflowSaving(true);
    try {
      if (USE_LOCAL_SQLITE) {
        const updated = await desktopApi.localUpdate({
          table: "organizations",
          filters: [{ column: "id", operator: "eq", value: organizationId }],
          patch: {
            purchases_require_po_approval: purchasesRequirePoApproval,
            purchases_require_bill_approval: purchasesRequireBillApproval,
          },
        });
        if (!updated.length) {
          alert(
            "No organization record found in local data for this tenant. Use Admin → Local import (or seed) so an organizations row exists, then try again."
          );
          return;
        }
        await refreshUserFlags();
        alert("Purchase workflow settings saved.");
        return;
      }

      const { error } = await supabase.rpc("update_organization_purchase_workflow", {
        p_require_po_approval: purchasesRequirePoApproval,
        p_require_bill_approval: purchasesRequireBillApproval,
      });
      if (error) throw error;
      await refreshUserFlags();
      alert("Purchase workflow settings saved.");
    } catch (e) {
      alert(
        e instanceof Error
          ? e.message
          : "Could not save. Ensure your database has the latest migration, and that your role is admin or manager."
      );
    } finally {
      setWorkflowSaving(false);
    }
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading…</div>;
  }

  const orgNameDisplay = organization?.name?.trim() || "—";
  const slugDisplay = organization?.slug?.trim();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-slate-900">Business Configuration</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Business (organization record)</label>
          <input
            value={orgNameDisplay}
            readOnly
            className="border border-slate-300 rounded-lg px-3 py-2 w-full bg-slate-50 text-slate-700"
            title="Name from organizations table for your account’s organization_id"
          />
          {slugDisplay ? (
            <p className="text-xs text-slate-500 mt-1">
              Slug: <span className="font-mono">{slugDisplay}</span>
            </p>
          ) : null}
          <p className="text-xs text-slate-500 mt-1">
            This is the tenant name in the database for your login. Invoice display name below can differ and is stored in
            your browser for this organization.
          </p>
          {organizationId && organization?.name?.includes("Default property") && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              Your staff user is linked to the seeded default organization. To use another business, a platform admin should
              assign your account to the correct organization (or update this organization’s name in the platform console).
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Business type</label>
          <input
            value={String(user?.business_type || "other").replace("_", " ")}
            readOnly
            className="border border-slate-300 rounded-lg px-3 py-2 w-full bg-slate-50 text-slate-700 capitalize"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Display name (invoices &amp; PDFs)</label>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-400" />
            <input
              value={config.hotel_name}
              onChange={(e) => setConfig({ ...config, hotel_name: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="Business name"
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Initialized from your organization name when empty; saved locally per organization.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-slate-400" />
            <input
              value={config.address}
              onChange={(e) => setConfig({ ...config, address: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="Street, city, country"
            />
          </div>
          {organization?.address?.trim() ? (
            <p className="text-xs text-slate-500 mt-1">
              Organization address on file: {organization.address}
            </p>
          ) : null}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Bill logo URL (optional)</label>
          <p className="text-xs text-slate-500 mb-1">
            Public <code className="text-xs bg-slate-100 px-1 rounded">https://</code> image link — shown on printed guest bills (Active stays → Print bill).
          </p>
          <input
            type="url"
            value={billLogoUrl}
            onChange={(e) => setBillLogoUrl(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 w-full"
            placeholder="https://example.com/logo.png"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-slate-400" />
            <input
              value={config.phone}
              onChange={(e) => setConfig({ ...config, phone: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="+256 xxx xxxxxx"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-slate-400" />
            <input
              type="email"
              value={config.email}
              onChange={(e) => setConfig({ ...config, email: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="contact@hotel.com"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-slate-400" />
              <select
                value={config.currency}
                onChange={(e) => setConfig({ ...config, currency: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              >
                <option value="USD">USD</option>
                <option value="UGX">UGX</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
            <select
              value={config.timezone}
              onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 w-full"
            >
              <option value="Africa/Kampala">Africa/Kampala (GMT+3)</option>
              <option value="Africa/Nairobi">Africa/Nairobi</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New York</option>
            </select>
          </div>
        </div>
      </div>

      {(user?.business_type === "hotel" ||
        user?.business_type === "mixed" ||
        user?.business_type === "restaurant" ||
        !user?.business_type) && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h3 className="text-base font-semibold text-slate-900">Hotel POS — tables &amp; kitchen/bar workflow</h3>
          <p className="text-sm text-slate-600">
            Saved with <span className="font-medium">Save</span> above (browser, per organization). Waiter POS reads these on load and when the window regains focus.
          </p>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Table session</label>
            <div className="space-y-2 text-sm">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pos_table_session_mode"
                  checked={(config.pos_table_session_mode ?? "manual") === "auto"}
                  onChange={() =>
                    setConfig({
                      ...config,
                      pos_table_session_mode: "auto",
                    })
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-slate-800">Automatic</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Tapping a table opens a session immediately. The session closes when that table has no active orders
                    (nothing pending through ready). Per-table override is available on the POS table panel.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="pos_table_session_mode"
                  checked={(config.pos_table_session_mode ?? "manual") === "manual"}
                  onChange={() =>
                    setConfig({
                      ...config,
                      pos_table_session_mode: "manual",
                    })
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-slate-800">Manual (legacy)</span>
                  <span className="block text-xs text-slate-500 mt-0.5">
                    Waiter taps <strong>Open session</strong> before sending orders, then <strong>Close session</strong> when done.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Kitchen order steps</label>
              <select
                value={kitchenSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") {
                    setKitchenSelectOverride("custom");
                    setKitchenFlowDraft(
                      normalizeKitchenBarStatusFlow(config.pos_kitchen_status_flow).join(", ")
                    );
                    return;
                  }
                  setKitchenSelectOverride(null);
                  const flow = [...(POS_FLOW_PRESETS[v] || DEFAULT_KITCHEN_BAR_FLOW)];
                  setKitchenFlowDraft(flow.join(", "));
                  setConfig((c) => ({ ...c, pos_kitchen_status_flow: flow }));
                }}
                className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm"
              >
                <option value="full">Full — Pending → Preparing → Ready → Served</option>
                <option value="skip_preparing">Skip preparing — Pending → Ready → Served</option>
                <option value="quick">Quick — Pending → Served</option>
                <option value="custom">Custom…</option>
              </select>
              {kitchenSelectValue === "custom" ? (
                <div className="mt-2 space-y-1">
                  <label className="block text-xs text-slate-600">Statuses (comma-separated). Applied when this field loses focus.</label>
                  <input
                    type="text"
                    value={kitchenFlowDraft}
                    onChange={(e) => setKitchenFlowDraft(e.target.value)}
                    onBlur={applyKitchenFlowDraft}
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm font-mono"
                    placeholder="pending, preparing, ready, served"
                    spellCheck={false}
                  />
                  <p className="text-xs text-slate-500">
                    First must be <span className="font-mono text-slate-700">pending</span>; last{" "}
                    <span className="font-mono text-slate-700">served</span> or{" "}
                    <span className="font-mono text-slate-700">completed</span>. Middle steps: preparing, ready (invalid
                    lists fall back to the full four-step flow).
                  </p>
                </div>
              ) : null}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bar / sauna counter steps</label>
              <select
                value={barSelectValue}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") {
                    setBarSelectOverride("custom");
                    setBarFlowDraft(normalizeKitchenBarStatusFlow(config.pos_bar_status_flow).join(", "));
                    return;
                  }
                  setBarSelectOverride(null);
                  const flow = [...(POS_FLOW_PRESETS[v] || DEFAULT_KITCHEN_BAR_FLOW)];
                  setBarFlowDraft(flow.join(", "));
                  setConfig((c) => ({ ...c, pos_bar_status_flow: flow }));
                }}
                className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm"
              >
                <option value="full">Full — Pending → Preparing → Ready → Served</option>
                <option value="skip_preparing">Skip preparing — Pending → Ready → Served</option>
                <option value="quick">Quick — Pending → Served</option>
                <option value="custom">Custom…</option>
              </select>
              {barSelectValue === "custom" ? (
                <div className="mt-2 space-y-1">
                  <label className="block text-xs text-slate-600">Statuses (comma-separated). Applied when this field loses focus.</label>
                  <input
                    type="text"
                    value={barFlowDraft}
                    onChange={(e) => setBarFlowDraft(e.target.value)}
                    onBlur={applyBarFlowDraft}
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm font-mono"
                    placeholder="pending, preparing, ready, served"
                    spellCheck={false}
                  />
                  <p className="text-xs text-slate-500">
                    First must be <span className="font-mono text-slate-700">pending</span>; last{" "}
                    <span className="font-mono text-slate-700">served</span> or{" "}
                    <span className="font-mono text-slate-700">completed</span>. Middle steps: preparing, ready (invalid
                    lists fall back to the full four-step flow).
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5 mt-4 space-y-4">
            <h4 className="text-sm font-semibold text-slate-800">Department scope (Kitchen / Bar / Sauna order pages)</h4>
            <p className="text-sm text-slate-600">
              Choose which department each page lists (by product department). Use <span className="font-medium">Auto</span> for
              built-in detection. Example: set <strong>Sauna / spa / events</strong> to an <strong>Events</strong> department if
              those tickets are sold there.
            </p>
            {!organizationId ? (
              <p className="text-xs text-amber-700">Link an organization to load departments for these lists.</p>
            ) : posDepartmentOptions.length === 0 ? (
              <p className="text-xs text-slate-500">No departments found for this organization.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Kitchen Orders</label>
                  <select
                    value={config.pos_kitchen_orders_department_id ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        pos_kitchen_orders_department_id: e.target.value ? e.target.value : null,
                      })
                    }
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm"
                  >
                    <option value="">Auto (kitchen / restaurant / dish menu)</option>
                    {posDepartmentOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Bar Orders</label>
                  <select
                    value={config.pos_bar_department_id ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        pos_bar_department_id: e.target.value ? e.target.value : null,
                      })
                    }
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm"
                  >
                    <option value="">Auto (name contains &quot;bar&quot;)</option>
                    {posDepartmentOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sauna / spa / events</label>
                  <select
                    value={config.pos_sauna_department_id ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        pos_sauna_department_id: e.target.value ? e.target.value : null,
                      })
                    }
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full text-sm"
                  >
                    <option value="">Auto (name contains &quot;sauna&quot; or &quot;spa&quot;)</option>
                    {posDepartmentOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {user?.enable_purchases !== false && organizationId && (
        <div className="border border-slate-200 rounded-xl p-6 space-y-4 bg-slate-50/50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">Purchase workflow</h3>
            <button
              type="button"
              onClick={() => void handleSavePurchaseWorkflow()}
              disabled={workflowSaving}
              className="text-sm bg-brand-700 text-white px-3 py-1.5 rounded-lg hover:bg-brand-800 disabled:opacity-50"
            >
              {workflowSaving ? "Saving…" : "Save workflow"}
            </button>
          </div>
          <p className="text-sm text-slate-600">
            Control optional approval steps between purchase orders and GRN/bills. Platform admins can also set these in{" "}
            <span className="font-medium">Organizations</span>.
          </p>
          <label className="flex items-start gap-2 text-sm text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={purchasesRequirePoApproval}
              onChange={(e) => setPurchasesRequirePoApproval(e.target.checked)}
            />
            <span>
              Require purchase order approval before converting to GRN/bill
              <span className="block text-xs text-slate-500 mt-0.5">
                When off, staff can convert a pending PO directly to a GRN/bill (PO is marked approved when converted).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={purchasesRequireBillApproval}
              onChange={(e) => setPurchasesRequireBillApproval(e.target.checked)}
            />
            <span>
              Require GRN/bill approval after converting from a purchase order
              <span className="block text-xs text-slate-500 mt-0.5">
                When off, the GRN/bill is finalized on convert (journal and stock-in run immediately). Manual GRN/bills
                created outside the PO flow still follow normal approval rules.
              </span>
            </span>
          </label>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Display name, phone, email, and currency are stored in your browser for this organization. Saving also syncs{" "}
        <strong>Address</strong> and <strong>Bill logo URL</strong> to the server so printed guest bills (Active stays)
        include your property header.
      </p>
    </div>
  );
}
