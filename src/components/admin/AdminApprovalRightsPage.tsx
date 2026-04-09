import { useEffect, useMemo, useState } from "react";
import { Save, FileText, ShoppingCart, Gift, BookOpen, PiggyBank, Calculator } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import {
  loadApprovalRights,
  saveApprovalRights,
  type ApprovalRightsConfig,
  approvalRoleLabel,
  getRolesForOrganization,
  filterApprovalConfigToRoles,
} from "../../lib/approvalRights";

type ApprovalKey = keyof ApprovalRightsConfig;
import { PageNotes } from "../common/PageNotes";

export function AdminApprovalRightsPage() {
  const { user } = useAuth();
  const businessType = user?.business_type;
  const [orgRoleKeys, setOrgRoleKeys] = useState<string[]>([]);
  const [orgLabels, setOrgLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user?.organization_id) {
      setOrgRoleKeys([]);
      setOrgLabels({});
      return;
    }
    void supabase
      .from("organization_role_types")
      .select("role_key, display_name")
      .eq("organization_id", user.organization_id)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          setOrgRoleKeys([]);
          setOrgLabels({});
          return;
        }
        if (data?.length) {
          setOrgRoleKeys(data.map((r) => r.role_key));
          setOrgLabels(Object.fromEntries(data.map((r) => [r.role_key, r.display_name])));
        } else {
          setOrgRoleKeys([]);
          setOrgLabels({});
        }
      });
  }, [user?.organization_id]);

  const relevantRoles = useMemo(() => {
    if (orgRoleKeys.length > 0) return orgRoleKeys;
    return getRolesForOrganization(businessType);
  }, [orgRoleKeys, businessType]);

  const labelFor = (role: string) => orgLabels[role] ?? approvalRoleLabel(role);

  const showSaccoSavingsRights = businessType === "sacco";

  const [config, setConfig] = useState<ApprovalRightsConfig>({
    purchase_orders: [],
    bills: [],
    vendor_credits: [],
    chart_of_accounts: [],
    sacco_savings_settings: [],
    payroll_prepare: [],
    payroll_approve: [],
    payroll_post: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = loadApprovalRights();
    setConfig(filterApprovalConfigToRoles(raw, relevantRoles));
    setLoading(false);
  }, [relevantRoles]);

  const toggleRole = (type: ApprovalKey, role: string) => {
    setConfig((prev) => {
      const list = prev[type] || [];
      const has = list.includes(role);
      return {
        ...prev,
        [type]: has ? list.filter((r) => r !== role) : [...list, role],
      };
    });
  };

  const handleSave = () => {
    setSaving(true);
    try {
      const toSave = filterApprovalConfigToRoles(config, relevantRoles);
      saveApprovalRights(toSave);
      setConfig(toSave);
      alert("Approval rights saved.");
    } catch (e) {
      alert("Failed to save.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Approval Rights</h2>
          <PageNotes ariaLabel="Approval rights help">
            <p>
              Select which roles can approve purchase orders, GRN/Bills, supplier returns, manage the Chart of Accounts,
              and who can prepare payroll, approve it for payment, and post to the ledger. Only roles relevant to your
              organization type are shown.
            </p>
          </PageNotes>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 md:col-span-2 xl:col-span-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-indigo-100 p-3 rounded-lg">
              <Calculator className="w-6 h-6 text-indigo-800" />
            </div>
            <h3 className="font-semibold text-slate-900">Payroll</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Segregate duties: typically payroll staff prepare and calculate; a second role approves for payment; accounting
            posts the journal.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800 mb-2">Prepare &amp; calculate</p>
              <p className="text-xs text-slate-500 mb-2">Staff pay, settings, periods, loans, run preparation</p>
              <div className="flex flex-wrap gap-2">
                {relevantRoles.map((role) => {
                  const checked = (config.payroll_prepare || []).includes(role);
                  return (
                    <label
                      key={`pp-${role}`}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition ${
                        checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole("payroll_prepare", role)}
                        className="sr-only"
                      />
                      <span>{labelFor(role)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800 mb-2">Approve for payment</p>
              <p className="text-xs text-slate-500 mb-2">Required before posting payroll to the GL</p>
              <div className="flex flex-wrap gap-2">
                {relevantRoles.map((role) => {
                  const checked = (config.payroll_approve || []).includes(role);
                  return (
                    <label
                      key={`pa-${role}`}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition ${
                        checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole("payroll_approve", role)}
                        className="sr-only"
                      />
                      <span>{labelFor(role)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800 mb-2">Post to ledger</p>
              <p className="text-xs text-slate-500 mb-2">Journal entry &amp; lock payroll</p>
              <div className="flex flex-wrap gap-2">
                {relevantRoles.map((role) => {
                  const checked = (config.payroll_post || []).includes(role);
                  return (
                    <label
                      key={`ppo-${role}`}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-pointer text-sm transition ${
                        checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole("payroll_post", role)}
                        className="sr-only"
                      />
                      <span>{labelFor(role)}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-blue-100 p-3 rounded-lg">
              <ShoppingCart className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="font-semibold text-slate-900">Purchase Orders</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">Roles that can approve purchase orders</p>
          <div className="flex flex-wrap gap-2">
            {relevantRoles.map((role) => {
              const checked = (config.purchase_orders || []).includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                    checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole("purchase_orders", role)}
                    className="sr-only"
                  />
                  <span className="font-medium">{labelFor(role)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-emerald-100 p-3 rounded-lg">
              <FileText className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-slate-900">GRN/Bills</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">Roles that can approve GRN/Bills</p>
          <div className="flex flex-wrap gap-2">
            {relevantRoles.map((role) => {
              const checked = (config.bills || []).includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                    checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole("bills", role)}
                    className="sr-only"
                  />
                  <span className="font-medium">{labelFor(role)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-violet-100 p-3 rounded-lg">
              <Gift className="w-6 h-6 text-violet-600" />
            </div>
            <h3 className="font-semibold text-slate-900">Return to supplier</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">Roles that can add or approve supplier returns and credits</p>
          <div className="flex flex-wrap gap-2">
            {relevantRoles.map((role) => {
              const checked = (config.vendor_credits || []).includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                    checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole("vendor_credits", role)}
                    className="sr-only"
                  />
                  <span className="font-medium">{labelFor(role)}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-amber-100 p-3 rounded-lg">
              <BookOpen className="w-6 h-6 text-amber-700" />
            </div>
            <h3 className="font-semibold text-slate-900">Chart of Accounts</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">Roles that can add, edit, or deactivate GL accounts</p>
          <div className="flex flex-wrap gap-2">
            {relevantRoles.map((role) => {
              const checked = (config.chart_of_accounts || []).includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                    checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole("chart_of_accounts", role)}
                    className="sr-only"
                  />
                  <span className="font-medium">{labelFor(role)}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {showSaccoSavingsRights && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-2xl">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-emerald-100 p-3 rounded-lg">
              <PiggyBank className="w-6 h-6 text-emerald-700" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Savings &amp; member settings</h3>
              <p className="text-sm text-slate-600 mt-1">
                Roles that may edit <strong>Members → Savings settings</strong> (account types and account number format).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {relevantRoles.map((role) => {
              const checked = (config.sacco_savings_settings || []).includes(role);
              return (
                <label
                  key={role}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition ${
                    checked ? "bg-brand-700 text-white border-brand-700" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRole("sacco_savings_settings", role)}
                    className="sr-only"
                  />
                  <span className="font-medium">{labelFor(role)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
