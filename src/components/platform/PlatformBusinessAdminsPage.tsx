import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Shield, Users } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { fetchOrganizationMembers } from "@/lib/orgMembership";
import { PageNotes } from "@/components/common/PageNotes";

interface OrgRow {
  id: string;
  name: string;
}

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role: string;
  is_active: boolean;
  organization_id?: string | null;
}

interface RoleRow {
  organization_id: string;
  role_key: string;
  display_name: string;
  sort_order: number;
}

const DEFAULT_ROLES = [
  { role_key: "super_admin", display_name: "Super Admin" },
  { role_key: "admin", display_name: "Administrator" },
  { role_key: "manager", display_name: "Manager" },
  { role_key: "accountant", display_name: "Accountant" },
  { role_key: "receptionist", display_name: "Receptionist" },
  { role_key: "housekeeping", display_name: "Housekeeping" },
] as const;

export function PlatformBusinessAdminsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [roleTypes, setRoleTypes] = useState<RoleRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editingAdmin, setEditingAdmin] = useState<StaffRow | null>(null);
  const [editOrgId, setEditOrgId] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editRole, setEditRole] = useState("admin");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [editConfirmPassword, setEditConfirmPassword] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const orgRes = await supabase.from("organizations").select("id,name").order("name");
      if (orgRes.error) throw orgRes.error;

      const orgData = (orgRes.data || []) as OrgRow[];
      setOrgs(orgData);
      const roleRes = await supabase
        .from("organization_role_types")
        .select("organization_id,role_key,display_name,sort_order")
        .order("sort_order", { ascending: true });
      if (roleRes.error) throw roleRes.error;
      setRoleTypes((roleRes.data || []) as RoleRow[]);
      const rows = await fetchOrganizationMembers();
      setStaff(
        rows.map((row) => ({
            id: row.user_id,
            full_name: row.full_name,
            email: row.email,
            phone: row.phone,
            role: row.role,
            is_active: row.is_active,
            organization_id: row.organization_id,
          }))
      );
      if (!selectedOrgId && orgData[0]?.id) setSelectedOrgId(orgData[0].id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load business admins.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const staffForOrg = useMemo(
    () => staff.filter((s) => s.organization_id === selectedOrgId),
    [staff, selectedOrgId]
  );

  const rolesForOrg = useMemo(() => {
    const configured = roleTypes
      .filter((item) => item.organization_id === selectedOrgId)
      .map(({ role_key, display_name }) => ({ role_key, display_name }));
    const roles: { role_key: string; display_name: string }[] = configured.length
      ? configured
      : [...DEFAULT_ROLES];
    for (const required of DEFAULT_ROLES.slice(0, 2)) {
      if (!roles.some((item) => item.role_key === required.role_key)) roles.unshift(required);
    }
    return roles;
  }, [roleTypes, selectedOrgId]);

  useEffect(() => {
    if (rolesForOrg.length && !rolesForOrg.some((item) => item.role_key === role)) {
      setRole(rolesForOrg.find((item) => item.role_key === "admin")?.role_key || rolesForOrg[0].role_key);
    }
  }, [role, rolesForOrg]);

  const addBusinessAdmin = async () => {
    if (!selectedOrgId) {
      alert("Select an organization.");
      return;
    }
    if (!fullName.trim() || !email.trim()) {
      alert("Full name and email are required.");
      return;
    }
    if (password.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      alert("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const signupClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      );
      const { data: signUpData, error: signUpErr } = await signupClient.auth.signUp({
        email: email.trim(),
        password,
        options: {
            data: {
              full_name: fullName.trim(),
              role,
              phone: phone.trim() || "",
            },
        },
      });
      if (signUpErr) {
        const msg = signUpErr.message.toLowerCase();
        const alreadyRegistered =
          msg.includes("already registered") || msg.includes("already been registered");
        if (alreadyRegistered) {
          const { error: inviteErr } = await supabase.rpc("invite_organization_member", {
            p_email: email.trim(),
            p_organization_id: selectedOrgId,
            p_role: role,
            p_full_name: fullName.trim(),
            p_phone: phone.trim() || null,
          });
          if (inviteErr) throw inviteErr;
        } else {
          throw signUpErr;
        }
      } else {
        const authUserId = signUpData.user?.id;
        if (!authUserId) throw new Error("Failed to create login account for this admin.");

        const payload = {
          id: authUserId,
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          role,
          is_active: true,
          organization_id: selectedOrgId,
        };
        const { error: insErr } = await (supabase as any).from("staff").insert(payload);
        if (insErr) throw insErr;
      }

      setFullName("");
      setEmail("");
      setPhone("");
      setRole(rolesForOrg.find((item) => item.role_key === "admin")?.role_key || rolesForOrg[0]?.role_key || "admin");
      setPassword("");
      setConfirmPassword("");
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to add business admin.");
    } finally {
      setSaving(false);
    }
  };

  const openEditAdmin = (admin: StaffRow) => {
    setEditingAdmin(admin);
    setEditOrgId(admin.organization_id || "");
    setEditFullName(admin.full_name || "");
    setEditPhone(admin.phone || "");
    setEditRole(admin.role);
    setEditIsActive(!!admin.is_active);
    setEditPassword("");
    setEditConfirmPassword("");
  };

  const saveEditedAdmin = async () => {
    if (!editingAdmin) return;
    if (!editOrgId) {
      alert("Select an organization.");
      return;
    }
    if (!editFullName.trim()) {
      alert("Full name is required.");
      return;
    }
    if (editPassword && editPassword.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    if (editPassword && editPassword !== editConfirmPassword) {
      alert("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      let targetStaffId = editingAdmin.id;
      if (editPassword) {
        const signupClient = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY,
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
          }
        );
        const { data: signUpData, error: signUpErr } = await signupClient.auth.signUp({
          email: editingAdmin.email.trim(),
          password: editPassword,
          options: {
            data: {
              full_name: editFullName.trim(),
              role: editRole,
              phone: editPhone.trim() || "",
            },
          },
        });
        if (signUpErr) {
          throw new Error(
            `Could not set password directly: ${signUpErr.message}. If this user already has a login, use forgot password on the login screen.`
          );
        }
        const authUserId = signUpData.user?.id;
        if (!authUserId) {
          throw new Error("Password account creation returned no user id.");
        }
        targetStaffId = authUserId;
      }

      const priorOrgId = editingAdmin.organization_id;
      if (priorOrgId && priorOrgId !== editOrgId) {
        const { error: delMemberErr } = await supabase
          .from("organization_members")
          .delete()
          .eq("user_id", editingAdmin.id)
          .eq("organization_id", priorOrgId);
        if (delMemberErr) throw delMemberErr;
        const { error: linkErr } = await supabase.rpc("invite_organization_member", {
          p_email: editingAdmin.email.trim(),
          p_organization_id: editOrgId,
          p_role: editRole,
          p_full_name: editFullName.trim(),
          p_phone: editPhone.trim() || null,
        });
        if (linkErr) throw linkErr;
      } else {
        const { error: memberErr } = await supabase
          .from("organization_members")
          .update({
            full_name: editFullName.trim(),
            phone: editPhone.trim() || null,
            role: editRole,
            is_active: editIsActive,
          })
          .eq("user_id", editingAdmin.id)
          .eq("organization_id", editOrgId);
        if (memberErr) throw memberErr;
      }

      const { error: updErr } = await supabase
        .from("staff")
        .update({
          id: targetStaffId,
          organization_id: editOrgId,
          full_name: editFullName.trim(),
          phone: editPhone.trim() || null,
          role: editRole,
          is_active: editIsActive,
        })
        .eq("id", editingAdmin.id);
      if (updErr) throw updErr;
      setEditingAdmin(null);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to update business admin.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-slate-600">Loading business admins…</div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Staff Account Setup</h1>
        <PageNotes ariaLabel="Staff accounts help">
          <p>Create and manage staff login accounts for any organization and assign an organization role.</p>
        </PageNotes>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Organization</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
            >
              <option value="">Select organization</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full name</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Admin full name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@org.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone (optional)</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+256..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {rolesForOrg.map((r) => (
                <option key={r.role_key} value={r.role_key}>
                  {r.display_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm password</label>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              autoComplete="new-password"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={addBusinessAdmin}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-800 text-white rounded-lg hover:bg-brand-900 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {saving ? "Saving..." : "Create staff account"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-700" />
          <h2 className="font-semibold text-slate-900">Staff accounts in selected organization</h2>
        </div>
        {staffForOrg.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No staff accounts found for this organization.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Phone</th>
                <th className="text-left p-3">Role</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3 w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {staffForOrg.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="p-3">{a.full_name}</td>
                  <td className="p-3">{a.email}</td>
                  <td className="p-3">{a.phone || "—"}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">
                      <Shield className="w-3 h-3" />
                      {a.role}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center text-xs px-2 py-0.5 rounded ${
                        a.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {a.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openEditAdmin(a)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingAdmin && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Edit staff account</h2>
            <p className="text-sm text-slate-500 mb-4">{editingAdmin.email}</p>

            <label className="block text-sm font-medium text-slate-700 mb-1">Organization</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editOrgId}
              onChange={(e) => setEditOrgId(e.target.value)}
            >
              <option value="">Select organization</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>

            <label className="block text-sm font-medium text-slate-700 mb-1">Full name</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editFullName}
              onChange={(e) => setEditFullName(e.target.value)}
              placeholder="Staff full name"
            />

            <label className="block text-sm font-medium text-slate-700 mb-1">Phone (optional)</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="+256..."
            />

            <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
            <select
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
            >
              {(roleTypes
                .filter((item) => item.organization_id === editOrgId)
                .map(({ role_key, display_name }) => ({ role_key, display_name }))
                .concat(
                  DEFAULT_ROLES.filter(
                    (fallback) =>
                      !roleTypes.some(
                        (item) => item.organization_id === editOrgId && item.role_key === fallback.role_key
                      )
                  )
                )
              ).map((r) => (
                <option key={r.role_key} value={r.role_key}>
                  {r.display_name}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-5">
              <input
                type="checkbox"
                checked={editIsActive}
                onChange={(e) => setEditIsActive(e.target.checked)}
              />
              Active
            </label>

            <label className="block text-sm font-medium text-slate-700 mb-1">Set password (optional)</label>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
            />
            <label className="block text-sm font-medium text-slate-700 mb-1">Confirm password</label>
            <input
              type="password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
              value={editConfirmPassword}
              onChange={(e) => setEditConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setEditingAdmin(null)}
                className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditedAdmin}
                disabled={saving}
                className="px-4 py-2 bg-brand-800 text-white rounded-lg disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
