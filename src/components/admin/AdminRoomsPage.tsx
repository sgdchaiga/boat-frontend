import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, DoorOpen } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import type { Database } from "../../lib/database.types";

type RoomType = Database["public"]["Tables"]["room_types"]["Row"];
type Room = Database["public"]["Tables"]["rooms"]["Row"] & {
  room_types: { name: string; base_price: number } | null;
};

export function AdminRoomsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<"types" | "rooms">("types");

  // Room type form
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<RoomType | null>(null);
  const [typeName, setTypeName] = useState("");
  const [typeDesc, setTypeDesc] = useState("");
  const [typePrice, setTypePrice] = useState("");
  const [typeOccupancy, setTypeOccupancy] = useState("2");

  // Room form
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [roomFloor, setRoomFloor] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");

  useEffect(() => {
    fetchData();
  }, [orgId, superAdmin]);

  const fetchData = async () => {
    setLoading(true);
    const [typesRes, roomsRes] = await Promise.all([
      filterByOrganizationId(supabase.from("room_types").select("*").order("name"), orgId, superAdmin),
      filterByOrganizationId(
        supabase.from("rooms").select("*, room_types(name, base_price)").order("room_number"),
        orgId,
        superAdmin
      ),
    ]);
    if (typesRes.data) setRoomTypes(typesRes.data as RoomType[]);
    if (roomsRes.data) setRooms(roomsRes.data as Room[]);
    setLoading(false);
  };

  const openTypeModal = (rt?: RoomType) => {
    setEditingType(rt || null);
    setTypeName(rt?.name ?? "");
    setTypeDesc(rt?.description ?? "");
    setTypePrice(rt ? String(rt.base_price) : "");
    setTypeOccupancy(rt ? String(rt.max_occupancy) : "2");
    setShowTypeModal(true);
  };

  const saveRoomType = async () => {
    if (!typeName || !typePrice || Number(typePrice) <= 0) {
      alert("Enter name and valid base price.");
      return;
    }
    const payload = {
      name: typeName.trim(),
      description: typeDesc.trim() || null,
      base_price: Number(typePrice),
      max_occupancy: Math.max(1, parseInt(typeOccupancy, 10) || 2),
    };
    if (editingType) {
      const { error } = await supabase
        .from("room_types")
        .update(payload)
        .eq("id", editingType.id);
      if (error) {
        alert(error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("room_types").insert(payload);
      if (error) {
        alert(error.message);
        return;
      }
    }
    setShowTypeModal(false);
    fetchData();
  };

  const deleteRoomType = async (id: string) => {
    if (!confirm("Delete this room type? Rooms using it may be affected."))
      return;
    const { error } = await supabase.from("room_types").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchData();
  };

  const openRoomModal = () => {
    setRoomNumber("");
    setRoomFloor("");
    setRoomTypeId(roomTypes[0]?.id ?? "");
    setShowRoomModal(true);
  };

  const saveRoom = async () => {
    if (!roomNumber.trim() || !roomFloor) {
      alert("Enter room number and floor.");
      return;
    }
    const { error } = await supabase.from("rooms").insert({
      room_number: roomNumber.trim(),
      floor: parseInt(roomFloor, 10) || 0,
      room_type_id: roomTypeId || null,
      status: "available",
    });
    if (error) {
      alert(error.message);
      return;
    }
    setShowRoomModal(false);
    fetchData();
  };

  const deleteRoom = async (id: string) => {
    if (!confirm("Delete this room? This cannot be undone.")) return;
    const { error } = await supabase.from("rooms").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    fetchData();
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveSection("types")}
          className={`px-4 py-2 rounded-t-lg font-medium ${
            activeSection === "types"
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Room Types
        </button>
        <button
          onClick={() => setActiveSection("rooms")}
          className={`px-4 py-2 rounded-t-lg font-medium ${
            activeSection === "rooms"
              ? "bg-brand-700 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Rooms
        </button>
      </div>

      {activeSection === "types" && (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Room Types</h2>
            <button
              onClick={() => openTypeModal()}
              className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
            >
              <Plus className="w-4 h-4" />
              Add Room Type
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roomTypes.map((rt) => (
              <div
                key={rt.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex justify-between"
              >
                <div>
                  <h3 className="font-semibold text-slate-900">{rt.name}</h3>
                  <p className="text-sm text-slate-500">
                    {Number(rt.base_price).toFixed(2)} / night · Max {rt.max_occupancy}
                  </p>
                  {rt.description && (
                    <p className="text-xs text-slate-600 mt-1 truncate">
                      {rt.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openTypeModal(rt)}
                    className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteRoomType(rt.id)}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {activeSection === "rooms" && (
        <>
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Rooms</h2>
            <button
              onClick={openRoomModal}
              className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
            >
              <Plus className="w-4 h-4" />
              Add Room
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rooms.map((r) => (
              <div
                key={r.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex justify-between items-center"
              >
                <div className="flex items-center gap-3">
                  <div className="bg-slate-100 p-2 rounded-lg">
                    <DoorOpen className="w-5 h-5 text-slate-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">
                      Room {r.room_number}
                    </h3>
                    <p className="text-sm text-slate-500">
                      Floor {r.floor}
                      {r.room_types && ` · ${r.room_types.name}`}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => deleteRoom(r.id)}
                  className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {showTypeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {editingType ? "Edit Room Type" : "Add Room Type"}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Name
                </label>
                <input
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="e.g. Deluxe Double"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <input
                  value={typeDesc}
                  onChange={(e) => setTypeDesc(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="Optional"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Base Price
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={typePrice}
                    onChange={(e) => setTypePrice(e.target.value)}
                    className="border rounded-lg px-3 py-2 w-full"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Max Occupancy
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={typeOccupancy}
                    onChange={(e) => setTypeOccupancy(e.target.value)}
                    className="border rounded-lg px-3 py-2 w-full"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowTypeModal(false)}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRoomType}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg hover:bg-brand-800"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showRoomModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Add Room</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Room Number
                </label>
                <input
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="e.g. 101"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Floor
                </label>
                <input
                  type="number"
                  value={roomFloor}
                  onChange={(e) => setRoomFloor(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                  placeholder="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Room Type
                </label>
                <select
                  value={roomTypeId}
                  onChange={(e) => setRoomTypeId(e.target.value)}
                  className="border rounded-lg px-3 py-2 w-full"
                >
                  <option value="">None</option>
                  {roomTypes.map((rt) => (
                    <option key={rt.id} value={rt.id}>
                      {rt.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowRoomModal(false)}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRoom}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg hover:bg-brand-800"
              >
                Add Room
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
