import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { fetchOrganizationMembers } from "../../lib/orgMembership";
import { PageNotes } from "../common/PageNotes";
import {
  PAGE_ACCESS_DEFS,
  PERMISSIONS,
  isSuperAdminControlledReportPage,
  loadPermissionSnapshot,
  pagePermissionKey,
  type PermissionKey,
} from "../../lib/permissions";
import { saveApprovalRights, type ApprovalRightsConfig } from "../../lib/approvalRights";

type RoleTypeRow = {
  role_key: string;
  display_name: string;
  can_edit_pos_orders?: boolean | null;
  can_edit_cash_receipts?: boolean | null;
};

type StaffRow = { id: string; full_name: string; role: string };

interface AdminApprovalRightsPageProps {
  initialFocusStaffId?: string;
  readOnly?: boolean;
  /** Hide duplicate page title when embedded in SACCO Permissions. */
  embedded?: boolean;
}

export function AdminApprovalRightsPage({
  initialFocusStaffId,
  readOnly = false,
  embedded = false,
}: AdminApprovalRightsPageProps = {}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const canManageSensitiveRights = user?.isSuperAdmin === true || user?.role === "super_admin";
  const [roles, setRoles] = useState<RoleTypeRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, Record<string, boolean>>>({});
  const [staffOverrides, setStaffOverrides] = useState<Record<string, Record<string, boolean | null>>>({});
  const [focusStaffId, setFocusStaffId] = useState<string | null>(initialFocusStaffId ?? null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setFocusStaffId(initialFocusStaffId ?? null);
  }, [initialFocusStaffId]);

  useEffect(() => {
    const load = async () => {
      if (!orgId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      try {
        const [roleRes, memberRows, rolePermRes, staffOvRes] = await Promise.all([
          supabase
            .from("organization_role_types")
            .select("role_key,display_name,can_edit_pos_orders,can_edit_cash_receipts")
            .eq("organization_id", orgId)
            .order("sort_order", { ascending: true }),
          fetchOrganizationMembers({ organizationId: orgId }).catch((error) => {
            console.warn("Organization members unavailable; using legacy staff list.", error);
            return [];
          }),
          supabase
            .from("organization_permissions")
            .select("role_key,permission_key,allowed")
            .eq("organization_id", orgId),
          supabase
            .from("staff_permission_overrides")
            .select("staff_id,permission_key,allowed")
            .eq("organization_id", orgId),
        ]);
        if (roleRes.error) throw roleRes.error;
        if (rolePermRes.error) throw rolePermRes.error;
        if (staffOvRes.error) throw staffOvRes.error;

        const roleRows = (roleRes.data || []) as RoleTypeRow[];
        let staffRows = memberRows
          .map((member) => ({ id: member.user_id, full_name: member.full_name, role: member.role }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
        if (staffRows.length === 0) {
          const { data: legacyStaff, error: legacyStaffError } = await supabase
            .from("staff")
            .select("id,full_name,role")
            .eq("organization_id", orgId)
            .order("full_name", { ascending: true });
          if (legacyStaffError) throw legacyStaffError;
          staffRows = (legacyStaff || []) as StaffRow[];
        }
        setRoles(roleRows);
        setStaff(staffRows);

        const rp: Record<string, Record<string, boolean>> = {};
        roleRows.forEach((r) => {
          rp[r.role_key] = {};
          PERMISSIONS.forEach((p) => {
            rp[r.role_key][p.key] = false;
          });
        });
        (rolePermRes.data || []).forEach((row: any) => {
          const rk = String(row.role_key);
          const pk = String(row.permission_key);
          if (!rp[rk]) rp[rk] = {};
          rp[rk][pk] = !!row.allowed;
        });
        setRolePerms(rp);

        const so: Record<string, Record<string, boolean | null>> = {};
        staffRows.forEach((s) => {
          so[String(s.id)] = {};
          PERMISSIONS.forEach((p) => {
            so[String(s.id)][p.key] = null;
          });
          PAGE_ACCESS_DEFS.forEach((p) => {
            so[String(s.id)][pagePermissionKey(p.page)] = null;
          });
        });
        (staffOvRes.data || []).forEach((row: any) => {
          const sid = String(row.staff_id);
          const pk = String(row.permission_key);
          if (!so[sid]) so[sid] = {};
          so[sid][pk] = !!row.allowed;
        });
        setStaffOverrides(so);
      } catch (e) {
        console.error("Permissions load failed:", e);
        setLoadError(e instanceof Error ? e.message : "Could not load permissions for this hotel.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [orgId]);

  const roleLabelByKey = useMemo(() => Object.fromEntries(roles.map((r) => [r.role_key, r.display_name])), [roles]);
  const selectedStaff = staff.find((member) => member.id === focusStaffId) ?? staff[0] ?? null;
  const pageGroups = useMemo(() => {
    const grouped = new Map<string, typeof PAGE_ACCESS_DEFS>();
    PAGE_ACCESS_DEFS.forEach((page) => grouped.set(page.group, [...(grouped.get(page.group) || []), page]));
    return Array.from(grouped.entries());
  }, []);

  const toggleRolePermission = (roleKey: string, key: PermissionKey) => {
    if (readOnly || !canManageSensitiveRights) return;
    setRolePerms((prev) => ({
      ...prev,
      [roleKey]: {
        ...(prev[roleKey] || {}),
        [key]: !prev?.[roleKey]?.[key],
      },
    }));
  };

  const cycleStaffOverride = (staffId: string, key: PermissionKey) => {
    if (readOnly || !canManageSensitiveRights) return;
    setStaffOverrides((prev) => {
      const cur = prev?.[staffId]?.[key] ?? null;
      const next = cur === null ? true : cur === true ? false : null;
      return {
        ...prev,
        [staffId]: { ...(prev[staffId] || {}), [key]: next },
      };
    });
  };

  const setStaffPageAccess = (staffId: string, page: string, allowed: boolean) => {
    if (readOnly) return;
    const key = pagePermissionKey(page);
    setStaffOverrides((prev) => ({
      ...prev,
      [staffId]: { ...(prev[staffId] || {}), [key]: allowed },
    }));
  };

  const save = async () => {
    if (readOnly || !orgId) return;
    setSaving(true);
    try {
      const editablePageKeys = PAGE_ACCESS_DEFS
        .filter((page) => canManageSensitiveRights || !isSuperAdminControlledReportPage(page))
        .map((page) => pagePermissionKey(page.page));
      const editableSensitiveKeys = canManageSensitiveRights ? PERMISSIONS.map((permission) => permission.key) : [];
      const editableOverrideKeys = [...editableSensitiveKeys, ...editablePageKeys];
      const roleUpserts = canManageSensitiveRights
        ? roles.flatMap((r) =>
            PERMISSIONS.map((p) => ({
              organization_id: orgId,
              role_key: r.role_key,
              permission_key: p.key,
              allowed: !!rolePerms?.[r.role_key]?.[p.key],
            }))
          )
        : [];
      const roleOverrides = Object.entries(staffOverrides).flatMap(([staffId, perms]) =>
        Object.entries(perms || {})
          .filter(([permissionKey, v]) => v !== null && editableOverrideKeys.includes(permissionKey as PermissionKey))
          .map(([permission_key, allowed]) => ({
            organization_id: orgId,
            staff_id: staffId,
            permission_key,
            allowed: !!allowed,
          }))
      );
      const [roleSave, deleteOv, ovSave] = await Promise.all([
        roleUpserts.length > 0
          ? supabase
              .from("organization_permissions")
              .upsert(roleUpserts, { onConflict: "organization_id,role_key,permission_key" })
          : Promise.resolve({ error: null as any }),
        supabase
          .from("staff_permission_overrides")
          .delete()
          .eq("organization_id", orgId)
          .in("permission_key", editableOverrideKeys),
        Promise.resolve({ error: null as any }),
      ]);
      if (roleSave.error) throw roleSave.error;
      if (deleteOv.error) throw deleteOv.error;
      if (roleOverrides.length > 0) {
        const res = await supabase
          .from("staff_permission_overrides")
          .upsert(roleOverrides, { onConflict: "organization_id,staff_id,permission_key" });
        if (res.error) throw res.error;
      } else if (ovSave.error) {
        throw ovSave.error;
      }

      if (canManageSensitiveRights) {
        const roleTypePatch = roles.map((r) => ({
          organization_id: orgId,
          role_key: r.role_key,
          can_edit_pos_orders: !!rolePerms?.[r.role_key]?.pos_orders_edit,
          can_edit_cash_receipts: !!rolePerms?.[r.role_key]?.cash_receipts_edit,
        }));
        for (const row of roleTypePatch) {
          const { error } = await supabase
            .from("organization_role_types")
            .update({
              can_edit_pos_orders: row.can_edit_pos_orders,
              can_edit_cash_receipts: row.can_edit_cash_receipts,
            })
            .eq("organization_id", row.organization_id)
            .eq("role_key", row.role_key);
          if (error) throw error;
        }
      }

      const approvalConfig: ApprovalRightsConfig = {
        purchase_orders: roles.filter((r) => rolePerms?.[r.role_key]?.purchase_orders).map((r) => r.role_key),
        bills: roles.filter((r) => rolePerms?.[r.role_key]?.bills).map((r) => r.role_key),
        vendor_credits: roles.filter((r) => rolePerms?.[r.role_key]?.vendor_credits).map((r) => r.role_key),
        chart_of_accounts: roles.filter((r) => rolePerms?.[r.role_key]?.chart_of_accounts).map((r) => r.role_key),
        sacco_savings_settings: roles.filter((r) => rolePerms?.[r.role_key]?.sacco_savings_settings).map((r) => r.role_key),
        payroll_prepare: roles.filter((r) => rolePerms?.[r.role_key]?.payroll_prepare).map((r) => r.role_key),
        payroll_approve: roles.filter((r) => rolePerms?.[r.role_key]?.payroll_approve).map((r) => r.role_key),
        payroll_post: roles.filter((r) => rolePerms?.[r.role_key]?.payroll_post).map((r) => r.role_key),
      };
      if (canManageSensitiveRights) saveApprovalRights(approvalConfig);
      await loadPermissionSnapshot({
        organizationId: user?.organization_id,
        staffId: user?.id,
        role: user?.role,
        isSuperAdmin: canManageSensitiveRights,
      });
      alert("Permissions saved.");
    } catch (e) {
      console.error("Permissions save failed:", e);
      alert(e instanceof Error ? e.message : "Failed to save permissions.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-slate-500 py-8">Loading permissions...</div>;

  return (
    <div className="space-y-6">
      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Could not load page access for this hotel: {loadError}
        </div>
      ) : null}
      {!embedded ? (
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Permissions</h2>
            <PageNotes ariaLabel="Permissions help">
              <p>Operational permissions may follow roles. Page visibility is selected per user and defaults to visible. Sensitive rights are controlled by Super Admin.</p>
            </PageNotes>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={readOnly || saving}
            className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save permissions"}
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={readOnly || saving}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save permissions"}
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-auto">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-2 font-semibold text-slate-700">Permission</th>
              {roles.map((r) => (
                <th key={r.role_key} className="text-left px-3 py-2 font-semibold text-slate-700">
                  {r.display_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.key} className="border-b border-slate-100">
                <td className="px-4 py-2">
                  <p className="font-medium text-slate-900">{p.label}</p>
                  <p className="text-xs text-slate-500">{p.description}</p>
                </td>
                {roles.map((r) => (
                  <td key={`${p.key}:${r.role_key}`} className="px-3 py-2">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!rolePerms?.[r.role_key]?.[p.key]}
                        onChange={() => toggleRolePermission(r.role_key, p.key)}
                        disabled={readOnly || !canManageSensitiveRights}
                      />
                      <span className="text-xs text-slate-600">Allow</span>
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-slate-900">Pages each user can view</h3>
            <p className="text-xs text-slate-500 mt-1">
              Pages are visible by default. Untick a page to hide it for the selected user. Report access can only be changed by a super admin.
            </p>
          </div>
          <label className="min-w-[240px] text-sm font-medium text-slate-700">
            User
            <select
              value={selectedStaff?.id ?? ""}
              onChange={(event) => setFocusStaffId(event.target.value || null)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name} ({roleLabelByKey[member.role] ?? member.role})
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedStaff ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {pageGroups.map(([group, pages]) => {
              return (
                <section key={group} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-800">{group}</h4>
                    {group === "Reports" && !canManageSensitiveRights ? (
                      <span className="text-[11px] font-medium text-amber-700">Super admin controls reports</span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {pages.map((page) => {
                      const key = pagePermissionKey(page.page);
                      const configured = staffOverrides?.[selectedStaff.id]?.[key] ?? null;
                      const allowed = configured !== false;
                      const reportLocked =
                        !canManageSensitiveRights && isSuperAdminControlledReportPage(page);
                      return (
                        <label
                          key={page.page}
                          className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm ${
                            allowed ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50 text-slate-500"
                          } ${reportLocked ? "opacity-60" : "cursor-pointer"}`}
                        >
                          <input
                            type="checkbox"
                            checked={allowed}
                            onChange={(event) => setStaffPageAccess(selectedStaff.id, page.page, event.target.checked)}
                            disabled={readOnly || reportLocked}
                            className="mt-0.5"
                          />
                          <span>{page.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Add a staff user before configuring page visibility.</p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-900 mb-2">Staff-specific overrides</h3>
        <p className="text-xs text-slate-500 mb-3">
          Click each cell to cycle: inherit role → allow → deny. Use this for special permissions per staff.
        </p>
        <div className="overflow-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2">Staff</th>
                {PERMISSIONS.map((p) => (
                  <th key={p.key} className="text-left px-2 py-2 text-xs font-semibold text-slate-700">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b border-slate-100 ${focusStaffId === s.id ? "bg-amber-50" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-900">{s.full_name}</p>
                      {focusStaffId === s.id ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500">{roleLabelByKey[s.role] ?? s.role}</p>
                  </td>
                  {PERMISSIONS.map((p) => {
                    const v = staffOverrides?.[s.id]?.[p.key] ?? null;
                    const label = v === null ? "Inherit" : v ? "Allow" : "Deny";
                    const cls =
                      v === null
                        ? "bg-slate-100 text-slate-700"
                        : v
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-red-100 text-red-800";
                    return (
                      <td key={`${s.id}:${p.key}`} className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => cycleStaffOverride(s.id, p.key)}
                          disabled={readOnly || !canManageSensitiveRights}
                          className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${cls}`}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
