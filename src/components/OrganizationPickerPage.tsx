import React, { useEffect, useMemo, useState } from "react";
import { Building2, Loader2, AlertCircle, ChevronRight } from "lucide-react";
import { APP_NAME } from "@/constants/branding";
import { useAuth } from "@/contexts/AuthContext";
import {
  organizationMembershipLabel,
  pickDefaultOrganizationId,
  readStoredActiveOrganizationId,
  type OrganizationMembership,
} from "@/lib/orgMembership";

export const OrganizationPickerPage: React.FC = () => {
  const { user, memberships, selectOrganization } = useAuth();
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMemberships = useMemo(
    () => memberships.filter((m) => m.is_active),
    [memberships]
  );

  const selectedMembership = useMemo(
    () => activeMemberships.find((m) => m.organization_id === selectedId) ?? null,
    [activeMemberships, selectedId]
  );

  useEffect(() => {
    if (activeMemberships.length === 0) {
      setSelectedId("");
      return;
    }
    const stored = user?.id ? readStoredActiveOrganizationId(user.id) : null;
    const defaultId = pickDefaultOrganizationId(activeMemberships, stored);
    setSelectedId((prev) =>
      prev && activeMemberships.some((m) => m.organization_id === prev)
        ? prev
        : defaultId ?? activeMemberships[0].organization_id
    );
  }, [activeMemberships, user?.id]);

  const handleContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) {
      setError("Select an organization.");
      return;
    }
    setError(null);
    setLoading(true);
    const { error: err } = await selectOrganization(selectedId);
    if (err) setError(err.message);
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 mb-4">
            <Building2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{APP_NAME}</h1>
          <p className="text-slate-300 mt-2 text-sm">Choose which organization to open</p>
          {user?.email ? <p className="text-slate-400 mt-1 text-xs">{user.email}</p> : null}
        </div>

        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-500/20 border border-red-500/40 px-4 py-3 text-red-100 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        ) : null}

        {activeMemberships.length === 0 ? (
          <p className="text-center text-sm text-slate-400">
            No organizations are linked to this account. Contact your administrator.
          </p>
        ) : (
          <form
            onSubmit={(ev) => void handleContinue(ev)}
            className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4"
          >
            <div>
              <label htmlFor="org-picker" className="block text-sm font-medium text-slate-200 mb-2">
                Organization
              </label>
              <select
                id="org-picker"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-white/20 bg-slate-900/80 text-white text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-60"
              >
                {activeMemberships.map((m: OrganizationMembership) => (
                  <option key={m.organization_id} value={m.organization_id}>
                    {organizationMembershipLabel(m)}
                  </option>
                ))}
              </select>
              {selectedMembership ? (
                <p className="mt-2 text-xs text-slate-400">
                  Signed in as <span className="text-slate-300">{selectedMembership.full_name}</span>
                  {selectedMembership.role ? (
                    <>
                      {" "}
                      · <span className="text-slate-300">{selectedMembership.role}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={loading || !selectedId}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold px-4 py-2.5 transition-colors disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              Continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
