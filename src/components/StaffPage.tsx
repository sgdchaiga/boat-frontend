import { useEffect, useState } from "react";
import { UsersRound, Mail, Phone, KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import type { Database } from "../lib/database.types";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";

type Staff = Database["public"]["Tables"]["staff"]["Row"];

interface StaffPageProps {
  readOnly?: boolean;
}

export function StaffPage({ readOnly = false }: StaffPageProps = {}) {
  const { user } = useAuth();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [passwordModalStaff, setPasswordModalStaff] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    fetchStaff();
  }, [user?.organization_id, user?.isSuperAdmin]);

  /* --------------------- */
  /* FETCH STAFF */
  /* --------------------- */

  const fetchStaff = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let q = supabase.from("staff").select("*").order("created_at", { ascending: false });
      q = filterByOrganizationId(q, user?.organization_id ?? undefined, !!user?.isSuperAdmin);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data || []) as Staff[];
      if (rows.length > 0) {
        setStaff(rows);
        return;
      }

      if (user) {
        const fallback = {
          id: user.id,
          full_name: user.full_name || "Current User",
          email: user.email || "",
          phone: null,
          role: user.role || "staff",
          organization_id: user.organization_id || null,
          created_at: new Date().toISOString(),
        } as Staff;
        setStaff([fallback]);
      } else {
        setStaff([]);
      }
    } catch (error) {
      console.error(error);
      setLoadError(error instanceof Error ? error.message : "Failed to load staff records.");
      if (user) {
        const fallback = {
          id: user.id,
          full_name: user.full_name || "Current User",
          email: user.email || "",
          phone: null,
          role: user.role || "staff",
          organization_id: user.organization_id || null,
          created_at: new Date().toISOString(),
        } as Staff;
        setStaff([fallback]);
      } else {
        setStaff([]);
      }
    } finally {
      setLoading(false);
    }
  };

  /* --------------------- */
  /* CHANGE PASSWORD */
  /* --------------------- */

  const handleChangePassword = async () => {
    if (readOnly) return;
    if (!passwordModalStaff || passwordModalStaff.id !== user?.id) return;
    setPasswordError("");
    if (!newPassword || newPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setChanging(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setPasswordModalStaff(null);
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : "Failed to update password");
    } finally {
      setChanging(false);
    }
  };

  /* --------------------- */

  const getRoleColor = (role: string) => {
    switch (role) {
      case "admin": return "bg-red-100 text-red-800 border-red-200";
      case "manager": return "bg-blue-100 text-blue-800 border-blue-200";
      case "receptionist": return "bg-green-100 text-green-800 border-green-200";
      case "housekeeping": return "bg-amber-100 text-amber-800 border-amber-200";
      default: return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  if (loading) {
    return <div className="p-6">Loading staff...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      {readOnly && (
        <ReadOnlyNotice />
      )}

      {/* HEADER */}

      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">Staff Management</h1>
          <PageNotes ariaLabel="Staff help">
            <p>Manage hotel staff.</p>
          </PageNotes>
        </div>
      </div>

      {/* STAFF GRID */}
      {loadError ? (
        <p className="mb-4 text-sm text-amber-700">
          Could not read all staff records from database. Showing available local profile.
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {staff.map((member) => (

          <div key={member.id} className="bg-white border rounded-xl p-6">

            <div className="flex items-center gap-3 mb-3">

              <div className="bg-slate-100 p-3 rounded-lg">
                <UsersRound className="w-6 h-6"/>
              </div>

              <div>

                <h3 className="font-bold">
                  {member.full_name}
                </h3>

                <span className={`text-xs px-3 py-1 rounded-full border ${getRoleColor(member.role)}`}>
                  {member.role}
                </span>

              </div>

            </div>

            <p className="text-sm flex items-center gap-2">
              <Mail className="w-4 h-4"/> {member.email}
            </p>

            {member.phone && (
              <p className="text-sm flex items-center gap-2 mt-1">
                <Phone className="w-4 h-4"/> {member.phone}
              </p>
            )}

            <p className="text-xs text-slate-500 mt-3">
              Joined {new Date(member.created_at).toLocaleDateString()}
            </p>

            {user?.id === member.id && (
              <button
                type="button"
                onClick={() => setPasswordModalStaff(member)}
                disabled={readOnly}
                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <KeyRound className="w-4 h-4" />
                Change password
              </button>
            )}

          </div>

        ))}

      </div>
      {staff.length === 0 && (
        <p className="mt-6 text-sm text-slate-600">No staff records found for this organization yet.</p>
      )}

      {/* Change password modal */}

      {passwordModalStaff && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-96">
            <h2 className="text-xl font-bold mb-4">Change password</h2>
            <p className="text-sm text-slate-600 mb-4">Set a new password for {passwordModalStaff.full_name}</p>
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPasswordError(""); }}
              className="border w-full p-2 mb-3 rounded"
              autoComplete="new-password"
            />
            <input
              type="password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(""); }}
              className="border w-full p-2 mb-3 rounded"
              autoComplete="new-password"
            />
            {passwordError && <p className="text-sm text-red-600 mb-2">{passwordError}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setPasswordModalStaff(null); setNewPassword(""); setConfirmPassword(""); setPasswordError(""); }}
                className="px-4 py-2 bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={changing}
                className="px-4 py-2 bg-brand-700 text-white rounded disabled:opacity-50"
              >
                {changing ? "Updating…" : "Update password"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}