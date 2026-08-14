import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit, LogIn, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { Database } from "../lib/database.types";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { desktopApi } from "../lib/desktopApi";

type Reservation = Database["public"]["Tables"]["reservations"]["Row"] & {
  hotel_customers: { id: string; first_name: string; last_name: string } | null;
  rooms: { id: string; room_number: string } | null;
  room_discount_amount?: number | null;
  room_discount_reason?: string | null;
};

type PropertyCustomer = {
  id: string;
  first_name: string;
  last_name: string;
};

type Room = {
  id: string;
  room_number: string;
  status?: string;
};
type RatePlan = { id: string; code: string; name: string; includes_breakfast: boolean };

function supabaseErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const row = error as { message?: string; details?: string; hint?: string; code?: string };
    return [row.message, row.details, row.hint, row.code].filter(Boolean).join(" · ");
  }
  return String(error || "Failed to save reservation");
}

function isMissingBreakfastSchema(error: unknown): boolean {
  const message = supabaseErrorMessage(error);
  return /rate_plan_id|number_of_adults|number_of_children|hotel_rate_plans|schema cache/i.test(message)
    || /PGRST204|42703|42P01/i.test(message);
}

export function ReservationsPage() {

  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const localAuthEnabled = ["true", "1", "yes"].includes(
    (import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase()
  );
  const useDesktopLocalCustomers = localAuthEnabled && desktopApi.isAvailable();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [hotelCustomers, setHotelCustomers] = useState<PropertyCustomer[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);

  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);

  const [form, setForm] = useState({
    property_customer_id: "",
    room_id: "",
    check_in_date: "",
    check_out_date: "",
    status: "confirmed",
    room_discount_amount: "",
    room_discount_reason: "",
    rate_plan_id: "",
    number_of_adults: "1",
    number_of_children: "0",
  });

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [savingReservation, setSavingReservation] = useState(false);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRoom, setFilterRoom] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const filteredReservations = useMemo(() => reservations.filter((reservation) => {
    const q = filterSearch.trim().toLowerCase();
    const label = `${reservation.hotel_customers?.first_name || ""} ${reservation.hotel_customers?.last_name || ""} ${reservation.rooms?.room_number || ""}`.toLowerCase();
    if (q && !label.includes(q)) return false;
    if (filterStatus !== "all" && reservation.status !== filterStatus) return false;
    if (filterRoom !== "all" && reservation.room_id !== filterRoom) return false;
    if (filterFrom && reservation.check_out_date < filterFrom) return false;
    if (filterTo && reservation.check_in_date > filterTo) return false;
    return true;
  }), [reservations, filterSearch, filterStatus, filterRoom, filterFrom, filterTo]);

  const fetchHotelCustomers = useCallback(async (): Promise<PropertyCustomer[]> => {
    if (useDesktopLocalCustomers) {
      return ((await desktopApi.listCustomers()) || []) as PropertyCustomer[];
    }
    const { data, error } = await filterByOrganizationId(
      supabase.from("hotel_customers").select("id,first_name,last_name").order("first_name").limit(1000),
      orgId,
      superAdmin
    );
    if (error) throw error;
    return (data || []) as PropertyCustomer[];
  }, [orgId, superAdmin, useDesktopLocalCustomers]);

  const createBedBreakfastRatePlan = async () => {
    if (!orgId) return;
    const name = window.prompt("Bed & Breakfast rate plan name", "Bed & Breakfast");
    if (!name?.trim()) return;
    const code = window.prompt("Rate plan code", "BB");
    if (!code?.trim()) return;
    const adultAllocation = Number(window.prompt("Breakfast revenue allocation per eligible adult", "0") || 0);
    const childAllocation = Number(window.prompt("Breakfast revenue allocation per eligible child", "0") || 0);
    if (adultAllocation < 0 || childAllocation < 0) return alert("Allocations cannot be negative.");
    const { data, error } = await (supabase as any).from("hotel_rate_plans").insert({
      organization_id: orgId, code: code.trim().toUpperCase(), name: name.trim(), includes_breakfast: true,
      breakfast_allocation_adult: adultAllocation, breakfast_allocation_child: childAllocation,
      adults_eligible: true, children_eligible: true, created_by: user?.id ?? null,
    }).select("id,code,name,includes_breakfast").single();
    if (error) return alert(error.message || "Could not create rate plan.");
    setRatePlans((plans) => [...plans, data as RatePlan].sort((a,b) => a.name.localeCompare(b.name)));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!orgId && !superAdmin) {
          setReservations([]);
          setHotelCustomers([]);
          setRooms([]);
          return;
        }
        const [initialResRes, customerRows] = await Promise.all([
          filterByOrganizationId(
            supabase
              .from("reservations")
              .select(
              `
        id,
        property_customer_id,
        room_id,
        check_in_date,
        check_out_date,
        status,
        rate_plan_id,
        number_of_adults,
        number_of_children,
        room_discount_amount,
        room_discount_reason,
        created_at,
        hotel_customers(id, first_name, last_name),
        rooms(id, room_number)
      `
              )
              .gte("check_out_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
              .order("check_in_date", { ascending: true })
              .limit(500),
            orgId,
            superAdmin
          ),
          fetchHotelCustomers(),
        ]);
        if (cancelled) return;
        setHotelCustomers(customerRows);
        let resRes = initialResRes;
        if (resRes.error) {
          // Older hotel databases may not yet have the optional B&B columns.
          // Keep the core front desk usable while the migration is pending.
          resRes = await filterByOrganizationId(
            supabase
              .from("reservations")
              .select("id,property_customer_id,room_id,check_in_date,check_out_date,status,room_discount_amount,room_discount_reason,created_at,hotel_customers(id,first_name,last_name),rooms(id,room_number)")
              .gte("check_out_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
              .order("check_in_date", { ascending: true })
              .limit(500),
            orgId,
            superAdmin
          );
        }
        if (resRes.error) throw resRes.error;
        const resData = (resRes.data || []) as Reservation[];
        setReservations(resData);
        const roomQuery = filterByOrganizationId(
          supabase
            .from("rooms")
            .select("id,room_number, status")
            .order("room_number"),
          orgId,
          superAdmin
        );
        const { data: roomData, error: roomErr } = await roomQuery;
        if (roomErr) throw roomErr;
        setRooms(((roomData || []) as Room[]).filter((room) => room.status !== "maintenance"));

        // Rate plans are optional front-desk enrichment. Do not delay or fail
        // the core reservations and rooms UI when that migration is absent.
        void filterByOrganizationId(
          (supabase as any).from("hotel_rate_plans").select("id,code,name,includes_breakfast").eq("is_active", true).order("name"),
          orgId,
          superAdmin
        ).then((plansRes: { data?: unknown[] | null; error?: unknown }) => {
          if (!cancelled && !plansRes.error) setRatePlans((plansRes.data || []) as RatePlan[]);
        });
      } catch (e) {
        console.error("Reservations load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, superAdmin, fetchHotelCustomers]);

  /* -------------------- */
  /* LOAD DATA */
  /* -------------------- */

  const fetchReservations = async () => {
    if (!orgId && !superAdmin) {
      setReservations([]);
      return;
    }
    const { data, error } = await filterByOrganizationId(
      supabase
        .from("reservations")
        .select(
        `
        id,
        property_customer_id,
        room_id,
        check_in_date,
        check_out_date,
        status,
        rate_plan_id,
        number_of_adults,
        number_of_children,
        room_discount_amount,
        room_discount_reason,
        created_at,
        hotel_customers(id, first_name, last_name),
        rooms(id, room_number)
      `
        )
        .order("check_in_date", { ascending: true }),
      orgId,
      superAdmin
    );

    if (!error) setReservations((data || []) as Reservation[]);
  };

  /** Load rooms that are free for the requested date range. */
  const fetchRooms = async (
    checkInDate = "",
    checkOutDate = "",
    excludedReservationId?: string
  ) => {
    if (!orgId && !superAdmin) {
      setRooms([]);
      return;
    }
    let reservationsData: Array<{ id: string; room_id: string | null }> = [];
    if (checkInDate && checkOutDate && checkOutDate > checkInDate) {
      let reservationQuery = filterByOrganizationId(
        supabase
          .from("reservations")
          .select("id, room_id")
          .in("status", ["pending", "confirmed", "checked_in"])
          .lt("check_in_date", checkOutDate)
          .gt("check_out_date", checkInDate),
        orgId,
        superAdmin
      );
      if (excludedReservationId) reservationQuery = reservationQuery.neq("id", excludedReservationId);
      const reservationResult = await reservationQuery;
      if (reservationResult.error) {
        console.error("Room availability load error:", reservationResult.error);
        return;
      }
      reservationsData = reservationResult.data || [];
    }
    const reservedRoomIds = new Set(
      (reservationsData || []).map((r) => r.room_id).filter(Boolean) as string[]
    );
    // Covers walk-ins and legacy stays that may not have a reservation row.
    if (checkInDate && checkOutDate && checkOutDate > checkInDate) {
      const activeStaysResult = await filterByOrganizationId(
        supabase.from("stays").select("room_id").is("actual_check_out", null),
        orgId,
        superAdmin
      );
      if (!activeStaysResult.error) {
        for (const stay of activeStaysResult.data || []) {
          if (stay.room_id) reservedRoomIds.add(stay.room_id);
        }
      }
    }

    let query = filterByOrganizationId(
      supabase
        .from("rooms")
        .select("id,room_number, status")
        .order("room_number"),
      orgId,
      superAdmin
    );
    if (reservedRoomIds.size > 0) {
      query = query.not("id", "in", `(${[...reservedRoomIds].join(",")})`);
    }
    const { data, error } = await query;

    if (error) {
      console.error("Rooms load error:", error);
      return;
    }
    setRooms(((data || []) as Room[]).filter((room) => room.status !== "maintenance"));
  };

  /* -------------------- */
  /* ADD RESERVATION */
  /* -------------------- */

  const openNewReservation = async () => {

    const [, customerRows] = await Promise.all([fetchRooms(), fetchHotelCustomers()]);
    setHotelCustomers(customerRows);

    setEditingReservation(null);

    setForm({
      property_customer_id: "",
      room_id: "",
      check_in_date: "",
      check_out_date: "",
      status: "confirmed",
      room_discount_amount: "",
      room_discount_reason: "",
      rate_plan_id: "",
      number_of_adults: "1",
      number_of_children: "0",
    });

    setShowForm(true);
  };

  /* -------------------- */
  /* EDIT RESERVATION */
  /* -------------------- */

  const handleEdit = (reservation: Reservation) => {

    setEditingReservation(reservation);

    setForm({
      property_customer_id: reservation.property_customer_id ?? "",
      room_id: reservation.room_id ?? "",
      check_in_date: reservation.check_in_date,
      check_out_date: reservation.check_out_date,
      status: reservation.status,
      room_discount_amount: reservation.room_discount_amount ? String(reservation.room_discount_amount) : "",
      room_discount_reason: reservation.room_discount_reason ?? "",
      rate_plan_id: String((reservation as any).rate_plan_id || ""),
      number_of_adults: String((reservation as any).number_of_adults ?? 1),
      number_of_children: String((reservation as any).number_of_children ?? 0),
    });

    void fetchRooms(reservation.check_in_date, reservation.check_out_date, reservation.id);

    setShowForm(true);
  };

  /* -------------------- */
  /* SAVE RESERVATION */
  /* -------------------- */

  const saveReservation = async () => {
    if (savingReservation) return;

    if (!form.property_customer_id || !form.room_id) {
      alert("Select customer and room");
      return;
    }
    if (!form.check_in_date || !form.check_out_date || form.check_out_date <= form.check_in_date) {
      alert("Select valid check-in and check-out dates");
      return;
    }

    setSavingReservation(true);
    try {

      const discountAmount = Math.max(0, Number(form.room_discount_amount || 0) || 0);
      const payload = {
        property_customer_id: form.property_customer_id,
        room_id: form.room_id,
        check_in_date: form.check_in_date,
        check_out_date: form.check_out_date,
        status: form.status,
        room_discount_amount: discountAmount,
        room_discount_reason: form.room_discount_reason.trim() || null,
        rate_plan_id: form.rate_plan_id || null,
        number_of_adults: Math.max(0, Number.parseInt(form.number_of_adults, 10) || 0),
        number_of_children: Math.max(0, Number.parseInt(form.number_of_children, 10) || 0),
      };
      const legacyPayload = {
        property_customer_id: payload.property_customer_id,
        room_id: payload.room_id,
        check_in_date: payload.check_in_date,
        check_out_date: payload.check_out_date,
        status: payload.status,
        room_discount_amount: payload.room_discount_amount,
        room_discount_reason: payload.room_discount_reason,
      };

      if (editingReservation) {
        let { error } = await filterByOrganizationId(
          supabase
            .from("reservations")
            .update(payload)
            .eq("id", editingReservation.id),
          orgId,
          superAdmin
        );
        if (error && isMissingBreakfastSchema(error) && !form.rate_plan_id) {
          ({ error } = await filterByOrganizationId(
            supabase.from("reservations").update(legacyPayload).eq("id", editingReservation.id),
            orgId,
            superAdmin
          ));
        }
        if (error) throw error;
      } else {
        let { error } = await supabase
          .from("reservations")
          .insert({
            ...payload,
            organization_id: orgId ?? null,
          });
        if (error && isMissingBreakfastSchema(error) && !form.rate_plan_id) {
          ({ error } = await supabase.from("reservations").insert({
            ...legacyPayload,
            organization_id: orgId ?? null,
          }));
        }
        if (error) throw error;
      }

      setShowForm(false);
      await fetchReservations();

    } catch (err) {
      console.error("Reservation save error:", err);
      const message = supabaseErrorMessage(err);
      alert(isMissingBreakfastSchema(err) && form.rate_plan_id
        ? `Bed & Breakfast is not available until the hotel B&B database migration is applied. ${message}`
        : message);

    } finally {
      setSavingReservation(false);
    }

  };

  /* -------------------- */
  /* CHECK IN */
  /* -------------------- */

  const handleCheckIn = async (reservation: Reservation) => {

    if (!user?.id || !reservation.property_customer_id || !reservation.room_id) {
      alert("Reservation missing customer or room");
      return;
    }

    setProcessingId(reservation.id);

    try {
      const { error } = await supabase.rpc("hotel_check_in_reservation", {
        p_reservation_id: reservation.id,
        p_actual_check_in: new Date().toISOString(),
      });
      if (error) throw error;
      await fetchReservations();

    } catch (err: unknown) {

      const msg = err && typeof err === "object" && "message" in err
        ? String((err as { message?: string }).message)
        : "Check-in failed";
      console.error("Check-in error:", err);
      alert(msg);

    } finally {

      setProcessingId(null);

    }

  };

  /* -------------------- */

  if (loading) return <div className="p-6">Loading...</div>;

  return (

    <div className="p-6 md:p-8">

      {/* HEADER */}

      <div className="flex justify-between mb-6">

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">Reservations</h1>
            <PageNotes ariaLabel="Reservations help">
              <p>Manage guest bookings.</p>
            </PageNotes>
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => void createBedBreakfastRatePlan()} className="border border-amber-600 text-amber-800 px-4 py-2 rounded-lg">Create B&amp;B Rate Plan</button>
          <button
            onClick={openNewReservation}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <Plus size={18} />
            New Reservation
          </button>
        </div>

      </div>

      {/* RESERVATIONS LIST */}

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="min-w-52 flex-1 text-xs font-medium text-slate-600">Guest or room<input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} placeholder="Search guest or room" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">Status<select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="all">All statuses</option><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="checked_in">Checked in</option><option value="checked_out">Checked out</option><option value="cancelled">Cancelled</option></select></label>
        <label className="text-xs font-medium text-slate-600">Room<select value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="all">All rooms</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.room_number}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Staying from<input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-xs font-medium text-slate-600">Staying to<input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <button type="button" onClick={() => { setFilterSearch(""); setFilterStatus("all"); setFilterRoom("all"); setFilterFrom(""); setFilterTo(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Clear</button>
        <p className="w-full text-xs text-slate-500">Showing {filteredReservations.length} of {reservations.length} reservations</p>
      </div>

      <div className="space-y-4">

        {filteredReservations.map((reservation) => (

          <div
            key={reservation.id}
            className="bg-white border rounded-xl p-6 flex justify-between items-center"
          >

            <div>

              <h3 className="font-bold text-lg">
                {reservation.hotel_customers
                  ? `${reservation.hotel_customers.first_name} ${reservation.hotel_customers.last_name}`
                  : "Guest"}
              </h3>

              <p className="text-sm text-slate-500">
                Room {reservation.rooms?.room_number}
              </p>

              <p className="text-sm text-slate-500">
                {reservation.check_in_date} → {reservation.check_out_date}
              </p>

              <p className="text-sm text-slate-500">
                Status: {reservation.status}
              </p>
              {(reservation as any).rate_plan_id ? (
                <p className="text-sm text-amber-700">
                  Rate plan: {ratePlans.find((p) => p.id === (reservation as any).rate_plan_id)?.name || "Package"}
                  {ratePlans.find((p) => p.id === (reservation as any).rate_plan_id)?.includes_breakfast ? " · Breakfast included" : ""}
                </p>
              ) : null}

              {Number(reservation.room_discount_amount || 0) > 0 ? (
                <p className="text-sm text-emerald-700">
                  Room discount/night: {Number(reservation.room_discount_amount || 0).toFixed(2)}
                  {reservation.room_discount_reason ? ` - ${reservation.room_discount_reason}` : ""}
                </p>
              ) : null}

            </div>

            <div className="flex gap-3">

              <button
                onClick={() => handleEdit(reservation)}
                className="bg-slate-200 px-4 py-2 rounded-lg flex items-center gap-2"
              >
                <Edit size={16} />
                Edit
              </button>

              {reservation.status === "confirmed" && (

                <button
                  onClick={() => handleCheckIn(reservation)}
                  disabled={processingId === reservation.id}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  <LogIn size={16} />
                  {processingId === reservation.id ? "Processing..." : "Check In"}
                </button>

              )}

            </div>

          </div>

        ))}

        {filteredReservations.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
            No reservations match these filters.
          </div>
        )}

      </div>

      {/* RESERVATION FORM */}

      {showForm && (

        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">

          <div className="bg-white p-6 rounded-xl w-[400px] space-y-4">

            <h2 className="text-xl font-bold">
              {editingReservation ? "Edit Reservation" : "New Reservation"}
            </h2>

            {/* GUEST */}

            <select
              value={form.property_customer_id}
              onChange={(e) =>
                setForm({ ...form, property_customer_id: e.target.value })
              }
              className="w-full border p-2 rounded"
            >
              <option value="">Select Guest</option>
              {hotelCustomers.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.first_name} {g.last_name}
                </option>
              ))}
            </select>

            {/* ROOM */}

            <select
              value={form.room_id}
              onChange={(e) =>
                setForm({ ...form, room_id: e.target.value })
              }
              className="w-full border p-2 rounded"
            >
              <option value="">Select Room</option>
              {rooms.length === 0 ? <option value="" disabled>No rooms available for these dates</option> : null}
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.room_number}
                </option>
              ))}
            </select>

            <select value={form.rate_plan_id} onChange={(e) => setForm({ ...form, rate_plan_id: e.target.value })} className="w-full border p-2 rounded">
              <option value="">Room only / no rate plan</option>
              {ratePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.code} · {plan.name}{plan.includes_breakfast ? " (Breakfast included)" : ""}</option>)}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">Adults<input type="number" min="0" value={form.number_of_adults} onChange={(e) => setForm({ ...form, number_of_adults: e.target.value })} className="mt-1 w-full border p-2 rounded" /></label>
              <label className="text-xs text-slate-600">Children<input type="number" min="0" value={form.number_of_children} onChange={(e) => setForm({ ...form, number_of_children: e.target.value })} className="mt-1 w-full border p-2 rounded" /></label>
            </div>

            {/* DATES */}

            <input
              type="date"
              value={form.check_in_date}
              onChange={(e) => {
                const checkInDate = e.target.value;
                setForm({ ...form, check_in_date: checkInDate, room_id: "" });
                void fetchRooms(checkInDate, form.check_out_date, editingReservation?.id);
              }}
              className="w-full border p-2 rounded"
            />

            <input
              type="date"
              value={form.check_out_date}
              onChange={(e) => {
                const checkOutDate = e.target.value;
                setForm({ ...form, check_out_date: checkOutDate, room_id: "" });
                void fetchRooms(form.check_in_date, checkOutDate, editingReservation?.id);
              }}
              className="w-full border p-2 rounded"
            />

            <input
              type="number"
              min="0"
              step="0.01"
              value={form.room_discount_amount}
              onChange={(e) => setForm({ ...form, room_discount_amount: e.target.value })}
              placeholder="Room discount per night"
              className="w-full border p-2 rounded"
            />

            <input
              type="text"
              value={form.room_discount_reason}
              onChange={(e) => setForm({ ...form, room_discount_reason: e.target.value })}
              placeholder="Discount reason"
              className="w-full border p-2 rounded"
            />

            {/* BUTTONS */}

            <div className="flex justify-end gap-3">

              <button
                onClick={() => setShowForm(false)}
                disabled={savingReservation}
                className="px-4 py-2 border rounded"
              >
                Cancel
              </button>

              <button
                onClick={saveReservation}
                disabled={savingReservation}
                className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-60"
              >
                {savingReservation ? "Saving..." : "Save"}
              </button>

            </div>

          </div>

        </div>

      )}

    </div>

  );
}
