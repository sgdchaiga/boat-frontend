import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type MeetingRow = { id: string; meeting_date: string; status: "open" | "closed" | "scheduled" };
type MemberRow = { id: string; full_name: string };
type ShareTxnRow = { id: string; meeting_id: string; member_id: string; shares_bought: number; share_value: number; total_value: number; };
type SettingsRow = { share_value: number; max_shares_per_meeting: number };

export function VslaSavingsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;

  const [settings, setSettings] = useState<SettingsRow>({ share_value: 2000, max_shares_per_meeting: 5 });
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [txns, setTxns] = useState<ShareTxnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [meetingId, setMeetingId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sharesBought, setSharesBought] = useState("1");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const settingsQ = filterByOrganizationId(
      supabase.from("vsla_settings").select("share_value,max_shares_per_meeting").maybeSingle(),
      orgId,
      superAdmin
    );
    const meetingsQ = filterByOrganizationId(
      supabase.from("vsla_meetings").select("id,meeting_date,status").order("meeting_date", { ascending: false }),
      orgId,
      superAdmin
    );
    const membersQ = filterByOrganizationId(
      supabase.from("vsla_members").select("id,full_name").eq("status", "active").order("full_name"),
      orgId,
      superAdmin
    );
    const txnsQ = filterByOrganizationId(
      supabase.from("vsla_share_transactions").select("id,meeting_id,member_id,shares_bought,share_value,total_value").order("created_at", { ascending: false }),
      orgId,
      superAdmin
    );
    const [sRes, mtRes, mbRes, txRes] = await Promise.all([settingsQ, meetingsQ, membersQ, txnsQ]);
    if (sRes.error || mtRes.error || mbRes.error || txRes.error) {
      setError(sRes.error?.message ?? mtRes.error?.message ?? mbRes.error?.message ?? txRes.error?.message ?? "Failed to load savings data.");
    } else {
      if (sRes.data) setSettings(sRes.data as SettingsRow);
      setMeetings((mtRes.data ?? []) as MeetingRow[]);
      setMembers((mbRes.data ?? []) as MemberRow[]);
      setTxns((txRes.data ?? []) as ShareTxnRow[]);
    }
    setLoading(false);
  }, [orgId, superAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalsByMember = useMemo(() => {
    const map = new Map<string, { shares: number; value: number }>();
    for (const t of txns) {
      const cur = map.get(t.member_id) ?? { shares: 0, value: 0 };
      cur.shares += Number(t.shares_bought || 0);
      cur.value += Number(t.total_value || 0);
      map.set(t.member_id, cur);
    }
    return map;
  }, [txns]);

  const saveSettings = async () => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("vsla_settings").upsert({
      organization_id: orgId,
      share_value: Number(settings.share_value || 0),
      max_shares_per_meeting: Number(settings.max_shares_per_meeting || 0),
    }, { onConflict: "organization_id" });
    if (e) setError(e.message);
    setSaving(false);
  };

  const postShares = async () => {
    if (readOnly) return;
    const shares = Number(sharesBought);
    if (!meetingId || !memberId || !Number.isFinite(shares) || shares <= 0) {
      setError("Meeting, member, and valid shares are required.");
      return;
    }
    const maxPerMeeting = Number(settings.max_shares_per_meeting || 0);
    const { data: existing, error: e1 } = await filterByOrganizationId(
      supabase.from("vsla_share_transactions").select("shares_bought").eq("meeting_id", meetingId).eq("member_id", memberId),
      orgId,
      superAdmin
    );
    if (e1) {
      setError(e1.message);
      return;
    }
    const existingShares = (existing ?? []).reduce((s, r) => s + Number((r as { shares_bought: number }).shares_bought || 0), 0);
    if (existingShares + shares > maxPerMeeting) {
      setError(`Validation: max shares per meeting is ${maxPerMeeting}. This member already has ${existingShares} shares in this meeting.`);
      return;
    }
    setSaving(true);
    setError(null);
    const shareValue = Number(settings.share_value || 0);
    const { error: e2 } = await supabase.from("vsla_share_transactions").insert({
      organization_id: orgId,
      meeting_id: meetingId,
      member_id: memberId,
      shares_bought: shares,
      share_value: shareValue,
      total_value: shares * shareValue,
    });
    if (e2) setError(e2.message);
    setSharesBought("1");
    setSaving(false);
    await load();
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">VSLA Savings (Shares Purchase)</h1>
        <p className="text-sm text-slate-600 mt-1">Fixed share value, max shares per meeting validation, and share totals per member.</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Settings</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs text-slate-600">Share Value
            <input type="number" value={settings.share_value} onChange={(e) => setSettings((s) => ({ ...s, share_value: Number(e.target.value || 0) }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Max Shares Per Meeting
            <input type="number" value={settings.max_shares_per_meeting} onChange={(e) => setSettings((s) => ({ ...s, max_shares_per_meeting: Number(e.target.value || 0) }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void saveSettings()} disabled={readOnly || saving} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50">Save Settings</button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Record Shares Bought (Meeting)</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-xs text-slate-600">Meeting
            <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select meeting</option>
              {meetings.map((m) => <option key={m.id} value={m.id}>{m.meeting_date} ({m.status})</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Member
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Select member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Shares Bought
            <input type="number" min={1} value={sharesBought} onChange={(e) => setSharesBought(e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={() => void postShares()} disabled={readOnly || saving} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50">Post Shares</button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3">Member</th>
              <th className="text-left p-3">Total Shares</th>
              <th className="text-left p-3">Total Value</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-slate-500" colSpan={3}>Loading savings...</td></tr>
            ) : members.length === 0 ? (
              <tr><td className="p-4 text-slate-500" colSpan={3}>No active members found.</td></tr>
            ) : (
              members.map((m) => {
                const t = totalsByMember.get(m.id) ?? { shares: 0, value: 0 };
                return (
                  <tr key={m.id} className="border-b border-slate-100">
                    <td className="p-3 font-medium text-slate-900">{m.full_name}</td>
                    <td className="p-3 text-slate-700">{t.shares}</td>
                    <td className="p-3 text-slate-700">{t.value.toLocaleString()}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
