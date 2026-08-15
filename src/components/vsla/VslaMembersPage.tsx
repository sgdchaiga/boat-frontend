import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";
import { createClient } from "@supabase/supabase-js";

type MemberStatus = "active" | "exited" | "suspended";
type MemberRole = "member" | "chairperson" | "treasurer" | "secretary";

type GroupRow = {
  id: string;
  name: string;
};

type MemberRow = {
  id: string;
  full_name: string;
  national_id: string | null;
  phone: string | null;
  photo_url: string | null;
  status: MemberStatus;
  role: MemberRole;
  is_key_holder: boolean;
  group_id: string | null;
  household_id: string | null;
  member_number: string | null;
  guarantor_member_id: string | null;
};
type MemberAppAccess = { auth_user_id: string; vsla_member_id: string; login_phone: string | null; status: "invited" | "active" | "suspended" | "revoked" };

export function VslaMembersPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [appAccess, setAppAccess] = useState<Record<string, MemberAppAccess>>({});
  const [appSaving, setAppSaving] = useState<string | null>(null);

  const [groupName, setGroupName] = useState("");
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [status, setStatus] = useState<MemberStatus>("active");
  const [role, setRole] = useState<MemberRole>("member");
  const [isKeyHolder, setIsKeyHolder] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [memberNumber, setMemberNumber] = useState("");
  const [guarantorMemberId, setGuarantorMemberId] = useState("");
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editStatus, setEditStatus] = useState<MemberStatus>("active");
  const [editRole, setEditRole] = useState<MemberRole>("member");
  const [editIsKeyHolder, setEditIsKeyHolder] = useState(false);
  const [editGroupId, setEditGroupId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const gq = filterByOrganizationId(
      supabase.from("vsla_groups").select("id,name").order("name"),
      orgId,
      superAdmin,
    );
    const mq = filterByOrganizationId(
      supabase
        .from("vsla_members")
        .select(
          "id,full_name,national_id,phone,photo_url,status,role,is_key_holder,group_id,household_id,member_number,guarantor_member_id",
        )
        .order("full_name"),
      orgId,
      superAdmin,
    );
    const [
      { data: groupsData, error: gErr },
      { data: membersData, error: mErr },
    ] = await Promise.all([gq, mq]);
    if (gErr || mErr) {
      setError(
        gErr?.message ?? mErr?.message ?? "Failed to load VSLA members.",
      );
      setGroups([]);
      setMembers([]);
    } else {
      setGroups((groupsData ?? []) as GroupRow[]);
      setMembers((membersData ?? []) as MemberRow[]);
      if (orgId) {
        const { data: accessData } = await supabase.from("vsla_member_app_users").select("auth_user_id,vsla_member_id,login_phone,status").eq("organization_id", orgId);
        setAppAccess(Object.fromEntries(((accessData || []) as MemberAppAccess[]).map((row) => [row.vsla_member_id, row])));
      }
    }
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupLabel = useMemo(() => {
    const map = new Map(groups.map((g) => [g.id, g.name]));
    return map;
  }, [groups]);

  const addGroup = async () => {
    if (readOnly) return;
    if (!groupName.trim()) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("vsla_groups").insert({
      organization_id: orgId,
      name: groupName.trim(),
    });
    if (e) setError(e.message);
    setGroupName("");
    setSaving(false);
    await load();
  };

  const saveMember = async () => {
    if (readOnly) return;
    if (!fullName.trim()) {
      setError("Member name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("vsla_members").insert({
      organization_id: orgId,
      full_name: fullName.trim(),
      national_id: nationalId.trim() || null,
      phone: phone.trim() || null,
      photo_url: photoUrl.trim() || null,
      status,
      role,
      is_key_holder: isKeyHolder,
      group_id: groupId || null,
      household_id: null,
      member_number: memberNumber.trim() || null,
      guarantor_member_id: guarantorMemberId || null,
    });
    if (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    setFullName("");
    setNationalId("");
    setPhone("");
    setPhotoUrl("");
    setStatus("active");
    setRole("member");
    setIsKeyHolder(false);
    setGroupId("");
    setMemberNumber("");
    setGuarantorMemberId("");
    setSaving(false);
    await load();
  };

  const startEdit = (m: MemberRow) => {
    setEditingMemberId(m.id);
    setEditFullName(m.full_name || "");
    setEditPhone(m.phone || "");
    setEditStatus(m.status);
    setEditRole(m.role);
    setEditIsKeyHolder(!!m.is_key_holder);
    setEditGroupId(m.group_id || "");
  };

  const cancelEdit = () => {
    setEditingMemberId(null);
  };

  const saveEdit = async () => {
    if (readOnly || !editingMemberId) return;
    if (!editFullName.trim()) {
      setError("Member name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("vsla_members")
      .update({
        full_name: editFullName.trim(),
        phone: editPhone.trim() || null,
        status: editStatus,
        role: editRole,
        is_key_holder: editIsKeyHolder,
        group_id: editGroupId || null,
      })
      .eq("id", editingMemberId);
    if (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    setEditingMemberId(null);
    await load();
  };

  const enableMemberApp = async (member: MemberRow) => {
    if (!orgId || readOnly) return;
    const loginPhone = window.prompt("Member telephone number", member.phone || "")?.trim();
    if (!loginPhone || loginPhone.replace(/\D/g, "").length < 9) return window.alert("Enter a valid telephone number.");
    const pin = window.prompt("Create a 6-digit member PIN", "")?.trim();
    if (!/^\d{6}$/.test(pin || "")) return window.alert("The member PIN must be exactly 6 digits.");
    setAppSaving(member.id);
    try {
      const loginEmail = `vsla.${member.id}@member.boat.invalid`;
      const signupClient = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error: signupError } = await signupClient.auth.signUp({ email: loginEmail, password: `${crypto.randomUUID()}Aa7!`, options: { data: { full_name: member.full_name, phone: member.phone || "", account_type: "vsla_member" } } });
      if (signupError) throw signupError;
      if (!data.user?.id) throw new Error("The authentication account was not created.");
      const { error: linkError } = await supabase.from("vsla_member_app_users").insert({ auth_user_id: data.user.id, organization_id: orgId, vsla_member_id: member.id, login_email: loginEmail, login_phone: loginPhone.replace(/\D/g, ""), status: "invited", invited_by: user?.id || null, must_change_password: false });
      if (linkError) throw linkError;
      const { error: pinError } = await supabase.rpc("set_vsla_member_app_pin", { p_member_id: member.id, p_phone: loginPhone, p_pin: pin });
      if (pinError) throw pinError;
      window.alert(`Member app enabled. Share ${window.location.origin}${window.location.pathname}?memberApp=1 and give the PIN separately.`);
      await load();
    } catch (cause) { window.alert(cause instanceof Error ? cause.message : "Could not enable member app."); }
    finally { setAppSaving(null); }
  };

  const manageMemberApp = async (member: MemberRow, action: "reset" | "toggle" | "share") => {
    const access = appAccess[member.id]; if (!access || readOnly) return;
    if (action === "share") {
      const text = `Your BOAT VSLA member app is ready: ${window.location.origin}${window.location.pathname}?memberApp=1\nTelephone: ${access.login_phone || member.phone || ""}`;
      if (navigator.share) await navigator.share({ title: "BOAT VSLA Member App", text }); else { await navigator.clipboard.writeText(text); window.alert("Member app link copied."); }
      return;
    }
    if (action === "reset") {
      const pin = window.prompt("Enter a new 6-digit member PIN", "")?.trim(); if (!/^\d{6}$/.test(pin || "")) return;
      const { error: pinError } = await supabase.rpc("set_vsla_member_app_pin", { p_member_id: member.id, p_phone: access.login_phone || member.phone, p_pin: pin });
      if (pinError) window.alert(pinError.message); else window.alert("PIN reset successfully."); return;
    }
    setAppSaving(member.id);
    const status = access.status === "suspended" ? "active" : "suspended";
    const { error: updateError } = await supabase.from("vsla_member_app_users").update({ status }).eq("auth_user_id", access.auth_user_id);
    setAppSaving(null); if (updateError) window.alert(updateError.message); else await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          VSLA Member Management
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Members, group assignment, roles, key holders, and optional
          household/guarantor linking.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="text-xs text-slate-600">
          New Group Name
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <div className="md:col-span-2 flex items-end">
          <button
            type="button"
            onClick={() => void addGroup()}
            disabled={readOnly || saving}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50"
          >
            Add Group
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Register Member
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600">
            Name
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            National ID
            <input
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Phone
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Photo URL
            <input
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Role
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="chairperson">Chairperson</option>
              <option value="treasurer">Treasurer</option>
              <option value="secretary">Secretary</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as MemberStatus)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="exited">Exited</option>
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Group
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Guarantor
            <select
              value={guarantorMemberId}
              onChange={(e) => setGuarantorMemberId(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatVslaMemberLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Member Number
            <input
              value={memberNumber}
              onChange={(e) => setMemberNumber(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. MBR-001"
            />
          </label>
          <label className="text-xs text-slate-600 flex items-end gap-2">
            <input
              type="checkbox"
              checked={isKeyHolder}
              onChange={(e) => setIsKeyHolder(e.target.checked)}
            />
            Key holder
          </label>
          <div className="md:col-span-2 flex items-end">
            <button
              type="button"
              onClick={() => void saveMember()}
              disabled={readOnly || saving}
              className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
            >
              Save Member
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Group</th>
              <th className="text-left p-3">Key Holder</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={7}>
                  Loading members...
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td className="p-4 text-slate-500" colSpan={7}>
                  No members yet.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="p-3 font-medium text-slate-900">
                    {editingMemberId === m.id ? (
                      <input
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs"
                      />
                    ) : (
                      formatVslaMemberLabel(m)
                    )}
                  </td>
                  <td className="p-3 text-slate-600">
                    {editingMemberId === m.id ? (
                      <input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs"
                      />
                    ) : (
                      m.phone || "-"
                    )}
                  </td>
                  <td className="p-3 text-slate-600 capitalize">
                    {editingMemberId === m.id ? (
                      <select
                        value={editRole}
                        onChange={(e) =>
                          setEditRole(e.target.value as MemberRole)
                        }
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs"
                      >
                        <option value="member">Member</option>
                        <option value="chairperson">Chairperson</option>
                        <option value="treasurer">Treasurer</option>
                        <option value="secretary">Secretary</option>
                      </select>
                    ) : (
                      m.role
                    )}
                  </td>
                  <td className="p-3 text-slate-600 capitalize">
                    {editingMemberId === m.id ? (
                      <select
                        value={editStatus}
                        onChange={(e) =>
                          setEditStatus(e.target.value as MemberStatus)
                        }
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs"
                      >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="exited">Exited</option>
                      </select>
                    ) : (
                      m.status
                    )}
                  </td>
                  <td className="p-3 text-slate-600">
                    {editingMemberId === m.id ? (
                      <select
                        value={editGroupId}
                        onChange={(e) => setEditGroupId(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-2 py-1 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    ) : m.group_id ? (
                      (groupLabel.get(m.group_id) ?? "Unknown")
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-3 text-slate-600">
                    {editingMemberId === m.id ? (
                      <label className="text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={editIsKeyHolder}
                          onChange={(e) => setEditIsKeyHolder(e.target.checked)}
                        />
                        Yes
                      </label>
                    ) : m.is_key_holder ? (
                      "Yes"
                    ) : (
                      "No"
                    )}
                  </td>
                  <td className="p-3 text-slate-600">
                    {editingMemberId === m.id ? (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={readOnly || saving}
                          className="text-xs text-indigo-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-xs text-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (<div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(m)}
                        disabled={readOnly || saving}
                        className="text-xs text-indigo-700 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      {!appAccess[m.id] ? <button type="button" onClick={() => void enableMemberApp(m)} disabled={readOnly || appSaving === m.id} className="text-xs font-semibold text-emerald-700 disabled:opacity-50">Enable app</button> : <><button type="button" onClick={() => void manageMemberApp(m, "share")} className="text-xs text-sky-700">Share</button><button type="button" onClick={() => void manageMemberApp(m, "reset")} className="text-xs text-amber-700">Reset PIN</button><button type="button" onClick={() => void manageMemberApp(m, "toggle")} disabled={appSaving === m.id} className="text-xs text-rose-700">{appAccess[m.id].status === "suspended" ? "Restore" : "Suspend"}</button></>}
                    </div>)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
