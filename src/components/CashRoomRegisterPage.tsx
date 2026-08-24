import { useCallback, useEffect, useMemo, useState } from "react";
import { BedDouble, CheckCircle2, Edit2, RefreshCw, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { businessTodayISO } from "../lib/timezone";

type RoomRow = {
  id: string;
  roomNumber: string;
  rate: number;
  stayId: string | null;
  reservationId: string | null;
  billingMode: string | null;
  actualCheckout: string | null;
  occupied: boolean;
  guestId: string;
  guestName: string;
  discount: string;
  paid: boolean;
  cashEntryOnDate: boolean;
};

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
function dateInTimeZone(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function effectiveRoomRate(room: any): number {
  const roomType = Array.isArray(room.room_types) ? room.room_types[0] : room.room_types;
  return Math.max(0, Number(room.nightly_rate ?? roomType?.base_price ?? 0));
}
function describeSaveError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    const parts = [value.message, value.code ? `Code: ${value.code}` : null, value.details, value.hint ? `Hint: ${value.hint}` : null]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (parts.length) return Array.from(new Set(parts)).join(" · ");
  }
  return String(error || "Unknown error");
}

export function CashRoomRegisterPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [registerDate, setRegisterDate] = useState(businessTodayISO());
  const [rows, setRows] = useState<RoomRow[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"info" | "success" | "error">("info");
  const [occupiedFilter, setOccupiedFilter] = useState<"all" | "occupied" | "vacant">("all");
  const [guestFilter, setGuestFilter] = useState("");
  const [discountFilter, setDiscountFilter] = useState<"all" | "with" | "without">("all");

  const load = useCallback(async () => {
    if (!orgId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const broadStartDate = new Date(`${registerDate}T00:00:00.000Z`); broadStartDate.setUTCDate(broadStartDate.getUTCDate() - 1);
    const broadEndDate = new Date(`${registerDate}T00:00:00.000Z`); broadEndDate.setUTCDate(broadEndDate.getUTCDate() + 2);
    const [roomsResult, staysResult, organizationResult, customersResult, paymentsResult, billingResult] = await Promise.all([
      supabase.from("rooms").select("id,room_number,nightly_rate,status,room_types(base_price)").eq("organization_id", orgId).order("room_number"),
      (supabase as any).from("stays").select("id,room_id,reservation_id,billing_mode,actual_check_in,actual_check_out,room_discount_amount,hotel_customers(id,first_name,last_name)").eq("organization_id", orgId).lt("actual_check_in", broadEndDate.toISOString()).or(`actual_check_out.is.null,actual_check_out.gte.${broadStartDate.toISOString()}`).order("actual_check_in", { ascending: false }),
      supabase.from("organizations").select("hotel_timezone").eq("id", orgId).maybeSingle(),
      supabase.from("hotel_customers").select("id,first_name,last_name").eq("organization_id", orgId).order("first_name").order("last_name"),
      supabase.from("payments").select("stay_id,paid_at").eq("organization_id", orgId).eq("payment_status", "completed").gte("paid_at", broadStartDate.toISOString()).lt("paid_at", broadEndDate.toISOString()),
      supabase.from("billing").select("stay_id,stay_night_date,charged_at").eq("organization_id", orgId).eq("charge_type", "room").gte("charged_at", broadStartDate.toISOString()).lt("charged_at", broadEndDate.toISOString()),
    ]);
    if (roomsResult.error || staysResult.error || billingResult.error) {
      setMessageTone("error");
      setMessage(roomsResult.error?.message || staysResult.error?.message || billingResult.error?.message || "Could not load the room register.");
      setLoading(false); return;
    }
    const timeZone = organizationResult.data?.hotel_timezone || "Africa/Kampala";
    const paidStayIds = new Set(((paymentsResult.data || []) as Array<{ stay_id: string | null; paid_at: string }>).filter((payment) => dateInTimeZone(payment.paid_at, timeZone) === registerDate).map((payment) => payment.stay_id).filter(Boolean));
    const billedStayIds = new Set(((billingResult.data || []) as Array<{ stay_id: string; stay_night_date: string | null; charged_at: string }>).filter((billing) => billing.stay_night_date === registerDate || dateInTimeZone(billing.charged_at, timeZone) === registerDate).map((billing) => billing.stay_id));
    const savedStayIds = new Set([...billedStayIds, ...paidStayIds]);
    setCustomers(((customersResult.data || []) as Array<{ id: string; first_name: string; last_name: string }>).map((customer) => ({ id: customer.id, name: `${customer.first_name} ${customer.last_name}`.trim() })));
    const activeByRoom = new Map<string, any>();
    for (const stay of (staysResult.data || []) as any[]) {
      if (!stay.room_id || dateInTimeZone(stay.actual_check_in, timeZone) > registerDate) continue;
      // Cash Room Register occupancy is strictly daily. A legacy stay shell
      // must never mark another date occupied without that date's transaction.
      if (stay.billing_mode === "cash_register" && !savedStayIds.has(stay.id)) continue;
      // Checkout is an exclusive occupancy boundary: a guest checking out on
      // the 15th occupied through the 14th, not the night of the 15th.
      if (stay.actual_check_out && dateInTimeZone(stay.actual_check_out, timeZone) <= registerDate) continue;
      const current = activeByRoom.get(stay.room_id);
      // Legacy imports can leave more than one cash-register stay overlapping a
      // date. Prefer the stay carrying that date's room bill so saved entries
      // remain editable instead of an orphan shell masking them.
      if (!current || (savedStayIds.has(stay.id) && !savedStayIds.has(current.id))) activeByRoom.set(stay.room_id, stay);
    }
    const next = ((roomsResult.data || []) as any[]).map((room): RoomRow => {
      const stay = activeByRoom.get(room.id);
      const customer = Array.isArray(stay?.hotel_customers) ? stay.hotel_customers[0] : stay?.hotel_customers;
      return {
        id: room.id,
        roomNumber: room.room_number,
        rate: effectiveRoomRate(room),
        stayId: stay?.id || null,
        reservationId: stay?.reservation_id || null,
        billingMode: stay?.billing_mode || null,
        actualCheckout: stay?.actual_check_out || null,
        occupied: Boolean(stay),
        guestId: customer?.id || "",
        guestName: customer ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim() : "",
        discount: String(stay?.room_discount_amount || ""),
        paid: stay ? paidStayIds.has(stay.id) : true,
        cashEntryOnDate: Boolean(stay && savedStayIds.has(stay.id)),
      };
    });
    setRows(next); setLoading(false);
  }, [orgId, registerDate]);

  useEffect(() => { void load(); }, [load]);
  const update = (roomId: string, patch: Partial<RoomRow>) => setRows((current) => current.map((row) => row.id === roomId ? { ...row, ...patch } : row));
  const visibleRows = useMemo(() => {
    const guestNeedle = guestFilter.trim().toLowerCase();
    return rows.filter((row) => {
      if (occupiedFilter === "occupied" && !row.occupied) return false;
      if (occupiedFilter === "vacant" && row.occupied) return false;
      if (guestNeedle && !row.guestName.toLowerCase().includes(guestNeedle)) return false;
      const hasDiscount = Number(row.discount || 0) > 0;
      if (discountFilter === "with" && !hasDiscount) return false;
      if (discountFilter === "without" && hasDiscount) return false;
      return true;
    });
  }, [discountFilter, guestFilter, occupiedFilter, rows]);

  const saveRow = async (row: RoomRow) => {
    if (!orgId || !user?.id) { setMessageTone("error"); setMessage("Your organization session is not ready. Refresh the page and try again."); return; }
    if (row.reservationId || (row.stayId && row.billingMode !== "cash_register")) {
      setMessageTone("error");
      setMessage(`Room ${row.roomNumber} is already occupied through the reservation/check-in workflow. No duplicate was created.`); return;
    }
    if (!row.occupied && !row.stayId) { setMessageTone("error"); setMessage(`Mark room ${row.roomNumber} as occupied before saving the room sale.`); return; }
    if (row.occupied && !row.guestId) { setMessageTone("error"); setMessage(`Select the guest for room ${row.roomNumber}.`); return; }
    const discount = Math.max(0, Number(row.discount || 0));
    if (row.occupied && (row.rate <= 0 || discount >= row.rate)) { setMessageTone("error"); setMessage(`Room ${row.roomNumber} needs a valid rate and a discount lower than the rate.`); return; }
    setSavingId(row.id); setMessageTone("info"); setMessage(`Saving room ${row.roomNumber} for ${registerDate}...`);
    try {
      if (!row.occupied && row.stayId) {
        const correctingCashEntry = row.billingMode === "cash_register" && row.cashEntryOnDate && editingId === row.id;
        const { error } = correctingCashEntry
          ? await (supabase as any).rpc("unmark_cash_room_register_occupied", { p_stay_id: row.stayId, p_register_date: registerDate })
          : await (supabase as any).rpc("hotel_check_out_stay", { p_stay_id: row.stayId, p_checkout_date: registerDate });
        if (error) throw error;
        setMessageTone("success"); setMessage(correctingCashEntry ? `Room ${row.roomNumber}: the incorrect occupied entry and its accounting were reversed.` : `Room ${row.roomNumber} checked out and moved to cleaning.`);
      } else if (row.occupied) {
        const editingSavedDay = row.stayId && row.billingMode === "cash_register" && row.cashEntryOnDate;
        const rpcName = editingSavedDay ? "edit_cash_room_register_entry" : "save_daily_cash_room_register_customer_entry";
        const args = editingSavedDay ? {
          p_stay_id: row.stayId,
          p_customer_id: row.guestId,
          p_register_date: registerDate,
          p_discount: discount,
          p_paid: row.paid,
        } : {
          p_room_id: row.id,
          p_customer_id: row.guestId,
          p_guest_name: row.guestName.trim(),
          p_register_date: registerDate,
          p_discount: discount,
          p_paid: row.paid,
          p_payment_method: "cash",
        };
        const { data, error } = await (supabase as any).rpc(rpcName, args);
        if (error) throw error;
        const result = data as { occupied_by_other_workflow?: boolean } | null;
        if (result?.occupied_by_other_workflow) { setMessageTone("error"); setMessage(`Room ${row.roomNumber} is already checked in elsewhere. It was not duplicated.`); }
        else { setMessageTone("success"); setMessage(`Room ${row.roomNumber}: ${editingSavedDay ? "entry corrected" : `occupancy, room bill${row.paid ? ", and cash payment" : ""} recorded`}.`); }
      }
      setEditingId(null);
      await load();
    } catch (error) {
      setMessageTone("error");
      setMessage(`Room ${row.roomNumber} was not saved for ${registerDate}: ${describeSaveError(error)}`);
    }
    finally { setSavingId(null); }
  };

  if (loading) return <div className="p-6">Loading cash room register...</div>;
  return <div className="p-6 md:p-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><BedDouble className="h-7 w-7 text-emerald-700"/><h1 className="text-3xl font-bold">Cash Room Register</h1></div><p className="mt-2 text-sm text-slate-600">One entry records one room-day. Record every occupied date separately for multi-day guests.</p></div>
      <div className="flex items-end gap-2"><label className="text-sm font-semibold text-slate-700">Register date<input type="date" value={registerDate} onChange={(e)=>setRegisterDate(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 font-normal"/></label><button type="button" onClick={()=>void load()} className="app-btn-secondary"><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    </div>
    {message ? <p role={messageTone === "error" ? "alert" : "status"} aria-live="polite" className={`mb-4 rounded-xl border p-3 text-sm ${messageTone === "error" ? "border-red-300 bg-red-50 font-semibold text-red-900" : messageTone === "success" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>{message}</p> : null}
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Room</th><th className="px-4 py-3 text-center">Occupied</th><th className="px-4 py-3">Guest name</th><th className="px-4 py-3 text-right">Automatic rate</th><th className="px-4 py-3">Discount</th><th className="px-4 py-3 text-right">Net charge</th><th className="px-4 py-3 text-center">Paid cash</th><th className="px-4 py-3">Action</th></tr><tr className="border-t border-slate-200 bg-white normal-case tracking-normal"><th className="px-4 py-2 text-[11px] text-slate-400">{visibleRows.length} of {rows.length} rooms</th><th className="px-4 py-2"><select aria-label="Filter occupied rooms" value={occupiedFilter} onChange={(e)=>setOccupiedFilter(e.target.value as typeof occupiedFilter)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-700"><option value="all">All rooms</option><option value="occupied">Occupied only</option><option value="vacant">Vacant only</option></select></th><th className="px-4 py-2"><input aria-label="Filter by guest name" value={guestFilter} onChange={(e)=>setGuestFilter(e.target.value)} placeholder="Search guest" className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-700"/></th><th/><th className="px-4 py-2"><select aria-label="Filter by discount" value={discountFilter} onChange={(e)=>setDiscountFilter(e.target.value as typeof discountFilter)} className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-normal text-slate-700"><option value="all">All discounts</option><option value="with">With discount</option><option value="without">Without discount</option></select></th><th/><th/><th className="px-4 py-2"><button type="button" onClick={()=>{setOccupiedFilter("all");setGuestFilter("");setDiscountFilter("all");}} className="text-xs font-semibold text-brand-700 hover:underline">Clear filters</button></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{visibleRows.map((row) => {
          const locked = Boolean(row.reservationId || (row.stayId && row.billingMode !== "cash_register"));
          const historicalCheckout = Boolean(row.actualCheckout);
          const editing = editingId === row.id;
          const net = Math.max(0, row.rate - Number(row.discount || 0));
          return <tr key={row.id} className={locked ? "bg-amber-50/50" : ""}><td className="px-4 py-3"><strong>{row.roomNumber}</strong>{locked ? <span className="mt-1 block text-[11px] font-semibold text-amber-700">Existing check-in</span> : row.stayId ? <span className="mt-1 block text-[11px] text-emerald-700">Cash-register stay</span> : null}</td>
            <td className="px-4 py-3 text-center"><input aria-label={`Room ${row.roomNumber} occupied`} type="checkbox" checked={row.occupied} disabled={locked || (Boolean(row.stayId) && row.cashEntryOnDate && !editing)} onChange={(e)=>update(row.id,{occupied:e.target.checked})}/></td>
            <td className="px-4 py-3"><select value={row.guestId} disabled={locked || (Boolean(row.stayId) && row.cashEntryOnDate && !editing)} onChange={(e)=>{const customer=customers.find((item)=>item.id===e.target.value);update(row.id,{guestId:e.target.value,guestName:customer?.name||""});}} className="w-56 rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"><option value="">Select customer</option>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></td>
            <td className="px-4 py-3 text-right"><span className="font-semibold">{money.format(row.rate)}</span><span className="block text-[11px] text-slate-500">Room / room type setup</span></td>
            <td className="px-4 py-3"><input aria-label={`Room ${row.roomNumber} discount`} type="number" min="0" max={row.rate} value={row.discount} disabled={locked || !row.occupied || (Boolean(row.stayId) && row.cashEntryOnDate && !editing)} onChange={(e)=>update(row.id,{discount:e.target.value})} className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-right disabled:bg-slate-100"/></td>
            <td className="px-4 py-3 text-right font-bold text-emerald-700">{money.format(net)}</td>
            <td className="px-4 py-3 text-center"><input aria-label={`Room ${row.roomNumber} paid`} type="checkbox" checked={row.paid} disabled={locked || !row.occupied || (Boolean(row.stayId) && row.cashEntryOnDate && !editing)} onChange={(e)=>update(row.id,{paid:e.target.checked})}/></td>
            <td className="px-4 py-3">{locked ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><CheckCircle2 className="h-4 w-4"/> Reservation check-in</span> : row.stayId && row.billingMode === "cash_register" ? <div className="flex items-center gap-2">{editing ? <><button type="button" disabled={savingId===row.id} onClick={()=>void saveRow(row)} className="app-btn-primary disabled:opacity-40">{savingId===row.id?"Saving...":row.cashEntryOnDate?"Save changes":"Save day"}</button><button type="button" aria-label={`Cancel editing room ${row.roomNumber}`} onClick={()=>{setEditingId(null);void load();}} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4"/></button></> : <><span className={`inline-flex items-center gap-1 text-xs font-semibold ${row.cashEntryOnDate?"text-slate-600":"text-amber-700"}`}><CheckCircle2 className="h-4 w-4"/>{row.cashEntryOnDate?(historicalCheckout?"Occupied on this date":"Saved"):"Incomplete entry"}</span><button type="button" onClick={()=>setEditingId(row.id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Edit2 className="h-3.5 w-3.5"/>Edit</button></>}</div> : <button type="button" disabled={savingId===row.id} onClick={()=>void saveRow(row)} className="app-btn-primary disabled:opacity-40">{savingId===row.id?"Saving...":"Save day"}</button>}</td></tr>;
        })}{visibleRows.length===0?<tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No rooms match these filters.</td></tr>:null}</tbody></table>
    </div>
    <p className="mt-4 text-xs text-slate-500">Each saved room-day checks out automatically before the next date. A four-day stay must be entered on all four dates. Rates load from room setup, and reservation check-ins remain locked to prevent duplicates.</p>
  </div>;
}
