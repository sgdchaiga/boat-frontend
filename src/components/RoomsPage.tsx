import { useEffect, useState } from "react";
import { BedDouble, Plus, CreditCard as Edit2, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { PageNotes } from "./common/PageNotes";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";

type Room = Database["public"]["Tables"]["rooms"]["Row"] & {
  room_types: { name: string; base_price: number } | null;
  breakfast_included?: boolean;
};
type OccupancyStay = { id:string; room_id:string|null; actual_check_in:string; hotel_customers:{first_name:string;last_name:string}|null };

export function RoomsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [occupiedRoomIds, setOccupiedRoomIds] = useState<Set<string>>(new Set());
  const [reservedRoomIds, setReservedRoomIds] = useState<Set<string>>(new Set());
  const [occupancyByRoom, setOccupancyByRoom] = useState<Map<string, OccupancyStay>>(new Map());
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [breakfastIncluded, setBreakfastIncluded] = useState(true);
  const [savingRoom, setSavingRoom] = useState(false);
  const [editRateRoom, setEditRateRoom] = useState<Room | null>(null);
  const [editRateValue, setEditRateValue] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [correctingRoom, setCorrectingRoom] = useState<Room | null>(null);
  const [correctionCheckoutDate, setCorrectionCheckoutDate] = useState(() => new Date().toISOString().slice(0,10));
  const [correctionRoomStatus, setCorrectionRoomStatus] = useState<"cleaning"|"available">("cleaning");
  const [savingCorrection, setSavingCorrection] = useState(false);

  useEffect(() => {
    fetchRooms();
  }, [orgId, superAdmin]);

  /* ----------------------------- */
  /* FETCH ROOMS + STAYS + RESERVATIONS */
  /* ----------------------------- */

  const fetchRooms = async () => {
    try {
      setLoading(true);
      if (!orgId && !superAdmin) {
        setRooms([]);
        setOccupiedRoomIds(new Set());
        setOccupancyByRoom(new Map());
        setReservedRoomIds(new Set());
        return;
      }

      const today = new Date().toISOString().slice(0, 10);

      const [roomsRes, staysRes, reservationsRes] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("rooms")
            .select("*, room_types(name, base_price)")
            .order("room_number"),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("stays")
            .select("id,room_id,actual_check_in,hotel_customers(first_name,last_name)")
            .is("actual_check_out", null),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("reservations")
            .select("room_id, check_in_date, check_out_date, status")
            .in("status", ["pending", "confirmed", "checked_in"])
            .gte("check_out_date", today),
          orgId,
          superAdmin
        ),
      ]);

      if (roomsRes.error) throw roomsRes.error;

      setRooms(roomsRes.data || []);

      const occupied = new Set<string>();
      const occupancy = new Map<string, OccupancyStay>();
      (staysRes.data || []).forEach((s) => {
        if (s.room_id) occupied.add(s.room_id);
        if (s.room_id) occupancy.set(s.room_id, s as unknown as OccupancyStay);
      });
      setOccupiedRoomIds(occupied);
      setOccupancyByRoom(occupancy);

      const reserved = new Set<string>();
      (reservationsRes.data || []).forEach((r) => {
        if (r.room_id && r.check_out_date >= today) reserved.add(r.room_id);
      });
      setReservedRoomIds(reserved);
    } catch (error) {
      console.error("Error fetching rooms:", error);
    } finally {
      setLoading(false);
    }
  };

  /* ----------------------------- */
  /* ADD ROOM */
  /* ----------------------------- */

