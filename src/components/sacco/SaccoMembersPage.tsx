import { useCallback, useEffect, useState } from "react";
import { UserPlus, Users, Pencil, CheckCircle2, XCircle, Loader2, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { legacyMemberNumberFromIndex, suggestNextMemberNumber } from "@/lib/saccoAccountNumberSettings";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { PageNotes } from "@/components/common/PageNotes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type SaccoMemberRow = {
  id: string;
  organization_id: string;
  member_number: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  national_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Profile / KYC — migration `20260426120010_sacco_members_profile_fields.sql` */
  gender?: string | null;
  date_of_birth?: string | null;
  marital_status?: string | null;
  address?: string | null;
  occupation?: string | null;
  next_of_kin?: string | null;
  nok_phone?: string | null;
};

interface SaccoMembersPageProps {
  readOnly?: boolean;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}

export function SaccoMembersPage({ readOnly = false, onNavigate }: SaccoMembersPageProps) {
  const { user } = useAuth();
  const { refreshSaccoWorkspace } = useAppContext();
  const orgId = user?.organization_id ?? null;

  const [rows, setRows] = useState<SaccoMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SaccoMemberRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [memberNumber, setMemberNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [notes, setNotes] = useState("");
  const [gender, setGender] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [address, setAddress] = useState("");
  const [occupation, setOccupation] = useState("");
  const [nextOfKin, setNextOfKin] = useState("");
  const [nokPhone, setNokPhone] = useState("");

  const load = useCallback(async () => {
    if (!orgId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: e } = await sb
      .from("sacco_members")
      .select("*")
      .eq("organization_id", orgId)
      .order("member_number");
    if (e) {
      setError(e.message);
      setRows([]);
    } else {
      setRows((data || []) as SaccoMemberRow[]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = async () => {
    setEditing(null);
    setFullName("");
    setEmail("");
    setPhone("");
    setNationalId("");
    setNotes("");
    setGender("");
    setDateOfBirth("");
    setMaritalStatus("");
    setAddress("");
    setOccupation("");
    setNextOfKin("");
    setNokPhone("");
    if (!orgId) {
      setMemberNumber(legacyMemberNumberFromIndex(1));
    } else {
      try {
        setMemberNumber(await suggestNextMemberNumber(orgId));
      } catch {
        try {
          const { count } = await sb
            .from("sacco_members")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", orgId);
          setMemberNumber(legacyMemberNumberFromIndex((count ?? 0) + 1));
        } catch {
          setMemberNumber("M-00001");
        }
      }
    }
    setShowModal(true);
  };

  const openEdit = (r: SaccoMemberRow) => {
    setEditing(r);
    setMemberNumber(r.member_number);
    setFullName(r.full_name);
    setEmail(r.email || "");
    setPhone(r.phone || "");
    setNationalId(r.national_id || "");
    setNotes(r.notes || "");
    setGender(r.gender ?? "");
    setDateOfBirth(r.date_of_birth ? String(r.date_of_birth).slice(0, 10) : "");
    setMaritalStatus(r.marital_status ?? "");
    setAddress(r.address ?? "");
    setOccupation(r.occupation ?? "");
    setNextOfKin(r.next_of_kin ?? "");
    setNokPhone(r.nok_phone ?? "");
    setShowModal(true);
  };

  const save = async () => {
    if (!orgId || readOnly) return;
    const name = fullName.trim();
    if (!name) {
      alert("Full name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        full_name: name,
        email: email.trim() || null,
        phone: phone.trim() || null,
        national_id: nationalId.trim() || null,
        notes: notes.trim() || null,
        gender: gender.trim() || null,
        date_of_birth: dateOfBirth.trim() || null,
        marital_status: maritalStatus.trim() || null,
        address: address.trim() || null,
        occupation: occupation.trim() || null,
        next_of_kin: nextOfKin.trim() || null,
        nok_phone: nokPhone.trim() || null,
      };
      if (editing) {
        const { error: e } = await sb
          .from("sacco_members")
          .update({ ...payload, member_number: editing.member_number })
          .eq("id", editing.id);
        if (e) throw e;
      } else {
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          const member_number = await suggestNextMemberNumber(orgId);
          const { error: e } = await sb.from("sacco_members").insert({ ...payload, member_number, organization_id: orgId });
          if (!e) {
            lastErr = null;
            break;
          }
          lastErr = e;
          const code = (e as { code?: string }).code;
          const msg = String((e as Error)?.message ?? "").toLowerCase();
          const isDup = code === "23505" || msg.includes("unique") || msg.includes("duplicate");
          if (!isDup) throw e;
        }
        if (lastErr) throw lastErr;
      }
      setShowModal(false);
      await load();
      await refreshSaccoWorkspace();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save member.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (r: SaccoMemberRow) => {
    if (readOnly) return;
    const { error: e } = await sb.from("sacco_members").update({ is_active: !r.is_active }).eq("id", r.id);
    if (e) {
      alert(e.message);
      return;
    }
    await load();
    void refreshSaccoWorkspace();
  };

  const remove = async (r: SaccoMemberRow) => {
    if (readOnly) return;
    if (!confirm(`Remove member “${r.full_name}” (${r.member_number}) from the register?`)) return;
    const { error: e } = await sb.from("sacco_members").delete().eq("id", r.id);
    if (e) {
      alert(e.message);
      return;
    }
    await load();
    void refreshSaccoWorkspace();
  };

  if (!orgId) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto">
        <p className="text-slate-600">Link your staff account to an organization to manage members.</p>
      </div>
    );
  }

  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Members</h1>
            <PageNotes ariaLabel="Members help">
              <p>
                Capture identity, contact, and next of kin here when registering a member. Savings account opening copies this profile into each new
                account snapshot. Member numbers are assigned automatically in sequence; savings product accounts use the branch / type / serial pattern
                under Savings settings.
              </p>
            </PageNotes>
          </div>
          {!loading && !error && (
            <p className="text-xs text-slate-500">
              <span className="font-medium text-emerald-700">{activeCount}</span> active
              {rows.length !== activeCount ? (
                <>
                  {" "}
                  · <span className="text-slate-600">{rows.length - activeCount}</span> inactive
                </>
              ) : null}{" "}
              · {rows.length} total
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void openNew()}
          disabled={readOnly}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <UserPlus className="w-4 h-4" />
          Add member
        </button>
      </header>

      {readOnly && <ReadOnlyNotice />}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          {error.includes("sacco_members") || error.includes("schema cache") ? (
            <span className="block mt-2 text-red-700/90 text-xs">
              Run the migration <code className="rounded bg-red-100 px-1 py-0.5 font-mono text-[11px]">20260425110000_sacco_members.sql</code> on your Supabase
              project, then reload.
            </span>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-8 text-slate-600 text-sm shadow-sm justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
          Loading members…
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-slate-50 to-emerald-50/40 border-b border-slate-200">
                  <th className="text-left p-3.5 font-semibold text-slate-700 text-xs uppercase tracking-wide">No.</th>
                  <th className="text-left p-3.5 font-semibold text-slate-700 text-xs uppercase tracking-wide">Name</th>
                  <th className="text-left p-3.5 font-semibold text-slate-700 text-xs uppercase tracking-wide">Phone</th>
                  <th className="text-left p-3.5 font-semibold text-slate-700 text-xs uppercase tracking-wide">Email</th>
                  <th className="text-center p-3.5 font-semibold text-slate-700 text-xs uppercase tracking-wide w-28">Status</th>
                  <th className="text-right p-3.5 font-semibold text-slate-700 text-xs uppercase tracking-wide w-44">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-emerald-50/35 transition-colors">
                    <td className="p-3.5 font-mono text-sm font-medium text-emerald-800 tabular-nums">{r.member_number}</td>
                    <td className="p-3.5 font-medium text-slate-900">{r.full_name}</td>
                    <td className="p-3.5 text-slate-600">{r.phone ?? "—"}</td>
                    <td className="p-3.5 text-slate-600 max-w-[200px] truncate" title={r.email ?? undefined}>
                      {r.email ?? "—"}
                    </td>
                    <td className="p-3.5 text-center">
                      {r.is_active ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                          <XCircle className="w-3.5 h-3.5" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {onNavigate ? (
                          <button
                            type="button"
                            onClick={() => onNavigate(SACCOPRO_PAGE.savingsAccountOpen, { memberId: r.id })}
                            disabled={readOnly}
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                            title="Open savings account for this member"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            Savings
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={readOnly}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleActive(r)}
                          disabled={readOnly}
                          className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          {r.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(r)}
                          disabled={readOnly}
                          className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && !error && (
            <div className="p-12 text-center border-t border-slate-100 bg-slate-50/50">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <Users className="w-7 h-7" />
              </div>
              <p className="text-slate-700 font-medium">No members yet</p>
              <p className="text-slate-500 text-sm mt-1">Add your first member to build the register.</p>
            </div>
          )}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-lg font-semibold text-slate-900">{editing ? "Edit member" : "Add member"}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Identity, contact, and next of kin are stored on the member and copied when opening savings accounts.</p>
            </div>
            <div className="space-y-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Core</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-1">
                  <label className="text-xs font-medium text-slate-700 block mb-1">Member number</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-slate-50 text-slate-800 px-3 py-2 font-mono text-sm outline-none"
                    value={memberNumber}
                    readOnly
                    title={
                      editing
                        ? "Member number is fixed after registration."
                        : "Assigned automatically when you save (next in sequence). Preview may update if others register first."
                    }
                    aria-readonly="true"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    {editing ? "Cannot be changed." : "Auto-generated on save; preview shows the next likely number."}
                  </p>
                </div>
                <div className="sm:col-span-1">
                  <label className="text-xs font-medium text-slate-700 block mb-1">National ID</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-slate-700 block mb-1">Full name</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Required"
                  />
                </div>
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-1">Profile</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Gender</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    placeholder="Male / Female / …"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Date of birth</label>
                  <input
                    type="date"
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-slate-700 block mb-1">Marital status</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    value={maritalStatus}
                    onChange={(e) => setMaritalStatus(e.target.value)}
                    placeholder="Single, Married, …"
                  />
                </div>
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-1">Contact &amp; occupation</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Phone</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Email</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-slate-700 block mb-1">Address</label>
                  <textarea
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm min-h-[64px] outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Residential / mailing address"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-medium text-slate-700 block mb-1">Occupation</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                  />
                </div>
              </div>

              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide pt-1">Next of kin</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Name</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    value={nextOfKin}
                    onChange={(e) => setNextOfKin(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 block mb-1">Phone</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                    value={nokPhone}
                    onChange={(e) => setNokPhone(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-700 block mb-1">Notes</label>
                <textarea
                  className="w-full border border-slate-200 rounded-lg bg-white text-slate-900 px-3 py-2 text-sm min-h-[72px] outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || readOnly}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
