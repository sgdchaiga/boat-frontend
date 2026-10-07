import { useCallback, useEffect, useMemo, useState } from "react";
import { BedDouble, Globe2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type RoomType = { id: string; name: string; description: string | null; base_price: number; max_occupancy: number | null };
type Room = { room_type_id: string | null; status: string };

const money = (amount: number) => `UGX ${Number(amount || 0).toLocaleString()}`;

export function MarketplaceHotelRoomConnector({ merchantId, organizationId }: { merchantId: string; organizationId: string }) {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [typesRes, roomsRes, listingsRes] = await Promise.all([
      db.from("room_types").select("id,name,description,base_price,max_occupancy").eq("organization_id", organizationId).order("name"),
      db.from("rooms").select("room_type_id,status").eq("organization_id", organizationId),
      db.from("marketplace_listings").select("source_record_id").eq("merchant_id", merchantId).eq("source_module", "hotel_room_type"),
    ]);
    setLoading(false);
    if (typesRes.error || roomsRes.error || listingsRes.error) { setMessage((typesRes.error || roomsRes.error || listingsRes.error).message); return; }
    setRoomTypes((typesRes.data || []) as RoomType[]);
    setRooms((roomsRes.data || []) as Room[]);
    setPublishedIds(new Set(((listingsRes.data || []) as Array<{ source_record_id: string | null }>).map((row) => row.source_record_id).filter((id): id is string => Boolean(id))));
  }, [merchantId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const availableByType = useMemo(() => rooms.reduce<Record<string, number>>((counts, room) => {
    if (room.room_type_id && room.status === "available") counts[room.room_type_id] = (counts[room.room_type_id] || 0) + 1;
    return counts;
  }, {}), [rooms]);

  const publish = async (roomType: RoomType) => {
    setBusyId(roomType.id); setMessage(null);
    const existing = await db.from("marketplace_listings").select("id").eq("merchant_id", merchantId).eq("source_module", "hotel_room_type").eq("source_record_id", roomType.id).maybeSingle();
    if (existing.error) { setBusyId(null); setMessage(existing.error.message); return; }
    const payload = {
      title: `${roomType.name} room`,
      description: `${roomType.description || "Hotel room booking request"}${roomType.max_occupancy ? ` · Up to ${roomType.max_occupancy} guest${roomType.max_occupancy === 1 ? "" : "s"}` : ""}. Price is per night; the hotel confirms the stay dates before fulfilment.`,
      listing_type: "room",
      price: Number(roomType.base_price || 0),
      currency: "UGX",
      available_quantity: null,
      is_published: true,
    };
    const result = existing.data
      ? await db.from("marketplace_listings").update(payload).eq("id", existing.data.id).eq("organization_id", organizationId)
      : await db.from("marketplace_listings").insert({ ...payload, organization_id: organizationId, merchant_id: merchantId, source_module: "hotel_room_type", source_record_id: roomType.id });
    setBusyId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setMessage(`${roomType.name} room is now published as a booking request.`);
    await load();
  };

  return <section className="mt-6 border-t border-indigo-200 pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><BedDouble className="h-5 w-5 text-indigo-700" /><h3 className="font-semibold text-slate-900">Hotel room sales</h3></div><p className="mt-1 text-sm text-slate-600">Publish room types from the hotel setup without re-entering rates. Each listing is a booking request; confirm the guest's dates and room availability before fulfilment.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>{message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}<div className="mt-4 space-y-2">{roomTypes.map((roomType) => <article key={roomType.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"><div><p className="font-medium text-slate-900">{roomType.name}</p><p className="mt-1 text-xs text-slate-500">{money(roomType.base_price)} / night · {availableByType[roomType.id] || 0} room{(availableByType[roomType.id] || 0) === 1 ? "" : "s"} currently available</p></div><button type="button" onClick={() => void publish(roomType)} disabled={busyId === roomType.id} className={publishedIds.has(roomType.id) ? "app-btn-secondary" : "app-btn-primary"}><Globe2 className="h-4 w-4" /> {busyId === roomType.id ? "Publishing…" : publishedIds.has(roomType.id) ? "Refresh listing" : "Publish room"}</button></article>)}{!loading && roomTypes.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">Set up hotel room types first, then return here to publish them.</p>}</div></section>;
}
