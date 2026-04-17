import { useEffect, useState } from "react";
import { BedDouble, Plus, CreditCard as Edit2, Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { PageNotes } from "./common/PageNotes";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";

type Room = Database["public"]["Tables"]["rooms"]["Row"] & {
  room_types: { name: string; base_price: number } | null;
};

export function RoomsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [rooms, setRooms] = useState<Room[]>([]);
  const [occupiedRoomIds, setOccupiedRoomIds] = useState<Set<string>>(new Set());
  const [reservedRoomIds, setReservedRoomIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [floor, setFloor] = useState("");
  const [savingRoom, setSavingRoom] = useState(false);

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
            .select("room_id")
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
      (staysRes.data || []).forEach((s) => {
        if (s.room_id) occupied.add(s.room_id);
      });
      setOccupiedRoomIds(occupied);

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
          status: "available"
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

              <Edit2 className="w-4 h-4 text-slate-500" />

            </div>

            <p className="text-sm text-slate-500">Room Type</p>
            <p className="font-medium mb-3">
              {room.room_types?.name || "Not Set"}
            </p>

            {(() => {
              const effectiveStatus = getEffectiveStatus(room);
              const isComputed = occupiedRoomIds.has(room.id) || reservedRoomIds.has(room.id);
              if (isComputed) {
                return (
                  <div
                    className={`w-full px-3 py-2 rounded-lg border ${getStatusColor(effectiveStatus)}`}
                  >
                    {effectiveStatus.charAt(0).toUpperCase() + effectiveStatus.slice(1)}
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