import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import type { Database } from "../lib/database.types";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";

type Reservation = Database["public"]["Tables"]["reservations"]["Row"] & {
  hotel_customers: { id: string; first_name: string; last_name: string } | null;
  rooms: { id: string; room_number: string } | null;
};

export function CheckInPage() {

  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  /* ---------------------- */
  /* LOAD RESERVATIONS      */
  /* ---------------------- */

  useEffect(() => {
    fetchReservations();
  }, [orgId, superAdmin]);

  const fetchReservations = async () => {

    setLoading(true);

    try {
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
          .in("status", ["pending", "confirmed"])
          .order("check_in_date", { ascending: true }),
        orgId,
        superAdmin
      );

      if (error) throw error;

      setReservations((data as Reservation[]) || []);

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

    if (!user?.id || !reservation.property_customer_id || !reservation.room_id) {
      alert("Reservation missing guest or room");
      return;
    }
    if (!orgId) {
      alert("Your account must be linked to a hotel organization to check in guests.");
      return;
    }

    setProcessingId(reservation.id);

    try {

      /* Check if already checked in */

      const { data: existingStay } = await filterByOrganizationId(
        supabase
          .from("stays")
          .select("id")
          .eq("reservation_id", reservation.id),
        orgId,
        superAdmin
      ).maybeSingle();

      if (existingStay) {
        alert("Guest already checked in");
       setProcessingId(null);
        return;
      }

      /* Create stay */

      const { data: stayRow, error: stayError } = await supabase
        .from("stays")
        .insert({
          reservation_id: reservation.id,
          property_customer_id: reservation.property_customer_id,
          room_id: reservation.room_id,
          actual_check_in: new Date().toISOString(),
          checked_in_by: user.id,
          organization_id: orgId ?? null,
        })
        .select("id")
        .single();

      if (stayError) throw stayError;
      if (!stayRow?.id) throw new Error("Stay was not created");

      if (user.hotel_enable_smart_room_charges !== false) {
        const { data: folioRpc, error: folioErr } = await supabase.rpc("post_hotel_room_night_charge", {
          p_organization_id: orgId,
          p_stay_id: stayRow.id,
          p_source: "checkin",
          p_created_by: user.id,
        });

        if (folioErr) {
          console.error("First-night folio RPC:", folioErr);
          throw new Error(
            `Guest checked in, but the first-night room charge failed: ${folioErr.message}. Fix room rate / journal settings, then use Billing → Run Daily Charges or add the charge manually.`
          );
        }

        const folio = folioRpc as { ok?: boolean; error?: string; skipped?: boolean; reason?: string } | null;
        if (folio && folio.ok === false) {
          throw new Error(
            folio.error ||
              "Guest checked in, but the first-night room charge could not be posted (see room rate and journal GL settings)."
          );
        }
      }

      /* Update reservation */

      const { error: reservationError } = await filterByOrganizationId(
        supabase
          .from("reservations")
          .update({ status: "checked_in" })
          .eq("id", reservation.id),
        orgId,
        superAdmin
      );

      if (reservationError) throw reservationError;

      /* Update room status */

      const { error: roomError } = await filterByOrganizationId(
        supabase
          .from("rooms")
          .update({ status: "occupied" })
          .eq("id", reservation.room_id),
        orgId,
        superAdmin
      );

      if (roomError) throw roomError;

      /* Refresh list */

      fetchReservations();

      alert("Guest successfully checked in");

    } catch (error: any) {

      console.error("Check-in failed:", error);
      alert(error?.message || "Check-in failed");

    } finally {

      setProcessingId(null);

    }

  };

  /* ---------------------- */
  /* LOADING SCREEN         */
  /* ---------------------- */

  if (loading) {
    return <div className="p-6">Loading reservations...</div>;
  }

  /* ---------------------- */
  /* PAGE UI                */
  /* ---------------------- */

  return (
    <div className="p-6 md:p-8">

      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">Check-In</h1>
          <PageNotes ariaLabel="Check-in help">
            <p>Guests waiting to check in.</p>
          </PageNotes>
        </div>
      </div>

      <div className="space-y-4">

        {reservations.map((reservation) => (

          <div
            key={reservation.id}
            className="bg-white border rounded-xl p-6 flex justify-between items-center"
          >

            <div>

              <h3 className="text-lg font-bold">
                {reservation.hotel_customers
                  ? `${reservation.hotel_customers.first_name} ${reservation.hotel_customers.last_name}`
                  : "Unknown customer"}
              </h3>

              <p className="text-sm text-slate-500">
                Room {reservation.rooms?.room_number || "Not assigned"}
              </p>

              <p className="text-sm text-slate-500">
                Arrival {new Date(reservation.check_in_date).toLocaleDateString()}
              </p>

            </div>

            <button
              onClick={() => handleCheckIn(reservation)}
              disabled={!user || !reservation.rooms || processingId === reservation.id}
              className="bg-brand-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
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