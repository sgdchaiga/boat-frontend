import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { Database } from "../lib/database.types";

type Reservation = Database["public"]["Tables"]["reservations"]["Row"] & {
  guests: { id: string; first_name: string; last_name: string } | null;
  rooms: { id: string; room_number: string } | null;
};

export function CheckInPage() {

  const { staff } = useAuth();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  /* ---------------------- */
  /* LOAD RESERVATIONS      */
  /* ---------------------- */

  useEffect(() => {
    fetchReservations();
  }, []);

  const fetchReservations = async () => {

    try {

      const { data, error } = await supabase
        .from("reservations")
        .select(`
          *,
          guests(id,first_name,last_name),
          rooms(id,room_number)
        `)
        .eq("status", "confirmed")
        .order("check_in_date", { ascending: true });

      if (error) throw error;

      setReservations(data || []);

    } catch (error) {

      console.error("Reservation load error:", error);

    } finally {

      setLoading(false);

    }

  };

  /* ---------------------- */
  /* CHECK IN FUNCTION      */
  /* ---------------------- */

  const handleCheckIn = async (reservation: Reservation) => {

    if (!staff?.id || !reservation.guests || !reservation.rooms) {
      alert("Reservation missing guest or room");
      return;
    }

    setProcessingId(reservation.id);

    try {

      /* Create stay */

      const { error: stayError } = await supabase
        .from("stays")
        .insert({
          reservation_id: reservation.id,
          property_customer_id: reservation.hotel_customers?.id,
          room_id: reservation.rooms.id,
          check_in_time: new Date().toISOString(),
          checked_in_by: staff.id
        });

      if (stayError) throw stayError;

      /* Update reservation */

      const { error: reservationError } = await supabase
        .from("reservations")
        .update({ status: "checked_in" })
        .eq("id", reservation.id);

      if (reservationError) throw reservationError;

      /* Update room */

      const { error: roomError } = await supabase
        .from("rooms")
        .update({ status: "occupied" })
        .eq("id", reservation.rooms.id);

      if (roomError) throw roomError;

      fetchReservations();

    } catch (error) {

      console.error("Check-in failed:", error);
      alert("Check-in failed");

    } finally {

      setProcessingId(null);

    }

  };

  /* ---------------------- */

  if (loading) {
    return <div className="p-6">Loading reservations...</div>;
  }

  return (
    <div className="p-6 md:p-8">

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Check-In</h1>
        <p className="text-slate-600">Guests waiting to check in</p>
      </div>

      <div className="space-y-4">

        {reservations.map((reservation) => (

          <div
            key={reservation.id}
            className="bg-white border rounded-xl p-6 flex justify-between items-center"
          >

            <div>

              <h3 className="text-lg font-bold">
                {reservation.guests
                  ? `${reservation.guests.first_name} ${reservation.guests.last_name}`
                  : "Unknown Guest"}
              </h3>

              <p className="text-sm text-slate-500">
                Room {reservation.rooms?.room_number || "Not assigned"}
              </p>

              <p className="text-sm text-slate-500">
                Arrival {reservation.check_in_date}
              </p>

            </div>

            <button
              onClick={() => handleCheckIn(reservation)}
              disabled={!staff || processingId === reservation.id}
              className="bg-slate-800 text-white px-4 py-2 rounded-lg"
            >
              {processingId === reservation.id
                ? "Processing..."
                : "Check In"}
            </button>

          </div>

        ))}

      </div>

      {reservations.length === 0 && (
        <div className="text-center py-12 text-slate-500">
          No reservations waiting for check-in
        </div>
      )}

    </div>
  );
}