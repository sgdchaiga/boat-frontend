import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type Meeting = {
  id: string;
  meeting_date: string;
  status: "scheduled" | "open" | "closed";
  minutes: string | null;
};

export function VslaMeetingMinutesPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [rows, setRows] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [minutes, setMinutes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await filterByOrganizationId(
      supabase.from("vsla_meetings").select("id,meeting_date,status,minutes").order("meeting_date", { ascending: false }),
      orgId,
      superAdmin
    );
    if (res.error) {
      setRows([]);
      setError(res.error.message);
    } else {
      const data = (res.data ?? []) as Meeting[];
      setRows(data);
      if (!selectedMeetingId && data[0]?.id) {
        setSelectedMeetingId(data[0].id);
      }
    }
    setLoading(false);
  }, [orgId, selectedMeetingId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const selected = rows.find((m) => m.id === selectedMeetingId);
    setMinutes(selected?.minutes ?? "");
  }, [rows, selectedMeetingId]);

  const saveMinutes = async () => {
    if (readOnly || !selectedMeetingId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    const { error: e } = await supabase.from("vsla_meetings").update({ minutes }).eq("id", selectedMeetingId);
    if (e) {
      setError(e.message);
      setSaving(false);
      return;
    }
    setSuccess("Meeting minutes saved.");
    setSaving(false);
    await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Meeting Minutes</h1>
        <p className="text-sm text-slate-600 mt-1">Create, review, and edit minutes for VSLA meetings from one page.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-emerald-700">{success}</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="text-xs text-slate-600 md:col-span-2">
          Meeting
          <select
            value={selectedMeetingId}
            onChange={(e) => setSelectedMeetingId(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select meeting</option>
            {rows.map((m) => (
              <option key={m.id} value={m.id}>
                {m.meeting_date} ({m.status})
              </option>
            ))}
          </select>
        </label>
        <div className="md:col-span-2 flex items-end">
          <button
            type="button"
            onClick={() => void saveMinutes()}
            disabled={readOnly || saving || !selectedMeetingId}
            className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50"
          >
            Save Minutes
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <label className="text-xs text-slate-600 block">
          Minutes
          <textarea
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm min-h-48"
            placeholder={loading ? "Loading meetings..." : "Write meeting minutes here..."}
            disabled={!selectedMeetingId || loading}
          />
        </label>
      </div>
    </div>
  );
}
