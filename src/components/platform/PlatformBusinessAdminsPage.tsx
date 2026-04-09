import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Shield, Users } from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
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

export function PlatformBusinessAdminsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editingAdmin, setEditingAdmin] = useState<StaffRow | null>(null);
  const [editOrgId, setEditOrgId] = useState("");
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [editConfirmPassword, setEditConfirmPassword] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, staffRes] = await Promise.all([
        supabase.from("organizations").select("id,name").order("name"),
        supabase
          .from("staff")
          .select("id,full_name,email,phone,role,is_active,organization_id")
          .eq("role", "admin")
          .order("created_at", { ascending: false }),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (staffRes.error) throw staffRes.error;

      const orgData = (orgRes.data || []) as OrgRow[];
      setOrgs(orgData);
      setStaff((staffRes.data || []) as StaffRow[]);
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

  const adminsForOrg = useMemo(
    () => staff.filter((s) => s.organization_id === selectedOrgId),
    [staff, selectedOrgId]
  );

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
            role: "admin",
            phone: phone.trim() || "",
          },
        },
      });
      if (signUpErr) throw signUpErr;
      const authUserId = signUpData.user?.id;
      if (!authUserId) throw new Error("Failed to create login account for this admin.");

      const payload = {
        id: authUserId,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role: "admin",
        is_active: true,
        organization_id: selectedOrgId,
      };
      const { error: insErr } = await (supabase as any).from("staff").insert(payload);
      if (insErr) throw insErr;

      setFullName("");
      setEmail("");
      setPhone("");
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
              role: "admin",
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

      const { error: updErr } = await supabase
        .from("staff")
        .update({
          id: targetStaffId,
          organization_id: editOrgId,
          full_name: editFullName.trim(),
          phone: editPhone.trim() || null,
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
        <h1 className="text-2xl font-bold text-slate-900">Business Admins</h1>
        <PageNotes ariaLabel="Business admins help">
          <p>Create and view organization-level admin users.</p>
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
              {saving ? "Saving..." : "Add business admin"}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-700" />
          <h2 className="font-semibold text-slate-900">Admins in selected organization</h2>
        </div>
        {adminsForOrg.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No admins found for this organization.</p>
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
              {adminsForOrg.map((a) => (
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
            <h2 className="text-lg font-bold text-slate-900 mb-1">Edit business admin</h2>
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
              placeholder="Admin full name"
            />

            <label className="block text-sm font-medium text-slate-700 mb-1">Phone (optional)</label>
            <input
              className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder="+256..."
            />

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
