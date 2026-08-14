import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarRange, ClipboardCheck, Gauge, Hammer, Landmark, UsersRound } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { hydrateHotelConfig, loadHotelConfig } from "../lib/hotelConfig";
import { supabase } from "../lib/supabase";
import { fetchAllPages } from "../lib/supabasePagination";

type Area = "blocks" | "rates" | "deposits" | "maintenance" | "inspections" | "close";
type Row = Record<string, any>;
const areaMeta: Array<{ id: Area; label: string; table: string; icon: typeof UsersRound }> = [
  { id: "blocks", label: "Groups & room blocks", table: "hotel_pms_room_blocks", icon: UsersRound },
  { id: "rates", label: "Rates & inventory", table: "hotel_pms_rate_controls", icon: CalendarRange },
  { id: "deposits", label: "Guest deposits", table: "hotel_pms_guest_deposits", icon: Landmark },
  { id: "maintenance", label: "Maintenance", table: "hotel_pms_work_orders", icon: Hammer },
  { id: "inspections", label: "Room inspections", table: "hotel_pms_inspections", icon: ClipboardCheck },
  { id: "close", label: "Period close", table: "hotel_pms_period_closes", icon: Gauge },
];
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);

export function PmsAdvancedPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [enabled, setEnabled] = useState(() => Boolean(loadHotelConfig(orgId).pms_full_enabled));
  const [area, setArea] = useState<Area>("blocks");
  const [rows, setRows] = useState<Row[]>([]);
  const [rooms, setRooms] = useState<Row[]>([]);
  const [roomTypes, setRoomTypes] = useState<Row[]>([]);
  const [customers, setCustomers] = useState<Row[]>([]);
  const [reservations, setReservations] = useState<Row[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ start_date: today(), end_date: today(), service_date: today(), closed_through: today(), minimum_stay: "1", priority: "normal", result: "pass", status: "tentative" });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const meta = areaMeta.find((item) => item.id === area)!;

  useEffect(() => { if (orgId) void hydrateHotelConfig(orgId).then((value) => setEnabled(value.pms_full_enabled === true)); }, [orgId]);

  const load = useCallback(async () => {
    if (!orgId || !enabled) return;
    setLoading(true); setMessage("");
    try {
      const [records, roomRows, typeRows, customerRows, reservationRows] = await Promise.all([
        fetchAllPages((from, to) => (supabase as any).from(meta.table).select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).range(from, to)),
        fetchAllPages((from, to) => supabase.from("rooms").select("id,room_number,room_type_id").eq("organization_id", orgId).order("room_number").range(from, to)),
        fetchAllPages((from, to) => supabase.from("room_types").select("id,name").eq("organization_id", orgId).order("name").range(from, to)),
        fetchAllPages((from, to) => supabase.from("hotel_customers").select("id,first_name,last_name").eq("organization_id", orgId).order("first_name").range(from, to)),
        fetchAllPages((from, to) => supabase.from("reservations").select("id,property_customer_id,check_in_date,check_out_date,status").eq("organization_id", orgId).order("created_at", { ascending: false }).range(from, to)),
      ]);
      setRows(records as Row[]); setRooms(roomRows as Row[]); setRoomTypes(typeRows as Row[]); setCustomers(customerRows as Row[]); setReservations(reservationRows as Row[]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load PMS records."); }
    finally { setLoading(false); }
  }, [area, enabled, meta.table, orgId]);
  useEffect(() => { void load(); }, [load]);

  const roomName = useMemo(() => new Map(rooms.map((room) => [room.id, room.room_number])), [rooms]);
  const typeName = useMemo(() => new Map(roomTypes.map((row) => [row.id, row.name])), [roomTypes]);
  const customerName = useMemo(() => new Map(customers.map((row) => [row.id, `${row.first_name} ${row.last_name}`])), [customers]);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const create = async () => {
    if (!orgId) return;
    const common = { organization_id: orgId, created_by: user?.id ?? null };
    let payload: Row;
    if (area === "blocks") payload = { ...common, name: form.name, group_name: form.group_name || null, room_id: form.room_id || null, start_date: form.start_date, end_date: form.end_date, status: form.status || "tentative", notes: form.notes || null };
    else if (area === "rates") payload = { ...common, room_type_id: form.room_type_id || null, start_date: form.start_date, end_date: form.end_date, nightly_rate: form.nightly_rate ? Number(form.nightly_rate) : null, minimum_stay: Number(form.minimum_stay || 1), stop_sell: form.stop_sell === "true", notes: form.notes || null };
    else if (area === "deposits") payload = { ...common, property_customer_id: form.property_customer_id || null, reservation_id: form.reservation_id || null, amount: Number(form.amount), payment_method: form.payment_method || "cash", reference: form.reference || null };
    else if (area === "maintenance") payload = { ...common, room_id: form.room_id || null, title: form.title, category: form.category || "maintenance", priority: form.priority || "normal", description: form.description || null, due_at: form.due_at || null };
    else if (area === "inspections") payload = { ...common, room_id: form.room_id, service_date: form.service_date, result: form.result || "pass", score: form.score ? Number(form.score) : null, notes: form.notes || null, inspected_by: user?.id ?? null };
    else payload = { organization_id: orgId, closed_through: form.closed_through, notes: form.notes || null, closed_by: user?.id ?? null };
    setMessage("");
    const { error } = await (supabase as any).from(meta.table).insert(payload);
    if (error) return setMessage(error.message);
    setMessage(`${meta.label} record saved.`); await load();
  };

  const updateStatus = async (id: string, status: string) => {
    const patch: Row = { status };
    if (area === "maintenance" && status === "completed") patch.completed_at = new Date().toISOString();
    const { error } = await (supabase as any).from(meta.table).update(patch).eq("id", id).eq("organization_id", orgId);
    if (error) setMessage(error.message); else await load();
  };

  if (!enabled) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-6"><h1 className="text-xl font-bold text-amber-950">Advanced PMS is off</h1><p className="mt-2 text-sm text-amber-800">An administrator can enable it in Settings → Business configuration. Existing front-desk operations continue unchanged.</p></div>;

  return <div className="space-y-5 p-1">
    <div><h1 className="text-2xl font-bold text-slate-900">Advanced PMS</h1><p className="text-sm text-slate-500">Optional controls layered over the existing front desk and billing workflow.</p></div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">{areaMeta.map((item) => { const Icon=item.icon; return <button key={item.id} onClick={()=>setArea(item.id)} className={`rounded-lg border p-3 text-left text-sm ${area===item.id?'border-brand-500 bg-brand-50 text-brand-800':'bg-white text-slate-700'}`}><Icon className="mb-1 h-4 w-4"/>{item.label}</button>; })}</div>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{message}</div>}
    <section className="rounded-xl border bg-white p-5"><h2 className="mb-4 font-semibold">New {meta.label.toLowerCase()}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {area==="blocks" && <><input className={input} placeholder="Block name *" value={form.name||""} onChange={e=>set("name",e.target.value)}/><input className={input} placeholder="Group / company" value={form.group_name||""} onChange={e=>set("group_name",e.target.value)}/><RoomSelect value={form.room_id} rooms={rooms} onChange={v=>set("room_id",v)}/><DateInput label="Arrival" value={form.start_date} onChange={v=>set("start_date",v)}/><DateInput label="Departure" value={form.end_date} onChange={v=>set("end_date",v)}/><select className={input} value={form.status||"tentative"} onChange={e=>set("status",e.target.value)}><option>tentative</option><option>confirmed</option></select></>}
      {area==="rates" && <><select className={input} value={form.room_type_id||""} onChange={e=>set("room_type_id",e.target.value)}><option value="">All room types</option>{roomTypes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><DateInput label="From" value={form.start_date} onChange={v=>set("start_date",v)}/><DateInput label="To" value={form.end_date} onChange={v=>set("end_date",v)}/><input className={input} type="number" min="0" placeholder="Nightly rate" value={form.nightly_rate||""} onChange={e=>set("nightly_rate",e.target.value)}/><input className={input} type="number" min="1" placeholder="Minimum stay" value={form.minimum_stay||"1"} onChange={e=>set("minimum_stay",e.target.value)}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.stop_sell==="true"} onChange={e=>set("stop_sell",String(e.target.checked))}/>Stop sell</label></>}
      {area==="deposits" && <><select className={input} value={form.property_customer_id||""} onChange={e=>set("property_customer_id",e.target.value)}><option value="">Select guest *</option>{customers.map(r=><option key={r.id} value={r.id}>{customerName.get(r.id)}</option>)}</select><select className={input} value={form.reservation_id||""} onChange={e=>set("reservation_id",e.target.value)}><option value="">No reservation</option>{reservations.map(r=><option key={r.id} value={r.id}>{r.check_in_date} → {r.check_out_date} · {customerName.get(r.property_customer_id)||"Guest"}</option>)}</select><input className={input} type="number" min="0.01" placeholder="Amount *" value={form.amount||""} onChange={e=>set("amount",e.target.value)}/><input className={input} placeholder="Payment method" value={form.payment_method||"cash"} onChange={e=>set("payment_method",e.target.value)}/><input className={input} placeholder="Reference" value={form.reference||""} onChange={e=>set("reference",e.target.value)}/></>}
      {area==="maintenance" && <><RoomSelect value={form.room_id} rooms={rooms} onChange={v=>set("room_id",v)}/><input className={input} placeholder="Work order title *" value={form.title||""} onChange={e=>set("title",e.target.value)}/><input className={input} placeholder="Category" value={form.category||"maintenance"} onChange={e=>set("category",e.target.value)}/><select className={input} value={form.priority||"normal"} onChange={e=>set("priority",e.target.value)}><option>low</option><option>normal</option><option>high</option><option>urgent</option></select><input className={input} type="datetime-local" value={form.due_at||""} onChange={e=>set("due_at",e.target.value)}/></>}
      {area==="inspections" && <><RoomSelect value={form.room_id} rooms={rooms} onChange={v=>set("room_id",v)}/><DateInput label="Service date" value={form.service_date} onChange={v=>set("service_date",v)}/><select className={input} value={form.result||"pass"} onChange={e=>set("result",e.target.value)}><option>pass</option><option>rework</option><option>out_of_order</option></select><input className={input} type="number" min="0" max="100" placeholder="Score / 100" value={form.score||""} onChange={e=>set("score",e.target.value)}/></>}
      {area==="close" && <DateInput label="Close through" value={form.closed_through} onChange={v=>set("closed_through",v)}/>} 
      <input className={`${input} md:col-span-2`} placeholder="Notes / description" value={form.notes||form.description||""} onChange={e=>set(area==="maintenance"?"description":"notes",e.target.value)}/>
    </div><button onClick={()=>void create()} className="mt-4 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white">Save record</button></section>
    <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b px-5 py-3 font-semibold">{meta.label}</div>{loading?<div className="p-5 text-sm text-slate-500">Loading…</div>:rows.length===0?<div className="p-5 text-sm text-slate-500">No records yet.</div>:<div className="overflow-x-auto"><table className="min-w-full text-sm"><tbody>{rows.map(row=><tr key={row.id} className="border-b last:border-0"><td className="px-4 py-3 font-medium">{row.name||row.title||roomName.get(row.room_id)||typeName.get(row.room_type_id)||customerName.get(row.property_customer_id)||row.closed_through||"Record"}</td><td className="px-4 py-3 text-slate-600">{row.start_date&&`${row.start_date} → ${row.end_date}`}{row.amount&&Number(row.amount).toLocaleString()}{row.result&&`Result: ${row.result}`}{row.nightly_rate&&`Rate: ${Number(row.nightly_rate).toLocaleString()}`}</td><td className="px-4 py-3">{row.status&&<span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{row.status}</span>}</td><td className="px-4 py-3 text-right">{area==="blocks"&&!["released","cancelled"].includes(row.status)&&<button className="text-brand-700" onClick={()=>void updateStatus(row.id,"released")}>Release</button>}{area==="maintenance"&&row.status!=="completed"&&<button className="text-brand-700" onClick={()=>void updateStatus(row.id,"completed")}>Complete</button>}{area==="deposits"&&row.status==="held"&&<button className="text-brand-700" onClick={()=>void updateStatus(row.id,"applied")}>Mark applied</button>}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}

function RoomSelect({ value, rooms, onChange }: { value?: string; rooms: Row[]; onChange: (value:string)=>void }) { return <select className={input} value={value||""} onChange={e=>onChange(e.target.value)}><option value="">Select room</option>{rooms.map(room=><option key={room.id} value={room.id}>{room.room_number}</option>)}</select>; }
function DateInput({ label, value, onChange }: { label:string; value?:string; onChange:(value:string)=>void }) { return <label className="text-xs text-slate-500">{label}<input className={`${input} mt-1`} type="date" value={value||""} onChange={e=>onChange(e.target.value)}/></label>; }
