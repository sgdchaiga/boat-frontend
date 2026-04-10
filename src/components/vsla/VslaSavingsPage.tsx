import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { formatVslaMemberLabel } from "@/lib/vslaMemberLabel";
import {
  buildVslaMinutesStoragePath,
  getVslaMeetingMinutesSignedUrl,
  removeVslaMeetingMinutesFile,
  uploadVslaMeetingMinutesFile,
} from "@/lib/vslaMeetingMinutes";

type TabId = "new_purchase" | "recent" | "totals";

type MeetingRow = {
  id: string;
  meeting_date: string;
  status: "open" | "closed" | "scheduled";
  minutes: string | null;
  minutes_attachment_path: string | null;
  minutes_attachment_name: string | null;
};
type MemberRow = {
  id: string;
  full_name: string;
  member_number: string | null;
};
type ShareTxnRow = {
  id: string;
  meeting_id: string;
  member_id: string;
  shares_bought: number;
  share_value: number;
  total_value: number;
  created_at: string;
};
type SettingsRow = { share_value: number; max_shares_per_meeting: number };

const BULK_CSV_TEMPLATE = `meeting_date,member_number,shares_bought
2026-04-01,M001,2
2026-04-01,M002,1`;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h: string): string {
  return h.replace(/^\ufeff/, "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function VslaSavingsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;

  const [tab, setTab] = useState<TabId>("new_purchase");
  const [settings, setSettings] = useState<SettingsRow>({
    share_value: 2000,
    max_shares_per_meeting: 5,
  });
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [txns, setTxns] = useState<ShareTxnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);

  const [meetingId, setMeetingId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sharesBought, setSharesBought] = useState("1");
  const [minutesText, setMinutesText] = useState("");
  const [minutesTouched, setMinutesTouched] = useState(false);

  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [editShares, setEditShares] = useState("1");

  const [bulkFile, setBulkFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const settingsQ = filterByOrganizationId(
      supabase
        .from("vsla_settings")
        .select("share_value,max_shares_per_meeting")
        .maybeSingle(),
      orgId,
      superAdmin,
    );
    const meetingsQ = filterByOrganizationId(
      supabase
        .from("vsla_meetings")
        .select(
          "id,meeting_date,status,minutes,minutes_attachment_path,minutes_attachment_name",
        )
        .order("meeting_date", { ascending: false }),
      orgId,
      superAdmin,
    );
    const membersQ = filterByOrganizationId(
      supabase
        .from("vsla_members")
        .select("id,full_name,member_number")
        .eq("status", "active")
        .order("full_name"),
      orgId,
      superAdmin,
    );
    const txnsQ = filterByOrganizationId(
      supabase
        .from("vsla_share_transactions")
        .select(
          "id,meeting_id,member_id,shares_bought,share_value,total_value,created_at",
        )
        .order("created_at", { ascending: false })
        .limit(500),
      orgId,
      superAdmin,
    );
    const [sRes, mtRes, mbRes, txRes] = await Promise.all([
      settingsQ,
      meetingsQ,
      membersQ,
      txnsQ,
    ]);
    if (sRes.error || mtRes.error || mbRes.error || txRes.error) {
      setError(
        sRes.error?.message ??
          mtRes.error?.message ??
          mbRes.error?.message ??
          txRes.error?.message ??
          "Failed to load savings data.",
      );
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

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === meetingId),
    [meetings, meetingId],
  );

  useEffect(() => {
    setMinutesTouched(false);
  }, [meetingId]);

  useEffect(() => {
    if (!meetingId) {
      setMinutesText("");
      return;
    }
    if (minutesTouched) return;
    const m = meetings.find((x) => x.id === meetingId);
    setMinutesText(m?.minutes ?? "");
  }, [meetingId, meetings, minutesTouched]);

  const meetingLabel = useMemo(
    () => new Map(meetings.map((m) => [m.id, `${m.meeting_date} (${m.status})`])),
    [meetings],
  );

  const meetingByDate = useMemo(() => {
    const map = new Map<string, MeetingRow>();
    for (const m of meetings) {
      map.set(String(m.meeting_date).slice(0, 10), m);
    }
    return map;
  }, [meetings]);

  const memberByNumber = useMemo(() => {
    const map = new Map<string, MemberRow>();
    for (const m of members) {
      const n = (m.member_number ?? "").trim();
      if (n) map.set(n.toLowerCase(), m);
    }
    return map;
  }, [members]);

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

  const stampsForMeeting = useMemo(() => {
    const map = new Map<string, number>();
    if (!meetingId) return map;
    for (const t of txns) {
      if (t.meeting_id !== meetingId) continue;
      map.set(
        t.member_id,
        (map.get(t.member_id) ?? 0) + Number(t.shares_bought || 0),
      );
    }
    return map;
  }, [meetingId, txns]);

  const saveSettings = async () => {
    if (readOnly) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase.from("vsla_settings").upsert(
      {
        organization_id: orgId,
        share_value: Number(settings.share_value || 0),
        max_shares_per_meeting: Number(settings.max_shares_per_meeting || 0),
      },
      { onConflict: "organization_id" },
    );
    if (e) setError(e.message);
    setSaving(false);
  };

  const saveMeetingMinutesText = async () => {
    if (readOnly || !meetingId) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("vsla_meetings")
      .update({ minutes: minutesText.trim() || null })
      .eq("id", meetingId);
    if (e) setError(e.message);
    setMinutesTouched(false);
    setSaving(false);
    await load();
  };

  const uploadMinutesFile = async (file: File) => {
    if (readOnly || !meetingId || !orgId) return;
    setSaving(true);
    setError(null);
    const path = buildVslaMinutesStoragePath(orgId, meetingId, file.name);
    const up = await uploadVslaMeetingMinutesFile(file, path);
    if (up.error) {
      setError(up.error.message);
      setSaving(false);
      return;
    }
    const oldPath = selectedMeeting?.minutes_attachment_path ?? null;
    const { error: e } = await supabase
      .from("vsla_meetings")
      .update({
        minutes_attachment_path: path,
        minutes_attachment_name: file.name,
      })
      .eq("id", meetingId);
    if (e) {
      await removeVslaMeetingMinutesFile(path);
      setError(e.message);
      setSaving(false);
      return;
    }
    if (oldPath && oldPath !== path) {
      await removeVslaMeetingMinutesFile(oldPath);
    }
    setSaving(false);
    await load();
  };

  const removeMinutesAttachment = async () => {
    if (readOnly || !meetingId) return;
    const p = selectedMeeting?.minutes_attachment_path;
    if (!p) return;
    setSaving(true);
    setError(null);
    await removeVslaMeetingMinutesFile(p);
    const { error: e } = await supabase
      .from("vsla_meetings")
      .update({
        minutes_attachment_path: null,
        minutes_attachment_name: null,
      })
      .eq("id", meetingId);
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const openMinutesAttachment = async () => {
    const p = selectedMeeting?.minutes_attachment_path;
    if (!p) return;
    const url = await getVslaMeetingMinutesSignedUrl(p);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else setError("Could not open file link.");
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
      supabase
        .from("vsla_share_transactions")
        .select("shares_bought")
        .eq("meeting_id", meetingId)
        .eq("member_id", memberId),
      orgId,
      superAdmin,
    );
    if (e1) {
      setError(e1.message);
      return;
    }
    const existingShares = (existing ?? []).reduce(
      (s, r) => s + Number((r as { shares_bought: number }).shares_bought || 0),
      0,
    );
    if (existingShares + shares > maxPerMeeting) {
      setError(
        `Validation: max shares per meeting is ${maxPerMeeting}. This member already has ${existingShares} shares in this meeting.`,
      );
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

  const setMemberStamps = async (targetMemberId: string, stamps: number) => {
    if (readOnly || !meetingId || meetingId === "") return;
    const value = Number(settings.share_value || 0);
    const maxStamps = Number(settings.max_shares_per_meeting || 0);
    if (!targetMemberId || value <= 0 || maxStamps <= 0) return;
    if (stamps > maxStamps) {
      setError(`Max stamps per meeting is ${maxStamps}.`);
      return;
    }
    setSaving(true);
    setError(null);
    const del = await supabase
      .from("vsla_share_transactions")
      .delete()
      .eq("meeting_id", meetingId)
      .eq("member_id", targetMemberId);
    if (del.error) {
      setError(del.error.message);
      setSaving(false);
      return;
    }
    if (stamps > 0) {
      const ins = await supabase.from("vsla_share_transactions").insert({
        organization_id: orgId,
        meeting_id: meetingId,
        member_id: targetMemberId,
        shares_bought: stamps,
        share_value: value,
        total_value: stamps * value,
      });
      if (ins.error) setError(ins.error.message);
    }
    setSaving(false);
    await load();
  };

  const saveTxnEdit = async (row: ShareTxnRow) => {
    if (readOnly || !editingTxnId) return;
    const n = Number(editShares);
    if (!Number.isFinite(n) || n <= 0) return;
    const shareValue = Number(row.share_value || settings.share_value || 0);
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("vsla_share_transactions")
      .update({
        shares_bought: n,
        total_value: n * shareValue,
      })
      .eq("id", editingTxnId);
    if (e) setError(e.message);
    setEditingTxnId(null);
    setSaving(false);
    await load();
  };

  const deleteTxn = async (id: string) => {
    if (readOnly) return;
    if (!confirm("Delete this share purchase record?")) return;
    setSaving(true);
    setError(null);
    const { error: e } = await supabase
      .from("vsla_share_transactions")
      .delete()
      .eq("id", id);
    if (e) setError(e.message);
    setSaving(false);
    await load();
  };

  const downloadBulkTemplate = () => {
    const blob = new Blob([BULK_CSV_TEMPLATE], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "vsla_shares_bulk_template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const runBulkUpload = async () => {
    if (readOnly || !bulkFile || !orgId) return;
    setBulkMessage(null);
    setError(null);
    const text = await bulkFile.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      setError("CSV must include a header row and at least one data row.");
      return;
    }
    const headerCells = parseCsvLine(lines[0]).map(normalizeHeader);
    const iDate = headerCells.findIndex((h) =>
      ["meeting_date", "date", "meeting"].includes(h),
    );
    const iMem = headerCells.findIndex((h) =>
      ["member_number", "member_no", "memberno", "mem_no"].includes(h),
    );
    const iShares = headerCells.findIndex((h) =>
      ["shares_bought", "shares", "stamps", "qty"].includes(h),
    );
    if (iDate < 0 || iMem < 0 || iShares < 0) {
      setError(
        "CSV must have columns: meeting_date, member_number, shares_bought (names can vary slightly).",
      );
      return;
    }

    type Agg = { meetingId: string; memberId: string; shares: number; line: number };
    const groups = new Map<string, Agg>();
    const maxPerMeeting = Number(settings.max_shares_per_meeting || 0);
    const shareValue = Number(settings.share_value || 0);

    for (let li = 1; li < lines.length; li++) {
      const cells = parseCsvLine(lines[li]);
      const dateRaw = (cells[iDate] ?? "").trim().slice(0, 10);
      const memNo = (cells[iMem] ?? "").trim().toLowerCase();
      const sharesN = Number((cells[iShares] ?? "").replace(/,/g, ""));
      if (!dateRaw || !memNo || !Number.isFinite(sharesN) || sharesN <= 0) {
        setError(`Row ${li + 1}: invalid date, member number, or shares.`);
        return;
      }
      const mtg = meetingByDate.get(dateRaw);
      if (!mtg) {
        setError(
          `Row ${li + 1}: no meeting on ${dateRaw} (use YYYY-MM-DD matching an existing meeting).`,
        );
        return;
      }
      const mem = memberByNumber.get(memNo);
      if (!mem) {
        setError(
          `Row ${li + 1}: no active member with member_number "${cells[iMem]?.trim()}".`,
        );
        return;
      }
      const key = `${mtg.id}:${mem.id}`;
      const prev = groups.get(key);
      const add = Math.floor(sharesN);
      if (add <= 0) {
        setError(`Row ${li + 1}: shares must be a positive whole number.`);
        return;
      }
      groups.set(key, {
        meetingId: mtg.id,
        memberId: mem.id,
        shares: (prev?.shares ?? 0) + add,
        line: li + 1,
      });
    }

    const checks = await filterByOrganizationId(
      supabase
        .from("vsla_share_transactions")
        .select("meeting_id,member_id,shares_bought"),
      orgId,
      superAdmin,
    );
    if (checks.error) {
      setError(checks.error.message);
      return;
    }
    const existingSum = new Map<string, number>();
    for (const r of checks.data ?? []) {
      const row = r as {
        meeting_id: string;
        member_id: string;
        shares_bought: number;
      };
      const k = `${row.meeting_id}:${row.member_id}`;
      existingSum.set(k, (existingSum.get(k) ?? 0) + Number(row.shares_bought || 0));
    }

    const rowsToInsert: Array<{
      organization_id: string | null;
      meeting_id: string;
      member_id: string;
      shares_bought: number;
      share_value: number;
      total_value: number;
    }> = [];

    for (const [, agg] of groups) {
      const k = `${agg.meetingId}:${agg.memberId}`;
      const existing = existingSum.get(k) ?? 0;
      if (existing + agg.shares > maxPerMeeting) {
        setError(
          `Member / meeting ending at CSV row ${agg.line}: would exceed max shares per meeting (${maxPerMeeting}). Existing: ${existing}, CSV total: ${agg.shares}.`,
        );
        return;
      }
      rowsToInsert.push({
        organization_id: orgId,
        meeting_id: agg.meetingId,
        member_id: agg.memberId,
        shares_bought: agg.shares,
        share_value: shareValue,
        total_value: agg.shares * shareValue,
      });
    }

    if (rowsToInsert.length === 0) {
      setError("No rows to import.");
      return;
    }

    setSaving(true);
    const chunk = 40;
    for (let i = 0; i < rowsToInsert.length; i += chunk) {
      const slice = rowsToInsert.slice(i, i + chunk);
      const { error: e } = await supabase
        .from("vsla_share_transactions")
        .insert(slice);
      if (e) {
        setError(e.message);
        setSaving(false);
        await load();
        return;
      }
    }
    setBulkMessage(`Imported ${rowsToInsert.length} share purchase row(s).`);
    setBulkFile(null);
    setSaving(false);
    await load();
  };

  const maxStamps = Math.max(1, Number(settings.max_shares_per_meeting || 5));

  return (
    <div className="px-4 py-6 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          VSLA Savings (Shares Purchase)
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          New purchases, recent history, member totals, bulk CSV import, and
          meeting minutes.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {bulkMessage && (
        <p className="text-sm text-emerald-700">{bulkMessage}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("new_purchase")}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-sm touch-manipulation ${
            tab === "new_purchase"
              ? "bg-indigo-700 text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          New purchase
        </button>
        <button
          type="button"
          onClick={() => setTab("recent")}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-sm touch-manipulation ${
            tab === "recent"
              ? "bg-indigo-700 text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          Recent purchases
        </button>
        <button
          type="button"
          onClick={() => setTab("totals")}
          className={`min-h-[44px] px-4 py-2 rounded-lg text-sm touch-manipulation ${
            tab === "totals"
              ? "bg-indigo-700 text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          Members total shares
        </button>
      </div>

      {tab === "new_purchase" && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Settings
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-slate-600">
                Share Value
                <input
                  type="number"
                  value={settings.share_value}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      share_value: Number(e.target.value || 0),
                    }))
                  }
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Max Shares Per Meeting
                <input
                  type="number"
                  value={settings.max_shares_per_meeting}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      max_shares_per_meeting: Number(e.target.value || 0),
                    }))
                  }
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={readOnly || saving}
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-lg bg-slate-900 text-white text-sm touch-manipulation disabled:opacity-50"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Meeting & minutes
            </p>
            <label className="text-xs text-slate-600 block max-w-xl">
              Meeting
              <select
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value)}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
              >
                <option value="">Select meeting</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.meeting_date} ({m.status})
                  </option>
                ))}
              </select>
            </label>
            {meetingId ? (
              <div className="mt-4 space-y-3">
                <label className="text-xs text-slate-600 block">
                  Minutes (text)
                  <textarea
                    value={minutesText}
                    onChange={(e) => {
                      setMinutesTouched(true);
                      setMinutesText(e.target.value);
                    }}
                    rows={5}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-base sm:text-sm"
                    placeholder="Summary of decisions, attendance notes, etc."
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={readOnly || saving}
                    onClick={() => void saveMeetingMinutesText()}
                    className="min-h-[44px] px-4 py-2 rounded-lg bg-slate-800 text-white text-sm touch-manipulation disabled:opacity-50"
                  >
                    Save minutes text
                  </button>
                </div>
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">
                    Minutes file (PDF, Word, image, etc.)
                  </p>
                  {selectedMeeting?.minutes_attachment_name ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-slate-700 truncate max-w-[240px]">
                        {selectedMeeting.minutes_attachment_name}
                      </span>
                      <button
                        type="button"
                        className="text-indigo-700 text-sm touch-manipulation min-h-[44px] px-2"
                        onClick={() => void openMinutesAttachment()}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        disabled={readOnly || saving}
                        className="text-rose-700 text-sm touch-manipulation min-h-[44px] px-2 disabled:opacity-50"
                        onClick={() => void removeMinutesAttachment()}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 mb-2">No file attached.</p>
                  )}
                  <label className="inline-block mt-1">
                    <span className="sr-only">Upload minutes file</span>
                    <input
                      type="file"
                      disabled={readOnly || saving}
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv"
                      className="text-sm max-w-full"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadMinutesFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500 mt-3">
                Select a meeting to edit minutes or attach a file.
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Record shares bought (single row)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <label className="text-xs text-slate-600">
                Member
                <select
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
                >
                  <option value="">Select member</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {formatVslaMemberLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-600">
                Shares bought
                <input
                  type="number"
                  min={1}
                  value={sharesBought}
                  onChange={(e) => setSharesBought(e.target.value)}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm"
                />
              </label>
              <div className="flex items-end sm:col-span-2">
                <button
                  type="button"
                  onClick={() => void postShares()}
                  disabled={readOnly || saving || !meetingId}
                  className="min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm touch-manipulation disabled:opacity-50"
                >
                  Post shares
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Stamps (per member, selected meeting)
            </p>
            <p className="text-xs text-slate-600">
              Tap a stamp count for each member, or Clear. Uses share value and
              max stamps from settings.
            </p>
            {!meetingId ? (
              <p className="text-sm text-slate-500">
                Select a meeting above to use stamps.
              </p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => {
                  const selected = stampsForMeeting.get(m.id) ?? 0;
                  return (
                    <div
                      key={m.id}
                      className="border border-slate-200 rounded-lg p-3 flex flex-wrap items-center gap-2 sm:gap-3"
                    >
                      <div className="min-w-[10rem] font-medium text-slate-800 text-sm">
                        {formatVslaMemberLabel(m)}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: maxStamps }, (_, i) => i + 1).map(
                          (n) => (
                            <button
                              key={n}
                              type="button"
                              onClick={() => void setMemberStamps(m.id, n)}
                              disabled={readOnly || saving}
                              className={`min-h-[44px] min-w-[44px] rounded-md text-xs font-semibold border touch-manipulation ${
                                n <= selected
                                  ? "bg-emerald-600 text-white border-emerald-700"
                                  : "bg-white text-slate-700 border-slate-300"
                              } disabled:opacity-50`}
                            >
                              {n}
                            </button>
                          ),
                        )}
                        <button
                          type="button"
                          onClick={() => void setMemberStamps(m.id, 0)}
                          disabled={readOnly || saving}
                          className="min-h-[44px] px-3 rounded-md text-xs font-medium border border-slate-300 touch-manipulation disabled:opacity-50"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="text-xs text-slate-600 ml-auto">
                        Stamps: <strong>{selected}</strong> · Value:{" "}
                        <strong>
                          {(
                            selected * Number(settings.share_value || 0)
                          ).toLocaleString()}
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "recent" && (
        <>
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Bulk upload (CSV)
            </p>
            <p className="text-sm text-slate-600">
              Columns: <code className="text-xs bg-slate-100 px-1">meeting_date</code>{" "}
              (YYYY-MM-DD, must match a meeting),{" "}
              <code className="text-xs bg-slate-100 px-1">member_number</code>,{" "}
              <code className="text-xs bg-slate-100 px-1">shares_bought</code>.
              Multiple rows for the same meeting and member are summed into one
              purchase. Max shares per meeting is enforced using current settings.
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <button
                type="button"
                onClick={downloadBulkTemplate}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 text-sm touch-manipulation"
              >
                Download template
              </button>
              <label className="inline-flex items-center gap-2 text-sm">
                <span className="text-slate-600">Choose CSV</span>
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={readOnly || saving}
                  onChange={(e) =>
                    setBulkFile(e.target.files?.[0] ?? null)
                  }
                />
              </label>
              {bulkFile ? (
                <span className="text-xs text-slate-500 truncate max-w-[200px]">
                  {bulkFile.name}
                </span>
              ) : null}
              <button
                type="button"
                disabled={readOnly || saving || !bulkFile}
                onClick={() => void runBulkUpload()}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm touch-manipulation disabled:opacity-50"
              >
                Import CSV
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <p className="p-3 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
              Recent purchases (edit / delete)
            </p>
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Meeting</th>
                  <th className="text-left p-3">Member</th>
                  <th className="text-left p-3">Member no.</th>
                  <th className="text-left p-3">Shares</th>
                  <th className="text-left p-3">Value</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={7}>
                      Loading...
                    </td>
                  </tr>
                ) : txns.length === 0 ? (
                  <tr>
                    <td className="p-4 text-slate-500" colSpan={7}>
                      No share purchases yet.
                    </td>
                  </tr>
                ) : (
                  txns.map((t) => {
                    const mem = members.find((x) => x.id === t.member_id);
                    return (
                      <tr key={t.id} className="border-b border-slate-100">
                        <td className="p-3 whitespace-nowrap">
                          {String(t.created_at).slice(0, 10)}
                        </td>
                        <td className="p-3">
                          {meetingLabel.get(t.meeting_id) ??
                            t.meeting_id.slice(0, 8)}
                        </td>
                        <td className="p-3">
                          {mem
                            ? (mem.full_name ?? "").trim() || "Unknown"
                            : "Unknown"}
                        </td>
                        <td className="p-3 text-slate-600">
                          {(mem?.member_number ?? "").trim() || "—"}
                        </td>
                        <td className="p-3">
                          {editingTxnId === t.id ? (
                            <input
                              type="number"
                              min={1}
                              value={editShares}
                              onChange={(e) => setEditShares(e.target.value)}
                              className="w-20 border border-slate-300 rounded px-2 py-1.5 text-base sm:text-sm"
                            />
                          ) : (
                            t.shares_bought
                          )}
                        </td>
                        <td className="p-3">
                          {Number(t.total_value || 0).toLocaleString()}
                        </td>
                        <td className="p-3">
                          {editingTxnId === t.id ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="text-xs text-indigo-700 touch-manipulation min-h-[40px] px-2"
                                disabled={readOnly || saving}
                                onClick={() => void saveTxnEdit(t)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="text-xs text-slate-600 touch-manipulation min-h-[40px] px-2"
                                onClick={() => setEditingTxnId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="text-xs text-indigo-700 touch-manipulation min-h-[40px] px-2"
                                disabled={readOnly || saving}
                                onClick={() => {
                                  setEditingTxnId(t.id);
                                  setEditShares(String(t.shares_bought));
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="text-xs text-rose-700 touch-manipulation min-h-[40px] px-2"
                                disabled={readOnly || saving}
                                onClick={() => void deleteTxn(t.id)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "totals" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <p className="p-3 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200">
            Total shares per member (all meetings)
          </p>
          <table className="w-full text-sm min-w-[480px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left p-3">Member</th>
                <th className="text-left p-3">Member no.</th>
                <th className="text-left p-3">Total shares</th>
                <th className="text-left p-3">Total value</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="p-4 text-slate-500" colSpan={4}>
                    Loading savings...
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td className="p-4 text-slate-500" colSpan={4}>
                    No active members found.
                  </td>
                </tr>
              ) : (
                members.map((m) => {
                  const t = totalsByMember.get(m.id) ?? { shares: 0, value: 0 };
                  const no = (m.member_number ?? "").trim();
                  return (
                    <tr key={m.id} className="border-b border-slate-100">
                      <td className="p-3 font-medium text-slate-900">
                        {(m.full_name ?? "").trim() || "Unknown"}
                      </td>
                      <td className="p-3 text-slate-600">{no || "—"}</td>
                      <td className="p-3 text-slate-700">{t.shares}</td>
                      <td className="p-3 text-slate-700">
                        {t.value.toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