const addRoom = async () => {
  if (savingRoom) return;
  if (!roomNumber || !floor) {
    alert("Enter room number and floor");
    return;
  }

  setSavingRoom(true);
  try {
    const { error } = await supabase
      .from("rooms")
      .insert([
        {
          organization_id: orgId ?? null,
          room_number: roomNumber,
          floor: floor,
          status: "available",
          breakfast_included: breakfastIncluded,
        }
      ])
      .select();

    if (error) {
      console.error("SUPABASE ERROR:", JSON.stringify(error, null, 2));
      alert(error.message);
      return;
    }

    setShowAddRoom(false);
    setRoomNumber("");
    setFloor("");
    setBreakfastIncluded(true);

    fetchRooms();

  } catch (err) {
    console.error("UNEXPECTED ERROR:", err);
  } finally {
    setSavingRoom(false);
  }
};

  /* ----------------------------- */
  /* UPDATE ROOM STATUS */
  /* ----------------------------- */

  const effectiveNightlyRate = (room: Room) => {
    const override = room.nightly_rate != null ? Number(room.nightly_rate) : NaN;
    if (Number.isFinite(override) && override > 0) return override;
    const base = room.room_types?.base_price != null ? Number(room.room_types.base_price) : NaN;
    if (Number.isFinite(base) && base > 0) return base;
    return 0;
  };

  const openEditRate = (room: Room) => {
    setEditRateRoom(room);
    setEditRateValue(
      room.nightly_rate != null && Number.isFinite(Number(room.nightly_rate))
        ? String(room.nightly_rate)
        : ""
    );
  };

  const saveRoomRate = async () => {
    if (!editRateRoom || savingRate) return;
    if (!orgId && !superAdmin) return;
    const v = editRateValue.trim();
    const num = v === "" ? null : parseFloat(v);
    if (num != null && (!Number.isFinite(num) || num < 0)) {
      alert("Enter a valid positive amount or leave blank for room type default.");
      return;
    }
    setSavingRate(true);
    try {
      const { error } = await filterByOrganizationId(
        supabase.from("rooms").update({ nightly_rate: num }).eq("id", editRateRoom.id),
        orgId,
        superAdmin
      );
      if (error) throw error;
      setEditRateRoom(null);
      fetchRooms();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "Failed to save rate");
    } finally {
      setSavingRate(false);
    }
  };

  const updateRoomStatus = async (roomId: string, newStatus: string) => {
    try {
      const { error } = await filterByOrganizationId(
        supabase
          .from("rooms")
          .update({ status: newStatus })
          .eq("id", roomId),
        orgId,
        superAdmin
      );

      if (error) throw error;

      fetchRooms();
    } catch (error) {
      console.error("Error updating room:", error);
    }
  };

  const openOccupancyCorrection = (room: Room) => {
    setCorrectingRoom(room);
    setCorrectionCheckoutDate(new Date().toISOString().slice(0,10));
    setCorrectionRoomStatus("cleaning");
  };

  const saveOccupancyCorrection = async () => {
    if (!correctingRoom || savingCorrection) return;
    const stay = occupancyByRoom.get(correctingRoom.id);
    if (!stay) { alert("No open stay was found for this room. Refresh and try again."); return; }
    if (!correctionCheckoutDate) { alert("Enter the guest's actual checkout date."); return; }
    if (correctionCheckoutDate < stay.actual_check_in.slice(0,10)) { alert("Checkout cannot be before check-in."); return; }
    setSavingCorrection(true);
    try {
      const { error: checkoutError } = await supabase.rpc("hotel_check_out_stay", { p_stay_id: stay.id, p_checkout_date: correctionCheckoutDate });
      if (checkoutError) throw checkoutError;
      const { error: roomError } = await filterByOrganizationId(supabase.from("rooms").update({ status: correctionRoomStatus }).eq("id", correctingRoom.id), orgId, superAdmin);
      if (roomError) throw roomError;
      setCorrectingRoom(null);
      await fetchRooms();
    } catch (error) {
      console.error("Occupancy correction failed:", error);
      alert(error instanceof Error ? error.message : "Could not correct room occupancy.");
    } finally { setSavingCorrection(false); }
  };

  /* ----------------------------- */
  /* EFFECTIVE STATUS (from stays + reservations) */
  /* ----------------------------- */

  const getEffectiveStatus = (room: Room): string => {
    if (occupiedRoomIds.has(room.id)) return "occupied";
    if (reservedRoomIds.has(room.id)) return "reserved";
    return room.status;
  };

  /* ----------------------------- */
  /* FILTER ROOMS */
  /* ----------------------------- */

  const filteredRooms = rooms.filter((room) => {
    const matchesSearch = room.room_number
      .toLowerCase()
      .includes(searchTerm.toLowerCase());

    const effectiveStatus = getEffectiveStatus(room);
    const matchesStatus =
      filterStatus === "all" || effectiveStatus === filterStatus;

    return matchesSearch && matchesStatus;
  });

  /* ----------------------------- */
  /* STATUS COLOR */
  /* ----------------------------- */

  const getStatusColor = (status: string) => {
    switch (status) {
      case "available":
        return "bg-green-100 text-green-800 border-green-200";
      case "occupied":
        return "bg-red-100 text-red-800 border-red-200";
      case "reserved":
        return "bg-violet-100 text-violet-800 border-violet-200";
      case "maintenance":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "cleaning":
        return "bg-blue-100 text-blue-800 border-blue-200";
      default:
        return "bg-slate-100 text-slate-800 border-slate-200";
    }
  };

  /* ----------------------------- */
  /* LOADING STATE */
  /* ----------------------------- */

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="animate-pulse">
          <div className="h-9 bg-slate-200 rounded w-48 mb-8" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-36 bg-slate-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------------- */
  /* UI */
  /* ----------------------------- */

  return (
    <div className="p-6 md:p-8">

      {/* HEADER */}

      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Rooms</h1>
            <PageNotes ariaLabel="Rooms help">
              <p>Manage your hotel rooms.</p>
            </PageNotes>
          </div>
        </div>

        <button
          onClick={() => setShowAddRoom(true)}
          className="app-btn-primary transition"
        >
          <Plus className="w-5 h-5" />
          Add Room
        </button>
      </div>

      {/* SEARCH */}

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex gap-4">

          <div className="flex-1 relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
            <input
              type="text"
              placeholder="Search room number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          >
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="occupied">Occupied</option>
            <option value="reserved">Reserved</option>
            <option value="maintenance">Maintenance</option>
            <option value="cleaning">Cleaning</option>
          </select>

        </div>
      </div>

      {/* ROOM GRID */}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {filteredRooms.map((room) => (

          <div key={room.id} className="bg-white rounded-xl border p-6">

            <div className="flex justify-between mb-4">

              <div className="flex items-center gap-3">

                <div className="bg-slate-100 p-3 rounded-lg">
                  <BedDouble className="w-6 h-6 text-slate-700" />
                </div>

                <div>
                  <h3 className="font-bold text-lg">
                    Room {room.room_number}
                  </h3>
                  <p className="text-sm text-slate-500">
                    Floor {room.floor}
                  </p>
                </div>

              </div>

              <button
                type="button"
                onClick={() => openEditRate(room)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                title="Edit nightly rate"
              >
                <Edit2 className="w-4 h-4" />
              </button>

            </div>

            <p className="text-sm text-slate-500">Room Type</p>
            <p className="font-medium mb-1">
              {room.room_types?.name || "Not Set"}
            </p>
            <p className="text-sm text-slate-600 mb-3">
              Rate / night:{" "}
              <span className="font-semibold text-slate-800">
                {effectiveNightlyRate(room) > 0 ? effectiveNightlyRate(room).toFixed(2) : "—"}
              </span>
              {room.nightly_rate == null && room.room_types && effectiveNightlyRate(room) > 0 && (
                <span className="text-xs text-slate-500"> (type default)</span>
              )}
            </p>

            {(() => {
              const effectiveStatus = getEffectiveStatus(room);
              const isComputed = occupiedRoomIds.has(room.id) || reservedRoomIds.has(room.id);
              if (isComputed) {
                return (
                  <div className="space-y-2">
                    <div className={`w-full px-3 py-2 rounded-lg border ${getStatusColor(effectiveStatus)}`}>{effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}</div>
                    {occupiedRoomIds.has(room.id) && <button type="button" onClick={() => openOccupancyCorrection(room)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Correct occupancy / release room</button>}
                    {reservedRoomIds.has(room.id) && !occupiedRoomIds.has(room.id) && <p className="text-xs text-slate-500">Status comes from an active reservation. Edit or cancel the reservation to release this room.</p>}
                  </div>
                );
              }
              return (
                <select
                  value={room.status}
                  onChange={(e) =>
                    updateRoomStatus(room.id, e.target.value)
                  }
                  className={`w-full px-3 py-2 rounded-lg border ${getStatusColor(room.status)}`}
                >
                  <option value="available">Available</option>
                  <option value="occupied">Occupied</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="cleaning">Cleaning</option>
                </select>
              );
            })()}

          </div>

        ))}

      </div>

      {/* ADD ROOM MODAL */}

      {editRateRoom && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-96 shadow-lg">
            <h2 className="text-xl font-bold mb-2">Room {editRateRoom.room_number}</h2>
            <p className="text-sm text-slate-600 mb-4">
              Override nightly rate for auto room charges. Leave blank to use the room type default (
              {editRateRoom.room_types ? Number(editRateRoom.room_types.base_price).toFixed(2) : "—"}).
            </p>
            <input
              type="number"
              min="0"
              step="0.01"
              className="border w-full p-2 mb-4 rounded"
              placeholder="Room type default"
              value={editRateValue}
              onChange={(e) => setEditRateValue(e.target.value)}
              disabled={savingRate}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !savingRate && setEditRateRoom(null)}
                disabled={savingRate}
                className="px-4 py-2 bg-gray-200 rounded disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveRoomRate()}
                disabled={savingRate}
                className="app-btn-primary rounded-md disabled:opacity-60"
              >
                {savingRate ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {correctingRoom && (() => { const stay=occupancyByRoom.get(correctingRoom.id); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"><h2 className="text-xl font-bold">Release Room {correctingRoom.room_number}</h2><p className="mt-2 text-sm text-slate-600">This room is occupied because {stay?.hotel_customers ? `${stay.hotel_customers.first_name} ${stay.hotel_customers.last_name}` : "a guest"} has an open stay from {stay?.actual_check_in?.slice(0,10) || "an unknown date"}. Closing that stay will make the room status editable again.</p><label className="mt-4 block text-sm font-medium text-slate-700">Actual checkout date<input type="date" min={stay?.actual_check_in?.slice(0,10)} max={new Date().toISOString().slice(0,10)} value={correctionCheckoutDate} onChange={(e)=>setCorrectionCheckoutDate(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"/></label><label className="mt-3 block text-sm font-medium text-slate-700">Room status after checkout<select value={correctionRoomStatus} onChange={(e)=>setCorrectionRoomStatus(e.target.value as "cleaning"|"available")} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="cleaning">Cleaning required</option><option value="available">Available now</option></select></label><div className="mt-5 flex justify-end gap-2"><button disabled={savingCorrection} onClick={()=>setCorrectingRoom(null)} className="rounded-lg border px-4 py-2">Cancel</button><button disabled={savingCorrection} onClick={()=>void saveOccupancyCorrection()} className="app-btn-primary rounded-lg">{savingCorrection?"Saving…":"Close stay and release room"}</button></div></div></div> })()}

      {showAddRoom && (

        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">

          <div className="bg-white p-6 rounded-xl w-96">

            <h2 className="text-xl font-bold mb-4">Add Room</h2>

            <input
              placeholder="Room Number"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <input
              placeholder="Floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              className="border w-full p-2 mb-3 rounded"
            />

            <label className="mb-3 flex items-center gap-3 rounded border p-3 text-sm">
              <input type="checkbox" checked={breakfastIncluded} onChange={(e) => setBreakfastIncluded(e.target.checked)} />
              Breakfast included
            </label>

            <div className="flex justify-end gap-2">

              <button
                onClick={() => !savingRoom && setShowAddRoom(false)}
                disabled={savingRoom}
                className="px-4 py-2 bg-gray-200 rounded disabled:opacity-60"
              >
                Cancel
              </button>

              <button
                onClick={addRoom}
                disabled={savingRoom}
                className="app-btn-primary rounded-md disabled:opacity-60"
              >
                {savingRoom ? "Saving..." : "Save"}
              </button>

            </div>

          </div>

        </div>

      )}

    </div>
  );
}
