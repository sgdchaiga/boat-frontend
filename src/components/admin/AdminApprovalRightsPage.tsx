import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { PageNotes } from "../common/PageNotes";
import { PERMISSIONS, type PermissionKey, loadPermissionSnapshot } from "../../lib/permissions";
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
}

export function AdminApprovalRightsPage({ initialFocusStaffId }: AdminApprovalRightsPageProps = {}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [roles, setRoles] = useState<RoleTypeRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, Record<string, boolean>>>({});
  const [staffOverrides, setStaffOverrides] = useState<Record<string, Record<string, boolean | null>>>({});
  const [focusStaffId, setFocusStaffId] = useState<string | null>(initialFocusStaffId ?? null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      try {
        const [roleRes, staffRes, rolePermRes, staffOvRes] = await Promise.all([
          supabase
            .from("organization_role_types")
            .select("role_key,display_name,can_edit_pos_orders,can_edit_cash_receipts")
            .eq("organization_id", orgId)
            .order("sort_order", { ascending: true }),
          supabase
            .from("staff")
            .select("id,full_name,role")
            .eq("organization_id", orgId)
            .order("full_name", { ascending: true }),
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
        if (staffRes.error) throw staffRes.error;
        if (rolePermRes.error) throw rolePermRes.error;
        if (staffOvRes.error) throw staffOvRes.error;

        const roleRows = (roleRes.data || []) as RoleTypeRow[];
        setRoles(roleRows);
        setStaff((staffRes.data || []) as StaffRow[]);

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
        (staffRes.data || []).forEach((s: any) => {
          so[String(s.id)] = {};
          PERMISSIONS.forEach((p) => {
            so[String(s.id)][p.key] = null;
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
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [orgId]);

  const roleLabelByKey = useMemo(() => Object.fromEntries(roles.map((r) => [r.role_key, r.display_name])), [roles]);

  const toggleRolePermission = (roleKey: string, key: PermissionKey) => {
    setRolePerms((prev) => ({
      ...prev,
      [roleKey]: {
        ...(prev[roleKey] || {}),
        [key]: !prev?.[roleKey]?.[key],
      },
    }));
  };

  const cycleStaffOverride = (staffId: string, key: PermissionKey) => {
    setStaffOverrides((prev) => {
      const cur = prev?.[staffId]?.[key] ?? null;
      const next = cur === null ? true : cur === true ? false : null;
      return {
        ...prev,
        [staffId]: { ...(prev[staffId] || {}), [key]: next },
      };
    });
  };

  const save = async () => {
    if (!orgId) return;
    setSaving(true);
    try {
      const roleUpserts = roles.flatMap((r) =>
        PERMISSIONS.map((p) => ({
          organization_id: orgId,
          role_key: r.role_key,
          permission_key: p.key,
          allowed: !!rolePerms?.[r.role_key]?.[p.key],
        }))
      );
      const roleOverrides = Object.entries(staffOverrides).flatMap(([staffId, perms]) =>
        Object.entries(perms || {})
          .filter(([, v]) => v !== null)
          .map(([permission_key, allowed]) => ({
            organization_id: orgId,
            staff_id: staffId,
            permission_key,
            allowed: !!allowed,
          }))
      );
      const [roleSave, deleteOv, ovSave] = await Promise.all([
        supabase
          .from("organization_permissions")
          .upsert(roleUpserts, { onConflict: "organization_id,role_key,permission_key" }),
        supabase.from("staff_permission_overrides").delete().eq("organization_id", orgId),
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
      saveApprovalRights(approvalConfig);
      await loadPermissionSnapshot({
        organizationId: user?.organization_id,
        staffId: user?.id,
        role: user?.role,
        isSuperAdmin: user?.isSuperAdmin,
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
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Permissions</h2>
          <PageNotes ariaLabel="Permissions help">
            <p>Role-based permissions with optional staff-specific overrides. This replaces Approval Rights.</p>
          </PageNotes>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving..." : "Save permissions"}
        </button>
      </div>

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
                          className={`rounded px-2 py-1 text-xs font-medium ${cls}`}
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
