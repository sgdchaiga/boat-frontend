import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Plus, Printer, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import {
  buildVslaMinutesStoragePath,
  getVslaMeetingMinutesSignedUrl,
  removeVslaMeetingMinutesFile,
  uploadVslaMeetingMinutesFile,
} from "@/lib/vslaMeetingMinutes";

type Resolution = { text: string; owner: string; due_date: string };
type Signatory = { role: "Chairperson" | "Secretary"; name: string; confirmed: boolean };
type Meeting = {
  id: string;
  meeting_date: string;
  status: "scheduled" | "open" | "closed";
  minutes: string | null;
  minutes_status: "draft" | "final";
  minutes_agenda: string[];
  minutes_resolutions: Resolution[];
  minutes_signatories: Signatory[];
  quorum_required: number;
  quorum_present: number;
  minutes_attachment_path: string | null;
  minutes_attachment_name: string | null;
  minutes_finalized_at: string | null;
};

const defaultSignatories: Signatory[] = [
  { role: "Chairperson", name: "", confirmed: false },
  { role: "Secretary", name: "", confirmed: false },
];
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char] ?? char);

export function VslaMeetingMinutesPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!isSuperAdmin;
  const [rows, setRows] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState("");
  const [agendaText, setAgendaText] = useState("");
  const [minutes, setMinutes] = useState("");
  const [resolutions, setResolutions] = useState<Resolution[]>([]);
  const [signatories, setSignatories] = useState<Signatory[]>(defaultSignatories);
  const [quorumRequired, setQuorumRequired] = useState("1");
  const [quorumPresent, setQuorumPresent] = useState("0");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("saved");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const selectedIdRef = useRef("");

  const load = useCallback(async (preserveEditor = false) => {
    setLoading(true);
    const res = await filterByOrganizationId(
      supabase.from("vsla_meetings").select("id,meeting_date,status,minutes,minutes_status,minutes_agenda,minutes_resolutions,minutes_signatories,quorum_required,quorum_present,minutes_attachment_path,minutes_attachment_name,minutes_finalized_at").order("meeting_date", { ascending: false }),
      orgId,
      superAdmin,
    );
    if (res.error) {
      setRows([]);
      setError(res.error.message);
    } else {
      const data = (res.data ?? []) as Meeting[];
      setRows(data);
      if (!selectedMeetingId && data[0]?.id) setSelectedMeetingId(data[0].id);
      if (!preserveEditor && selectedMeetingId) selectedIdRef.current = "";
    }
    setLoading(false);
  }, [orgId, selectedMeetingId, superAdmin]);

  useEffect(() => { void load(); }, [load]);

  const selectedMeeting = useMemo(() => rows.find((meeting) => meeting.id === selectedMeetingId) ?? null, [rows, selectedMeetingId]);
  const locked = readOnly || selectedMeeting?.status === "closed";
  const agenda = agendaText.split("\n").map((item) => item.trim()).filter(Boolean);
  const quorumMet = Number(quorumPresent) >= Number(quorumRequired) && Number(quorumRequired) > 0;

  useEffect(() => {
    if (!selectedMeeting || selectedIdRef.current === selectedMeeting.id) return;
    selectedIdRef.current = selectedMeeting.id;
    setAgendaText((selectedMeeting.minutes_agenda ?? []).join("\n"));
    setMinutes(selectedMeeting.minutes ?? "");
    setResolutions(selectedMeeting.minutes_resolutions ?? []);
    const savedSignatories = selectedMeeting.minutes_signatories ?? [];
    setSignatories(defaultSignatories.map((fallback) => savedSignatories.find((entry) => entry.role === fallback.role) ?? fallback));
    setQuorumRequired(String(selectedMeeting.quorum_required ?? 1));
    setQuorumPresent(String(selectedMeeting.quorum_present ?? 0));
    setDirty(false);
    setSaveState("saved");
    setSuccess(null);
    setError(null);
  }, [selectedMeeting]);

  const persist = useCallback(async (finalize: boolean, quiet = false) => {
    if (!selectedMeetingId || locked) return false;
    setSaving(true);
    setSaveState("saving");
    if (!quiet) { setError(null); setSuccess(null); }
    const { error: saveError } = await supabase.rpc("vsla_save_structured_minutes", {
      p_meeting_id: selectedMeetingId,
      p_minutes: minutes,
      p_agenda: agenda,
      p_resolutions: resolutions.filter((resolution) => resolution.text.trim()),
      p_signatories: signatories,
      p_quorum_required: Number(quorumRequired),
      p_quorum_present: Number(quorumPresent),
      p_finalize: finalize,
    });
    if (saveError) {
      setError(saveError.message);
      setSaveState("unsaved");
      setSaving(false);
      return false;
    }
    setDirty(false);
    setSaveState("saved");
    setSaving(false);
    if (!quiet) setSuccess(finalize ? "Minutes finalized and ready for meeting closure." : "Draft saved.");
    await load(true);
    return true;
  }, [agenda, load, locked, minutes, quorumPresent, quorumRequired, resolutions, selectedMeetingId, signatories]);

  useEffect(() => {
    if (!dirty || locked || !selectedMeetingId) return;
    setSaveState("unsaved");
    const timer = window.setTimeout(() => { void persist(false, true); }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, locked, persist, selectedMeetingId]);

  const change = (action: () => void) => { action(); setDirty(true); setSuccess(null); };
  const updateResolution = (index: number, patch: Partial<Resolution>) => change(() => setResolutions((current) => current.map((resolution, itemIndex) => itemIndex === index ? { ...resolution, ...patch } : resolution)));
  const updateSignatory = (index: number, patch: Partial<Signatory>) => change(() => setSignatories((current) => current.map((signatory, itemIndex) => itemIndex === index ? { ...signatory, ...patch } : signatory)));

  const uploadAttachment = async (file: File | null) => {
    if (!file || !orgId || !selectedMeetingId || locked) return;
    setUploading(true); setError(null);
    const storagePath = buildVslaMinutesStoragePath(orgId, selectedMeetingId, file.name);
    const upload = await uploadVslaMeetingMinutesFile(file, storagePath);
    if (upload.error) { setError(upload.error.message); setUploading(false); return; }
    const previousPath = selectedMeeting?.minutes_attachment_path ?? null;
    const update = await supabase.from("vsla_meetings").update({ minutes_attachment_path: storagePath, minutes_attachment_name: file.name }).eq("id", selectedMeetingId);
    if (update.error) {
      await removeVslaMeetingMinutesFile(storagePath);
      setError(update.error.message);
    } else {
      if (previousPath) await removeVslaMeetingMinutesFile(previousPath);
      setSuccess("Attachment uploaded.");
      await load(true);
    }
    setUploading(false);
  };

  const openAttachment = async () => {
    const path = selectedMeeting?.minutes_attachment_path;
    if (!path) return;
    const url = await getVslaMeetingMinutesSignedUrl(path);
    if (url) window.open(url, "_blank", "noopener,noreferrer"); else setError("Could not open the attachment.");
  };

  const printMinutes = () => {
    if (!selectedMeeting) return;
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) { setError("Allow pop-ups to print the minutes."); return; }
    const resolutionRows = resolutions.filter((item) => item.text.trim()).map((item) => `<tr><td>${escapeHtml(item.text)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.due_date)}</td></tr>`).join("");
    popup.document.write(`<!doctype html><html><head><title>VSLA Minutes ${escapeHtml(selectedMeeting.meeting_date)}</title><style>body{font:14px Arial;max-width:850px;margin:35px auto;color:#172033}h1,h2{margin-bottom:6px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ccd3df;padding:8px;text-align:left}.sign{display:flex;gap:50px;margin-top:50px}.sign>div{flex:1;border-top:1px solid #333;padding-top:8px}@media print{button{display:none}}</style></head><body><button onclick="print()">Print</button><h1>VSLA Meeting Minutes</h1><p><strong>Date:</strong> ${escapeHtml(selectedMeeting.meeting_date)} · <strong>Status:</strong> ${escapeHtml(selectedMeeting.minutes_status)}</p><p><strong>Quorum:</strong> ${escapeHtml(quorumPresent)} present / ${escapeHtml(quorumRequired)} required</p><h2>Agenda</h2><ol>${agenda.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol><h2>Discussion</h2><p>${escapeHtml(minutes).replace(/\n/g, "<br>")}</p><h2>Resolutions</h2><table><thead><tr><th>Resolution</th><th>Owner</th><th>Due date</th></tr></thead><tbody>${resolutionRows || '<tr><td colspan="3">None recorded</td></tr>'}</tbody></table><div class="sign">${signatories.map((item) => `<div><strong>${escapeHtml(item.name || "Not provided")}</strong><br>${escapeHtml(item.role)}</div>`).join("")}</div></body></html>`);
    popup.document.close();
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3"><div><h1 className="text-2xl font-bold text-slate-900">Meeting Minutes & Governance</h1><p className="text-sm text-slate-600 mt-1">Document quorum, agenda, decisions, responsibilities and approvals.</p></div><span className={`text-xs rounded-full px-3 py-1 ${saveState === "saved" ? "bg-emerald-100 text-emerald-700" : saveState === "saving" ? "bg-indigo-100 text-indigo-700" : "bg-amber-100 text-amber-700"}`}>{saveState === "saved" ? "All changes saved" : saveState === "saving" ? "Saving draft..." : "Unsaved changes"}</span></div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{success && <p className="text-sm text-emerald-700">{success}</p>}

      <div className="bg-white rounded-xl border border-slate-200 p-4 grid md:grid-cols-4 gap-3">
        <label className="text-xs text-slate-600 md:col-span-2">Meeting<select value={selectedMeetingId} onChange={(event) => { selectedIdRef.current = ""; setSelectedMeetingId(event.target.value); }} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"><option value="">Select meeting</option>{rows.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.meeting_date} ({meeting.status}; minutes {meeting.minutes_status})</option>)}</select></label>
        <div className="md:col-span-2 flex flex-wrap items-end gap-2"><button type="button" onClick={() => void persist(false)} disabled={locked || saving || !selectedMeetingId} className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm disabled:opacity-50">Save Draft</button><button type="button" onClick={() => void persist(true)} disabled={locked || saving || !selectedMeetingId} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm disabled:opacity-50">Finalize Minutes</button><button type="button" onClick={printMinutes} disabled={!selectedMeetingId} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm disabled:opacity-50"><Printer className="w-4 h-4" />Print</button></div>
      </div>

      {selectedMeeting?.status === "closed" && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">This meeting is closed. Its minutes and attachment are locked.</div>}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"><h2 className="font-semibold text-slate-900">1. Quorum</h2><div className="grid sm:grid-cols-2 gap-3"><label className="text-xs text-slate-600">Members Present<input type="number" min="0" value={quorumPresent} onChange={(event) => change(() => setQuorumPresent(event.target.value))} disabled={locked} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label><label className="text-xs text-slate-600">Required Quorum<input type="number" min="1" value={quorumRequired} onChange={(event) => change(() => setQuorumRequired(event.target.value))} disabled={locked} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></label></div><p className={`text-sm font-medium ${quorumMet ? "text-emerald-700" : "text-rose-700"}`}>{quorumMet ? "Quorum met" : "Quorum not met"}</p></section>
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"><h2 className="font-semibold text-slate-900">2. Agenda</h2><p className="text-xs text-slate-500">Enter one agenda item per line.</p><textarea value={agendaText} onChange={(event) => change(() => setAgendaText(event.target.value))} disabled={locked} className="w-full min-h-32 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder={loading ? "Loading..." : "Opening and prayer\nReview previous actions\nSavings and loan business"} /></section>
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2"><h2 className="font-semibold text-slate-900">3. Discussion Notes</h2><textarea value={minutes} onChange={(event) => change(() => setMinutes(event.target.value))} disabled={locked} className="w-full min-h-56 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Record discussions, decisions and important observations..." /></section>
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-900">4. Resolutions & Actions</h2><button type="button" onClick={() => change(() => setResolutions((current) => [...current, { text: "", owner: "", due_date: "" }]))} disabled={locked} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs disabled:opacity-50"><Plus className="w-3.5 h-3.5" />Add Resolution</button></div>{resolutions.length === 0 ? <p className="text-sm text-slate-500">No resolutions recorded.</p> : resolutions.map((resolution, index) => <div key={index} className="grid md:grid-cols-12 gap-2 rounded-lg bg-slate-50 p-3"><textarea value={resolution.text} onChange={(event) => updateResolution(index, { text: event.target.value })} disabled={locked} className="md:col-span-6 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Resolution or action" /><input value={resolution.owner} onChange={(event) => updateResolution(index, { owner: event.target.value })} disabled={locked} className="md:col-span-3 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Responsible person" /><input type="date" value={resolution.due_date} onChange={(event) => updateResolution(index, { due_date: event.target.value })} disabled={locked} className="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm" /><button type="button" onClick={() => change(() => setResolutions((current) => current.filter((_, itemIndex) => itemIndex !== index)))} disabled={locked} className="md:col-span-1 text-rose-600 disabled:opacity-50" aria-label="Remove resolution"><Trash2 className="w-4 h-4" /></button></div>)}</section>
        </div>

        <div className="space-y-4">
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"><h2 className="font-semibold text-slate-900">5. Signatories</h2>{signatories.map((signatory, index) => <div key={signatory.role} className="rounded-lg bg-slate-50 p-3 space-y-2"><p className="text-xs font-semibold text-slate-600">{signatory.role}</p><input value={signatory.name} onChange={(event) => updateSignatory(index, { name: event.target.value, confirmed: false })} disabled={locked} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder={`${signatory.role} name`} /><label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" checked={signatory.confirmed} onChange={(event) => updateSignatory(index, { confirmed: event.target.checked })} disabled={locked || !signatory.name.trim()} className="mt-0.5" />I confirm these minutes accurately reflect the meeting.</label></div>)}</section>
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"><h2 className="font-semibold text-slate-900">Attachment</h2><p className="text-xs text-slate-500">Add a scanned attendance sheet, signed minutes, image, Word file or PDF.</p><label className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm ${locked ? "opacity-50" : "cursor-pointer"}`}><Upload className="w-4 h-4" />{uploading ? "Uploading..." : "Upload File"}<input type="file" className="hidden" disabled={locked || uploading} accept="image/*,.pdf,.doc,.docx,.txt,.csv" onChange={(event) => void uploadAttachment(event.target.files?.[0] ?? null)} /></label>{selectedMeeting?.minutes_attachment_path && <button type="button" onClick={() => void openAttachment()} className="w-full flex items-center justify-between rounded-lg bg-slate-50 p-3 text-left text-sm"><span className="flex items-center gap-2 min-w-0"><FileText className="w-4 h-4 shrink-0" /><span className="truncate">{selectedMeeting.minutes_attachment_name ?? "Attachment"}</span></span><Download className="w-4 h-4 shrink-0" /></button>}</section>
          <section className={`rounded-xl border p-4 ${selectedMeeting?.minutes_status === "final" ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}><p className="font-semibold text-slate-900">Minutes status: {selectedMeeting?.minutes_status ?? "draft"}</p><p className="text-xs text-slate-600 mt-1">Final minutes are required before the meeting can be closed.</p></section>
        </div>
      </div>
    </div>
  );
}
