import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchOrganizationMembers, type OrganizationMemberRow } from "@/lib/orgMembership";
import { PageNotes } from "@/components/common/PageNotes";

interface OrgRow {
  id: string;
  name: string;
  business_type: string | null;
}

interface RoleTypeRow {
  role_key: string;
  display_name: string;
}

const FALLBACK_ROLES: RoleTypeRow[] = [
  { role_key: "super_admin", display_name: "Super Admin" },
  { role_key: "admin", display_name: "Administrator" },
  { role_key: "manager", display_name: "Manager" },
  { role_key: "accountant", display_name: "Accountant" },
  { role_key: "cashier", display_name: "Cashier" },
  { role_key: "receptionist", display_name: "Receptionist" },
];

export function PlatformLinkUserPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [members, setMembers] = useState<OrganizationMemberRow[]>([]);
  const [roleTypes, setRoleTypes] = useState<RoleTypeRow[]>(FALLBACK_ROLES);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("receptionist");

  const selectedOrg = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId]
  );

  const loadOrgs = useCallback(async () => {
    const { data, error: orgErr } = await supabase
      .from("organizations")
      .select("id, name, business_type")
      .order("name");
    if (orgErr) throw orgErr;
    const rows = (data || []) as OrgRow[];
    setOrgs(rows);
    setSelectedOrgId((prev) => prev || rows[0]?.id || "");
  }, []);

  const loadRoleTypes = useCallback(async (orgId: string) => {
    const { data, error: rtErr } = await supabase
      .from("organization_role_types")
      .select("role_key, display_name")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true });
    if (rtErr) {
      setRoleTypes(FALLBACK_ROLES);
      return;
    }
    const rows = (data || []) as RoleTypeRow[];
    const merged = [...rows];
    for (const fallback of FALLBACK_ROLES) {
      if (!merged.some((r) => r.role_key === fallback.role_key)) merged.push(fallback);
    }
    setRoleTypes(merged);
    setRole((prev) => (merged.some((r) => r.role_key === prev) ? prev : merged[0]?.role_key ?? "super_admin"));
  }, []);

  const loadMembers = useCallback(async (orgId: string) => {
    if (!orgId) {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    try {
      setMembers(await fetchOrganizationMembers({ organizationId: orgId, limit: 50 }));
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: string }).message)
          : "Failed to load members.";
      setError(msg);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadOrgs();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load organizations.");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadOrgs]);

  useEffect(() => {
    if (!selectedOrgId) return;
    void loadRoleTypes(selectedOrgId);
    void loadMembers(selectedOrgId);
  }, [selectedOrgId, loadRoleTypes, loadMembers]);

  const linkUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!selectedOrgId) {
      setError("Select an organization.");
      return;
    }
    if (!email.trim() || !fullName.trim()) {
      setError("Email and full name are required.");
      return;
    }
    setSaving(true);
    try {
      const phoneValue = phone.trim();
      const rpcArgs = {
        p_email: email.trim(),
        p_organization_id: selectedOrgId,
        p_role: role,
        p_full_name: fullName.trim(),
        p_phone: phoneValue || null,
      };
      let rpcErr = (
        await supabase.rpc("platform_link_organization_member", rpcArgs)
      ).error;
      if (rpcErr?.code === "PGRST202" || rpcErr?.message?.includes("does not exist")) {
        rpcErr = (await supabase.rpc("invite_organization_member", rpcArgs)).error;
      }
      if (rpcErr) throw rpcErr;
      setSuccess(`Linked ${email.trim()} to ${selectedOrg?.name ?? "the organization"}.`);
      setEmail("");
      setFullName("");
      setPhone("");
      await loadMembers(selectedOrgId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to link user.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-slate-600">Loading…</div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Link2 className="w-7 h-7 text-brand-700" />
        <h1 className="text-2xl font-bold text-slate-900">Link user to organization</h1>
        <PageNotes ariaLabel="Link user help">
          <p>
            Attach an existing BOAT login (email) to an organization. The user keeps one password and
            can switch organizations after sign-in. They must already have signed up or been created
            elsewhere — this does not set a new password.
          </p>
        </PageNotes>
      </div>

      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <form
        onSubmit={(ev) => void linkUser(ev)}
        className="bg-white rounded-xl border border-slate-200 p-4 mb-6 space-y-3"
      >
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          New link
        </h2>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Organization</label>
          <select
            value={selectedOrgId}
            onChange={(e) => setSelectedOrgId(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.business_type ? ` (${o.business_type})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Login email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Full name (in this org)</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Role in organization</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {roleTypes.map((rt) => (
                <option key={rt.role_key} value={rt.role_key}>
                  {rt.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-1">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-700 text-white text-sm font-medium px-4 py-2 hover:bg-brand-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Link user
          </button>
        </div>
      </form>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            Members in {selectedOrg?.name ?? "organization"}
          </h2>
          {membersLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : null}
        </div>
        {members.length === 0 && !membersLoading ? (
          <p className="px-4 py-6 text-sm text-slate-500">No members linked yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.user_id} className="text-slate-800">
                    <td className="px-4 py-2">{m.full_name}</td>
                    <td className="px-4 py-2 text-slate-600">{m.email}</td>
                    <td className="px-4 py-2">{m.role}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          m.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {m.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
