import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, Camera, Download, FileCheck2, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

// Practice RPCs are introduced by the accompanying migration before generated Supabase types refresh.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
type QtyKey = "bed_sheets" | "pillow_cases" | "bath_towels" | "hand_towels" | "bath_mats";
type Client = { id: string; name: string; status: string; linked_organization_id: string | null };
type Hotel = { id: string; name: string; business_type: string };
type RoomEntry = { id: string; service_date: string; room_number: string; attendant_name: string; occupancy_observed: string | null; cleaned: boolean; linen_changed: boolean; towels_changed: boolean; bed_sheets: number; pillow_cases: number; bath_towels: number; hand_towels: number; bath_mats: number; missing_items: string | null; notes: string | null; photo_path: string | null; entry_mode: string };
type LaundryMovement = { id: string; movement_date: string; movement_type: "issue" | "return"; bed_sheets: number; pillow_cases: number; bath_towels: number; hand_towels: number; bath_mats: number; notes: string | null; recorded_by_name: string };
type AuditData = { client_name: string; hotel_name: string; total_rooms: number; month_start: string; room_entries: RoomEntry[]; laundry_movements: LaundryMovement[]; generated_at: string };

const ITEMS: { key: QtyKey; label: string }[] = [
  { key: "bed_sheets", label: "Bed sheets" },
  { key: "pillow_cases", label: "Pillow cases" },
  { key: "bath_towels", label: "Bath towels" },
  { key: "hand_towels", label: "Hand towels" },
  { key: "bath_mats", label: "Bath mats" },
];
const sum = <T extends Record<QtyKey, number>>(rows: T[], key: QtyKey) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);

export function PracticeHousekeepingAuditPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [clients, setClients] = useState<Client[]>([]);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [clientId, setClientId] = useState("");
  const [hotelId, setHotelId] = useState("");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadSetup = async () => {
    if (!orgId) return;
    setLoading(true);
    const [clientsResult, hotelsResult] = await Promise.all([
      db.from("practice_clients").select("id,name,status,linked_organization_id").eq("organization_id", orgId).eq("status", "active").order("name"),
      db.rpc("practice_available_hotel_organizations"),
    ]);
    if (clientsResult.error || hotelsResult.error) setMessage(clientsResult.error?.message || hotelsResult.error?.message);
    else {
      const nextClients = clientsResult.data || [];
      setClients(nextClients);
      setHotels(hotelsResult.data || []);
      setClientId((current) => current || nextClients[0]?.id || "");
    }
    setLoading(false);
  };

  useEffect(() => { void loadSetup(); }, [orgId]);
  useEffect(() => {
    const client = clients.find((item) => item.id === clientId);
    setHotelId(client?.linked_organization_id || "");
    setAudit(null);
  }, [clientId, clients]);

  const linkClient = async () => {
    if (!clientId || !hotelId) return;
    setLoading(true);
    const result = await db.rpc("practice_link_hotel_client", { p_client_id: clientId, p_hotel_organization_id: hotelId });
    if (result.error) setMessage(result.error.message);
    else { setMessage("Hotel organization linked to the practice client."); await loadSetup(); }
    setLoading(false);
  };

  const generate = async () => {
    if (!clientId) return;
    setLoading(true); setMessage("");
    const result = await db.rpc("practice_housekeeping_laundry_audit", { p_client_id: clientId, p_month_start: `${month}-01` });
    if (result.error) { setMessage(result.error.message); setAudit(null); }
    else setAudit(result.data as AuditData);
    setLoading(false);
  };

  const controls = useMemo(() => {
    if (!audit) return [];
    return ITEMS.map(({ key, label }) => {
      const consumed = sum(audit.room_entries, key);
      const issued = sum(audit.laundry_movements.filter((row) => row.movement_type === "issue"), key);
      const returned = sum(audit.laundry_movements.filter((row) => row.movement_type === "return"), key);
      return { key, label, consumed, issued, returned, issueVariance: issued - consumed, unreturned: issued - returned };
    });
  }, [audit]);

  const exceptions = useMemo(() => audit?.room_entries.filter((row) => !row.cleaned || !!row.missing_items || !row.occupancy_observed) || [], [audit]);
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const expectedRoomDays = (audit?.total_rooms || 0) * daysInMonth;
  const evidenceCount = audit?.room_entries.filter((row) => row.photo_path).length || 0;
  const coverage = expectedRoomDays ? ((audit?.room_entries.length || 0) / expectedRoomDays) * 100 : 0;

  const openEvidence = async (path: string) => {
    const result = await supabase.storage.from("housekeeping-photos").createSignedUrl(path, 300);
    if (result.error) setMessage(result.error.message); else window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const exportExcel = async () => {
    if (!audit) return;
    const XLSX = await import("xlsx");
    const summary = [
      ["MONTHLY HOUSEKEEPING & LAUNDRY AUDIT PACK"], ["Practice client", audit.client_name], ["Hotel", audit.hotel_name], ["Month", month], ["Generated", audit.generated_at], [],
      ["Rooms configured", audit.total_rooms], ["Expected room-days", expectedRoomDays], ["Room entries", audit.room_entries.length], ["Coverage %", Number(coverage.toFixed(1))], ["Exceptions", exceptions.length], ["Photo evidence", evidenceCount], [],
      ["Item", "Room consumption", "Laundry issued", "Laundry returned", "Issue variance", "Unreturned"],
      ...controls.map((row) => [row.label, row.consumed, row.issued, row.returned, row.issueVariance, row.unreturned]),
    ];
    const detail = audit.room_entries.map((row) => ({ Date: row.service_date, Room: row.room_number, Attendant: row.attendant_name, Occupancy: row.occupancy_observed || "Not observed", Cleaned: row.cleaned ? "Yes" : "No", "Linen changed": row.linen_changed ? "Yes" : "No", "Towels changed": row.towels_changed ? "Yes" : "No", "Bed sheets": row.bed_sheets, "Pillow cases": row.pillow_cases, "Bath towels": row.bath_towels, "Hand towels": row.hand_towels, "Bath mats": row.bath_mats, "Missing items": row.missing_items || "", "Photo evidence": row.photo_path ? "Yes" : "No", Notes: row.notes || "" }));
    const movements = audit.laundry_movements.map((row) => ({ Date: row.movement_date, Type: row.movement_type, "Bed sheets": row.bed_sheets, "Pillow cases": row.pillow_cases, "Bath towels": row.bath_towels, "Hand towels": row.hand_towels, "Bath mats": row.bath_mats, "Recorded by": row.recorded_by_name, Notes: row.notes || "" }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Audit Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Room Detail");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(movements), "Laundry Log");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail.filter((_, index) => exceptions.some((item) => item.id === audit.room_entries[index]?.id))), "Exceptions");
    XLSX.writeFile(wb, `${audit.hotel_name.replace(/[^a-z0-9]+/gi, "_")}_Housekeeping_Audit_${month}.xlsx`);
  };

  const selectedClient = clients.find((item) => item.id === clientId);
  if (loading && clients.length === 0) return <div className="p-8 text-center text-slate-500">Loading audit workspace…</div>;

  return (
    <div className="p-5 md:p-8 space-y-6 print:p-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 print:hidden">
        <div><h1 className="text-3xl font-bold text-slate-900">Monthly Housekeeping & Laundry Audit Pack</h1><p className="text-slate-500">Independent monthly controls over hotel room service, linen consumption, laundry issues and returns.</p></div>
        <div className="flex gap-2"><button type="button" onClick={() => window.print()} disabled={!audit} className="px-4 py-2 border border-slate-300 rounded-lg flex items-center gap-2 disabled:opacity-40"><Printer className="w-4 h-4" />Print</button><button type="button" onClick={() => void exportExcel()} disabled={!audit} className="app-btn-primary flex items-center gap-2 disabled:opacity-40"><Download className="w-4 h-4" />Excel pack</button></div>
      </div>

      {message && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 print:hidden">{message}</div>}
      <div className="bg-white border border-slate-200 rounded-xl p-5 grid md:grid-cols-[1fr_180px_auto] gap-4 items-end print:hidden">
        <label className="text-sm font-medium text-slate-700">Practice client<select value={clientId} onChange={(event) => setClientId(event.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2"><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Audit month<input type="month" value={month} onChange={(event) => { setMonth(event.target.value); setAudit(null); }} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" /></label>
        <button type="button" onClick={() => void generate()} disabled={!clientId || !selectedClient?.linked_organization_id || loading} className="app-btn-primary flex items-center justify-center gap-2 disabled:opacity-40"><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />Generate pack</button>
      </div>

      {selectedClient && !selectedClient.linked_organization_id && <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 print:hidden"><div className="flex items-center gap-2 mb-3"><Building2 className="w-5 h-5 text-blue-700" /><h2 className="font-bold text-slate-900">Link this client to its BOAT hotel</h2></div><div className="flex flex-col md:flex-row gap-3"><select value={hotelId} onChange={(event) => setHotelId(event.target.value)} className="flex-1 border border-blue-300 rounded-lg px-3 py-2 bg-white"><option value="">Select hotel organization</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><button type="button" onClick={() => void linkClient()} disabled={!hotelId} className="px-4 py-2 bg-blue-700 text-white rounded-lg disabled:opacity-40">Link hotel</button></div>{hotels.length === 0 && <p className="mt-3 text-sm text-blue-800">No accessible hotel organizations found. A platform administrator must give this user active membership in the hotel client organization first.</p>}</div>}

      {audit && <>
        <div className="hidden print:block"><h1 className="text-2xl font-bold">Monthly Housekeeping & Laundry Audit Pack</h1><p>{audit.hotel_name} · {month}</p></div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">{[
          ["Rooms", audit.total_rooms], ["Room entries", audit.room_entries.length], ["Coverage", `${coverage.toFixed(1)}%`], ["Exceptions", exceptions.length], ["Photo evidence", evidenceCount],
        ].map(([label, value]) => <div key={String(label)} className="bg-white border border-slate-200 rounded-xl p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold text-slate-900">{value}</p></div>)}</div>

        <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto"><div className="p-4 border-b border-slate-200 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-600" /><h2 className="font-bold text-slate-900">Linen reconciliation controls</h2></div><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50"><tr>{["Item","Room consumption","Laundry issued","Laundry returned","Issue variance","Unreturned"].map((heading) => <th key={heading} className="p-3 text-right first:text-left">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{controls.map((row) => <tr key={row.key}><td className="p-3 font-semibold">{row.label}</td><td className="p-3 text-right">{row.consumed}</td><td className="p-3 text-right">{row.issued}</td><td className="p-3 text-right">{row.returned}</td><td className={`p-3 text-right font-semibold ${row.issueVariance < 0 ? "text-red-600" : row.issueVariance > 0 ? "text-amber-600" : "text-emerald-600"}`}>{row.issueVariance}</td><td className={`p-3 text-right font-semibold ${row.unreturned > 0 ? "text-red-600" : row.unreturned < 0 ? "text-amber-600" : "text-emerald-600"}`}>{row.unreturned}</td></tr>)}</tbody></table></section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden"><div className="p-4 border-b border-slate-200 flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-600" /><div><h2 className="font-bold text-slate-900">Room exceptions</h2><p className="text-xs text-slate-500">Uncleaned rooms, missing items, or absent occupancy observations.</p></div></div>{exceptions.length === 0 ? <div className="p-8 text-center text-emerald-700"><FileCheck2 className="w-8 h-8 mx-auto mb-2" />No room exceptions recorded.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50"><tr>{["Date","Room","Attendant","Occupancy","Cleaned","Missing items","Evidence"].map((heading) => <th key={heading} className="p-3 text-left">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{exceptions.map((row) => <tr key={row.id}><td className="p-3">{row.service_date}</td><td className="p-3 font-semibold">{row.room_number}</td><td className="p-3">{row.attendant_name}</td><td className="p-3">{row.occupancy_observed || "Not observed"}</td><td className="p-3">{row.cleaned ? "Yes" : "No"}</td><td className="p-3 text-red-700">{row.missing_items || "—"}</td><td className="p-3">{row.photo_path ? <button type="button" onClick={() => void openEvidence(row.photo_path!)} className="text-brand-700 flex items-center gap-1 print:hidden"><Camera className="w-4 h-4" />View</button> : "None"}</td></tr>)}</tbody></table></div>}</section>
      </>}
    </div>
  );
}
