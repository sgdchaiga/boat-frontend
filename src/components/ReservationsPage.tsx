import { useEffect, useState } from "react";
import { Edit, LogIn, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { Database } from "../lib/database.types";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";

type Reservation = Database["public"]["Tables"]["reservations"]["Row"] & {
  hotel_customers: { id: string; first_name: string; last_name: string } | null;
  rooms: { id: string; room_number: string } | null;
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

export function ReservationsPage() {

  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [hotelCustomers, setHotelCustomers] = useState<PropertyCustomer[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);

  const [form, setForm] = useState({
    property_customer_id: "",
    room_id: "",
    check_in_date: "",
    check_out_date: "",
    status: "confirmed"
  });

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [savingReservation, setSavingReservation] = useState(false);

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
        const today = new Date().toISOString().slice(0, 10);
        const [resRes, custRes] = await Promise.all([
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
        created_at,
        hotel_customers(id, first_name, last_name),
        rooms(id, room_number)
      `
              )
              .order("check_in_date", { ascending: true }),
            orgId,
            superAdmin
          ),
          filterByOrganizationId(
            supabase.from("hotel_customers").select("id,first_name,last_name").order("first_name"),
            orgId,
            superAdmin
          ),
        ]);
        if (cancelled) return;
        if (resRes.error) throw resRes.error;
        const resData = (resRes.data || []) as Reservation[];
        setReservations(resData);
        setHotelCustomers(custRes.data || []);

        const reservedRoomIds = new Set<string>();
        for (const r of resData) {
          if (
            r.room_id &&
            ["pending", "confirmed", "checked_in"].includes(r.status) &&
            r.check_out_date >= today
          ) {
            reservedRoomIds.add(r.room_id);
          }
        }
        let roomQuery = filterByOrganizationId(
          supabase
            .from("rooms")
            .select("id,room_number, status")
            .eq("status", "available")
            .order("room_number"),
          orgId,
          superAdmin
        );
        if (reservedRoomIds.size > 0) {
          roomQuery = roomQuery.not("id", "in", `(${[...reservedRoomIds].join(",")})`);
        }
        const { data: roomData, error: roomErr } = await roomQuery;
        if (roomErr) throw roomErr;
        setRooms(roomData || []);
      } catch (e) {
        console.error("Reservations load error:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, superAdmin]);

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

  /** Room picker: small reservation query + available rooms (avoids stale React state after saves). */
  const fetchRooms = async () => {
    if (!orgId && !superAdmin) {
      setRooms([]);
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const { data: reservationsData } = await filterByOrganizationId(
      supabase
        .from("reservations")
        .select("room_id, check_out_date, status")
        .in("status", ["pending", "confirmed", "checked_in"])
        .gte("check_out_date", today),
      orgId,
      superAdmin
    );
    const reservedRoomIds = new Set(
      (reservationsData || []).map((r) => r.room_id).filter(Boolean) as string[]
    );

    let query = filterByOrganizationId(
      supabase
        .from("rooms")
        .select("id,room_number, status")
        .eq("status", "available")
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
    setRooms(data || []);
  };

  /* -------------------- */
  /* ADD RESERVATION */
  /* -------------------- */

  const openNewReservation = async () => {

     await fetchRooms();

    setEditingReservation(null);

    setForm({
      property_customer_id: "",
      room_id: "",
      check_in_date: "",
      check_out_date: "",
      status: "confirmed"
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
      status: reservation.status
    });

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

    setSavingReservation(true);
    try {

      if (editingReservation) {
        await filterByOrganizationId(
          supabase
            .from("reservations")
            .update(form)
            .eq("id", editingReservation.id),
          orgId,
          superAdmin
        );
      } else {
        await supabase
          .from("reservations")
          .insert({
            ...form,
            organization_id: orgId ?? null,
          });
      }

      setShowForm(false);
      fetchReservations();

    } catch (err) {

      console.error(err);
      alert("Failed to save reservation");

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

      const insertPayload: Record<string, unknown> = {
        reservation_id: reservation.id,
        property_customer_id: reservation.property_customer_id,
        room_id: reservation.room_id,
        check_in_time: new Date().toISOString(),
        organization_id: orgId ?? null,
      };
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id")
        .eq("id", user.id)
        .eq("organization_id", orgId ?? "")
        .maybeSingle();
      if (staffRow?.id) insertPayload.checked_in_by = staffRow.id;

      const { error } = await supabase
        .from("stays")
        .insert(insertPayload);

      if (error) throw error;

      await filterByOrganizationId(
        supabase
          .from("reservations")
          .update({ status: "checked_in" })
          .eq("id", reservation.id),
        orgId,
        superAdmin
      );

      await filterByOrganizationId(
        supabase
          .from("rooms")
          .update({ status: "occupied" })
          .eq("id", reservation.room_id),
        orgId,
        superAdmin
      );

      fetchReservations();

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

        <button
          onClick={openNewReservation}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"
        >
          <Plus size={18} />
          New Reservation
        </button>

      </div>

      {/* RESERVATIONS LIST */}

      <div className="space-y-4">

        {reservations.map((reservation) => (

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
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  Room {r.room_number}
                </option>
              ))}
            </select>

            {/* DATES */}

            <input
              type="date"
              value={form.check_in_date}
              onChange={(e) => {
                setForm({ ...form, check_in_date: e.target.value });
                void fetchRooms();
              }}
              className="w-full border p-2 rounded"
            />

            <input
              type="date"
              value={form.check_out_date}
              onChange={(e) =>
                setForm({ ...form, check_out_date: e.target.value })
              }
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