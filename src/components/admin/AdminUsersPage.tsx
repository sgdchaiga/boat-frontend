import { useCallback, useEffect, useState } from "react";
import { UsersRound, Plus, Mail, Phone, Edit2, Shield, Trash2, Tag } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../lib/database.types";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";

type Staff = Database["public"]["Tables"]["staff"]["Row"];
type OrgRoleType = Database["public"]["Tables"]["organization_role_types"]["Row"];

function normalizeRoleKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

/** Options for role dropdowns: org role types plus current key if missing (legacy row). */
function roleSelectOptions(roleTypes: OrgRoleType[], memberRole: string): { role_key: string; display_name: string }[] {
  const base = roleTypes.map((rt) => ({ role_key: rt.role_key, display_name: rt.display_name }));
  if (memberRole && !base.some((o) => o.role_key === memberRole)) {
    base.push({ role_key: memberRole, display_name: `${memberRole} (legacy)` });
  }
  return base;
}

export function AdminUsersPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [staff, setStaff] = useState<Staff[]>([]);
  const [roleTypes, setRoleTypes] = useState<OrgRoleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showRoleTypeModal, setShowRoleTypeModal] = useState(false);
  const [editingRoleType, setEditingRoleType] = useState<OrgRoleType | null>(null);
  const [newRoleKeyInput, setNewRoleKeyInput] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editSortOrder, setEditSortOrder] = useState("0");

  const loadRoleTypes = useCallback(async () => {
    let q = supabase.from("organization_role_types").select("*").order("sort_order", { ascending: true });
    q = filterByOrganizationId(q, orgId, superAdmin);
    const { data, error } = await q;
    if (error) {
      console.error(error);
      return [];
    }
    return (data || []) as OrgRoleType[];
  }, [orgId, superAdmin]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    let staffQ = supabase.from("staff").select("*").order("created_at", { ascending: false });
    staffQ = filterByOrganizationId(staffQ, orgId, superAdmin);
    const [types, staffRes] = await Promise.all([loadRoleTypes(), staffQ]);
    setRoleTypes(types);
    const { data: staffData, error } = staffRes;
    if (error) console.error(error);
    setStaff((staffData || []) as Staff[]);
    setLoading(false);
  }, [loadRoleTypes, orgId, superAdmin]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const roleLabel = (key: string) => roleTypes.find((r) => r.role_key === key)?.display_name ?? key;

  const openCreateStaff = () => {
    setEditingStaff(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setRole(roleTypes[0]?.role_key ?? "receptionist");
    setIsActive(true);
    setPassword("");
    setConfirmPassword("");
    setShowStaffModal(true);
  };

  const openEditStaff = (member: Staff) => {
    setEditingStaff(member);
    setFullName(member.full_name);
    setEmail(member.email);
    setPhone(member.phone || "");
    setRole(member.role);
    setIsActive(member.is_active);
    setShowStaffModal(true);
  };

  const saveStaff = async () => {
    if (!fullName || !email) {
      alert("Enter name and email");
      return;
    }
    const validKeys = new Set(roleTypes.map((r) => r.role_key));
    if (!validKeys.has(role)) {
      alert("Choose a role from your organization's role types.");
      return;
    }
    if (editingStaff) {
      const { error } = await supabase
        .from("staff")
        .update({
          full_name: fullName,
          phone: phone || null,
          role,
          is_active: isActive,
        })
        .eq("id", editingStaff.id);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        alert("Passwords do not match.");
        return;
      }

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
        alert(signUpErr.message);
        return;
      }
      const authUserId = signUpData.user?.id;
      if (!authUserId) {
        alert("Failed to create login account for this user.");
        return;
      }

      const { error } = await supabase.from("staff").insert({
        id: authUserId,
        full_name: fullName,
        email,
        phone: phone || null,
        role,
        is_active: isActive,
        organization_id: orgId ?? null,
      });
      if (error) {
        alert(error.message);
        return;
      }
    }
    setShowStaffModal(false);
    void fetchAll();
  };

  const updateStaffRole = async (member: Staff, newRole: string) => {
    if (newRole === member.role) return;
    const validKeys = new Set(roleTypes.map((r) => r.role_key));
    if (!validKeys.has(newRole)) {
      alert("Choose a role from your organization's role types.");
      return;
    }
    if (member.role === "admin" && newRole !== "admin") {
      const adminCount = staff.filter((s) => s.role === "admin").length;
      if (adminCount <= 1) {
        alert("Cannot change the last administrator to another role.");
        return;
      }
    }
    setUpdatingRoleId(member.id);
    try {
      const { error } = await supabase.from("staff").update({ role: newRole }).eq("id", member.id);
      if (error) {
        alert(error.message);
        return;
      }
      await fetchAll();
    } finally {
      setUpdatingRoleId(null);
    }
  };

  const openAddRoleType = () => {
    if (!orgId) {
      alert("Organization context is required to manage role types.");
      return;
    }
    setEditingRoleType(null);
    setNewRoleKeyInput("");
    setNewDisplayName("");
    setShowRoleTypeModal(true);
  };

  const openEditRoleType = (rt: OrgRoleType) => {
    setEditingRoleType(rt);
    setEditDisplayName(rt.display_name);
    setEditSortOrder(String(rt.sort_order));
    setShowRoleTypeModal(true);
  };

  const saveRoleType = async () => {
    if (editingRoleType) {
      const so = Math.max(0, parseInt(editSortOrder, 10) || 0);
      const { error } = await supabase
        .from("organization_role_types")
        .update({ display_name: editDisplayName.trim(), sort_order: so })
        .eq("id", editingRoleType.id);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      const key = normalizeRoleKey(newRoleKeyInput);
      if (!key) {
        alert("Enter a role key (letters, numbers, underscores).");
        return;
      }
      if (!newDisplayName.trim()) {
        alert("Enter a display name.");
        return;
      }
      if (!orgId && !superAdmin) {
        alert("No organization context.");
        return;
      }
      const { error } = await supabase.from("organization_role_types").insert({
        organization_id: orgId!,
        role_key: key,
        display_name: newDisplayName.trim(),
        sort_order: roleTypes.length,
      });
      if (error) {
        alert(error.message);
        return;
      }
    }
    setShowRoleTypeModal(false);
    const next = await loadRoleTypes();
    setRoleTypes(next);
  };

  const deleteRoleType = async (rt: OrgRoleType) => {
    if (rt.role_key === "admin") {
      alert("The admin role cannot be removed.");
      return;
    }
    let q = supabase.from("staff").select("id", { count: "exact", head: true }).eq("role", rt.role_key);
    q = filterByOrganizationId(q, orgId, superAdmin);
    const { count, error: cErr } = await q;
    if (cErr) {
      alert(cErr.message);
      return;
    }
    if ((count ?? 0) > 0) {
      alert("Reassign or remove staff using this role before deleting the role type.");
      return;
    }
    if (!confirm(`Delete role type “${rt.display_name}” (${rt.role_key})?`)) return;
    const { error } = await supabase.from("organization_role_types").delete().eq("id", rt.id);
    if (error) {
      alert(error.message);
      return;
    }
    const next = await loadRoleTypes();
    setRoleTypes(next);
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading users…</div>;
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-900">Role types</h2>
          </div>
          <button
            type="button"
            onClick={openAddRoleType}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 text-sm"
          >
            <Plus className="w-4 h-4" />
            Add role type
          </button>
        </div>
        <p className="text-sm text-slate-600">
          Define role keys for your organization, then assign them to staff below. Keys are fixed (lowercase, underscores);
          you can change display names and order anytime.
        </p>
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Key</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Display name</th>
                <th className="text-left px-4 py-2 font-medium text-slate-700">Order</th>
                <th className="text-right px-4 py-2 font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roleTypes.map((rt) => (
                <tr key={rt.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-mono text-slate-800">{rt.role_key}</td>
                  <td className="px-4 py-2 text-slate-800">{rt.display_name}</td>
                  <td className="px-4 py-2 text-slate-600">{rt.sort_order}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openEditRoleType(rt)}
                      className="p-1.5 text-slate-500 hover:text-slate-800 inline-flex"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRoleType(rt)}
                      className="p-1.5 text-slate-500 hover:text-red-700 inline-flex disabled:opacity-30"
                      title="Delete"
                      disabled={rt.role_key === "admin"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {roleTypes.length === 0 && (
            <p className="px-4 py-6 text-slate-500 text-sm">No role types found. Run database migrations or add a role type.</p>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Staff</h2>
            <p className="text-sm text-slate-600 mt-1">
              Change a user&apos;s <strong>role type</strong> from the dropdown on their card or in Edit. Requires administrator or manager access.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateStaff}
            className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {staff.map((member) => (
            <div
              key={member.id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex justify-between items-start"
            >
              <div className="flex items-start gap-3">
                <div className="bg-slate-100 p-3 rounded-lg shrink-0">
                  <UsersRound className="w-6 h-6 text-slate-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-900">{member.full_name}</h3>
                  <div className="mt-2 space-y-1">
                    <label className="text-xs font-medium text-slate-600">Role type</label>
                    <select
                      value={member.role}
                      disabled={roleTypes.length === 0 || updatingRoleId === member.id}
                      onChange={(e) => void updateStaffRole(member, e.target.value)}
                      className="w-full max-w-[220px] text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white disabled:opacity-60"
                    >
                      {roleSelectOptions(roleTypes, member.role).map((o) => (
                        <option key={o.role_key} value={o.role_key}>
                          {o.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="text-sm text-slate-600 flex items-center gap-1 mt-1">
                    <Mail className="w-3.5 h-3.5" />
                    {member.email}
                  </p>
                  {member.phone && (
                    <p className="text-sm text-slate-600 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3.5 h-3.5" />
                      {member.phone}
                    </p>
                  )}
                  <p
                    className={`text-xs mt-2 ${
                      member.is_active ? "text-green-600" : "text-slate-400"
                    }`}
                  >
                    {member.is_active ? "Active" : "Inactive"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openEditStaff(member)}
                className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                title="Edit"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {showStaffModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <div className="flex items-center gap-2 mb-6">
              <Shield className="w-5 h-5 text-slate-600" />
              <h3 className="text-lg font-semibold text-slate-900">
                {editingStaff ? "Edit User" : "Add User"}
              </h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                  placeholder="Full name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 w-full disabled:bg-slate-50"
                  placeholder="Email"
                  disabled={!!editingStaff}
                />
                {editingStaff && <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                  placeholder="Phone"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role type</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                >
                  {roleSelectOptions(roleTypes, editingStaff?.role ?? role).map((o) => (
                    <option key={o.role_key} value={o.role_key}>
                      {o.display_name} ({o.role_key})
                    </option>
                  ))}
                </select>
              </div>
              {!editingStaff && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                      placeholder="Minimum 6 characters"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confirm password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                    />
                  </div>
                </>
              )}
              {editingStaff && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <label htmlFor="isActive" className="text-sm text-slate-700">
                    Active
                  </label>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowStaffModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveStaff()}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg hover:bg-brand-800"
              >
                {editingStaff ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showRoleTypeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">
              {editingRoleType ? "Edit role type" : "Add role type"}
            </h3>
            {editingRoleType ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-600 font-mono">{editingRoleType.role_key}</p>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Display name</label>
                  <input
                    value={editDisplayName}
                    onChange={(e) => setEditDisplayName(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Sort order</label>
                  <input
                    type="number"
                    min={0}
                    value={editSortOrder}
                    onChange={(e) => setEditSortOrder(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role key</label>
                  <input
                    value={newRoleKeyInput}
                    onChange={(e) => setNewRoleKeyInput(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full font-mono"
                    placeholder="e.g. head_chef"
                  />
                  <p className="text-xs text-slate-500 mt-1">Lowercase letters, numbers, underscores. Saved as: {normalizeRoleKey(newRoleKeyInput) || "—"}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Display name</label>
                  <input
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-2 w-full"
                    placeholder="e.g. Head chef"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={() => setShowRoleTypeModal(false)}
                className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveRoleType()}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg hover:bg-brand-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
