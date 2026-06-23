import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ClipboardCheck, RefreshCw, Save, Shirt, Upload, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { filterByOrganizationId } from '../lib/supabaseOrgFilter';
import {
  listHousekeepingOutbox,
  queueHousekeepingItem,
  readHousekeepingCache,
  removeHousekeepingOutboxItem,
  writeHousekeepingCache,
} from '../lib/housekeepingOffline';

type SheetRow = Database['public']['Tables']['housekeeping_attendant_sheets']['Row'];
type LaundryRow = Database['public']['Tables']['housekeeping_laundry_movements']['Row'];
type EntryMode = 'quick' | 'quantities';
type QuantityKey = 'bed_sheets' | 'pillow_cases' | 'bath_towels' | 'hand_towels' | 'bath_mats';
type RoomRow = { id: string; room_number: string; status: string };
type StaffRow = { id: string; full_name: string };
type CachedSheet = { rooms: RoomRow[]; staff: StaffRow[]; entries: SheetRow[]; laundry: LaundryRow[] };

type Draft = {
  occupancy_observed: '' | 'occupied' | 'vacant';
  cleaned: boolean;
  linen_changed: boolean;
  towels_changed: boolean;
  bed_sheets: number;
  pillow_cases: number;
  bath_towels: number;
  hand_towels: number;
  bath_mats: number;
  missing_items: string;
  notes: string;
  photo_path: string | null;
};

const ITEMS: { key: QuantityKey; label: string; short: string }[] = [
  { key: 'bed_sheets', label: 'Bed sheets', short: 'Sheets' },
  { key: 'pillow_cases', label: 'Pillow cases', short: 'Pillow cases' },
  { key: 'bath_towels', label: 'Bath towels', short: 'Bath towels' },
  { key: 'hand_towels', label: 'Hand towels', short: 'Hand towels' },
  { key: 'bath_mats', label: 'Bath mats', short: 'Bath mats' },
];

const EMPTY_DRAFT: Draft = {
  occupancy_observed: '',
  cleaned: false,
  linen_changed: false,
  towels_changed: false,
  bed_sheets: 0,
  pillow_cases: 0,
  bath_towels: 0,
  hand_towels: 0,
  bath_mats: 0,
  missing_items: '',
  notes: '',
  photo_path: null,
};

const emptyQuantities = () => ({ bed_sheets: 0, pillow_cases: 0, bath_towels: 0, hand_towels: 0, bath_mats: 0 });

export function RoomServiceSheet() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [mode, setMode] = useState<EntryMode>('quick');
  const [workspaceTab, setWorkspaceTab] = useState<'rooms' | 'laundry'>('rooms');
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [attendantId, setAttendantId] = useState('');
  const [entries, setEntries] = useState<SheetRow[]>([]);
  const [laundry, setLaundry] = useState<LaundryRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [laundryType, setLaundryType] = useState<'issue' | 'return'>('issue');
  const [laundryQty, setLaundryQty] = useState(emptyQuantities());
  const [laundryNotes, setLaundryNotes] = useState('');
  const [savingLaundry, setSavingLaundry] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);
  const syncing = useRef(false);
  const entriesRef = useRef<SheetRow[]>([]);
  const laundryRef = useRef<LaundryRow[]>([]);

  const applySnapshot = (snapshot: CachedSheet) => {
    setRooms(snapshot.rooms);
    setStaff(snapshot.staff);
    setEntries(snapshot.entries);
    setLaundry(snapshot.laundry);
    entriesRef.current = snapshot.entries;
    laundryRef.current = snapshot.laundry;
    if (!attendantId && user?.id && snapshot.staff.some((person) => person.id === user.id)) setAttendantId(user.id);
    setDrafts(Object.fromEntries(snapshot.rooms.map((room) => {
      const entry = snapshot.entries.find((item) => item.room_id === room.id);
      return [room.id, entry ? {
        occupancy_observed: entry.occupancy_observed || '',
        cleaned: entry.cleaned,
        linen_changed: entry.linen_changed,
        towels_changed: entry.towels_changed,
        bed_sheets: entry.bed_sheets,
        pillow_cases: entry.pillow_cases,
        bath_towels: entry.bath_towels,
        hand_towels: entry.hand_towels,
        bath_mats: entry.bath_mats,
        missing_items: entry.missing_items || '',
        notes: entry.notes || '',
        photo_path: entry.photo_path,
      } : { ...EMPTY_DRAFT }];
    })));
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      if (!orgId && !superAdmin) return;
      const cacheOrg = orgId || 'platform';
      const cached = readHousekeepingCache<CachedSheet>(cacheOrg, date);
      if (cached) applySnapshot(cached);
      setPendingSync((await listHousekeepingOutbox(cacheOrg)).length);
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const [roomsResult, staffResult, sheetResult, laundryResult] = await Promise.all([
        filterByOrganizationId(supabase.from('rooms').select('id, room_number, status').order('room_number'), orgId, superAdmin),
        filterByOrganizationId(supabase.from('staff').select('id, full_name').eq('is_active', true).order('full_name'), orgId, superAdmin),
        filterByOrganizationId(supabase.from('housekeeping_attendant_sheets').select('*').eq('service_date', date), orgId, superAdmin),
        filterByOrganizationId(supabase.from('housekeeping_laundry_movements').select('*').eq('movement_date', date).order('created_at', { ascending: false }), orgId, superAdmin),
      ]);
      if (roomsResult.error) throw roomsResult.error;
      if (staffResult.error) throw staffResult.error;
      if (sheetResult.error) throw sheetResult.error;
      if (laundryResult.error) throw laundryResult.error;
      const snapshot: CachedSheet = {
        rooms: roomsResult.data || [],
        staff: staffResult.data || [],
        entries: (sheetResult.data || []) as SheetRow[],
        laundry: (laundryResult.data || []) as LaundryRow[],
      };
      applySnapshot(snapshot);
      writeHousekeepingCache(cacheOrg, date, snapshot);
      setDirty(new Set());
      setFiles({});
    } catch (error) {
      console.error('Error loading room service sheet:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [date, orgId, superAdmin]);

  const updateDraft = (roomId: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [roomId]: { ...(current[roomId] || EMPTY_DRAFT), ...patch } }));
    setDirty((current) => new Set(current).add(roomId));
  };

  const uploadPhoto = async (roomId: string, existingPath: string | null) => {
    const file = files[roomId];
    if (!file) return existingPath;
    if (!orgId) throw new Error('Select an organization before uploading a photo.');
    const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${orgId}/${date}/${roomId}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from('housekeeping-photos').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  };

  const saveRoom = async (roomId: string, refresh = true) => {
    if (!attendantId) {
      alert('Select the room attendant before saving.');
      return false;
    }
    const draft = drafts[roomId] || { ...EMPTY_DRAFT };
    setSavingIds((current) => new Set(current).add(roomId));
    try {
      const quantities = mode === 'quick'
        ? {
            bed_sheets: draft.linen_changed ? 1 : 0,
            pillow_cases: draft.linen_changed ? 2 : 0,
            bath_towels: draft.towels_changed ? 2 : 0,
            hand_towels: draft.towels_changed ? 1 : 0,
            bath_mats: draft.towels_changed ? 1 : 0,
          }
        : Object.fromEntries(ITEMS.map(({ key }) => [key, draft[key]])) as Record<QuantityKey, number>;
      const linenChanged = mode === 'quick' ? draft.linen_changed : quantities.bed_sheets + quantities.pillow_cases > 0;
      const towelsChanged = mode === 'quick' ? draft.towels_changed : quantities.bath_towels + quantities.hand_towels + quantities.bath_mats > 0;
      const payload: Database['public']['Tables']['housekeeping_attendant_sheets']['Insert'] = {
        organization_id: orgId ?? null,
        service_date: date,
        room_id: roomId,
        attendant_id: attendantId,
        occupancy_observed: draft.occupancy_observed || null,
        cleaned: draft.cleaned,
        linen_changed: linenChanged,
        towels_changed: towelsChanged,
        missing_items: draft.missing_items.trim() || null,
        notes: draft.notes.trim() || null,
        photo_path: draft.photo_path,
        entry_mode: mode,
        ...quantities,
      };
      if (!online) {
        if (!orgId) throw new Error('Select an organization before working offline.');
        await queueHousekeepingItem({
          kind: 'room',
          organizationId: orgId,
          payload: payload as Record<string, unknown>,
          photo: files[roomId],
          photoName: files[roomId]?.name,
        });
        const existing = entriesRef.current.find((entry) => entry.room_id === roomId);
        const localEntry = {
          ...payload,
          id: existing?.id || `offline-${crypto.randomUUID()}`,
          organization_id: orgId,
          created_at: existing?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as SheetRow;
        const nextEntries = [...entriesRef.current.filter((entry) => entry.room_id !== roomId), localEntry];
        entriesRef.current = nextEntries;
        setEntries(nextEntries);
        writeHousekeepingCache(orgId, date, { rooms, staff, entries: nextEntries, laundry: laundryRef.current } satisfies CachedSheet);
        setPendingSync((current) => current + 1);
      } else {
        payload.photo_path = await uploadPhoto(roomId, draft.photo_path);
        const { error } = await supabase.from('housekeeping_attendant_sheets').upsert(payload, { onConflict: 'organization_id,service_date,room_id' });
        if (error) throw error;
      }
      setDirty((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
      setFiles((current) => {
        const next = { ...current };
        delete next[roomId];
        return next;
      });
      if (refresh && online) await fetchData();
      return true;
    } catch (error) {
      console.error('Error saving room service row:', error);
      alert('Failed to save room: ' + (error instanceof Error ? error.message : String(error)));
      return false;
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  };

  const saveAll = async () => {
    if (!attendantId) {
      alert('Select the room attendant before saving.');
      return;
    }
    for (const roomId of Array.from(dirty)) {
      const saved = await saveRoom(roomId, false);
      if (!saved) return;
    }
    await fetchData();
  };

  const recordLaundry = async () => {
    if (Object.values(laundryQty).every((value) => value === 0)) {
      alert('Enter at least one laundry quantity.');
      return;
    }
    setSavingLaundry(true);
    try {
      const payload: Database['public']['Tables']['housekeeping_laundry_movements']['Insert'] = {
        organization_id: orgId ?? null,
        movement_date: date,
        movement_type: laundryType,
        ...laundryQty,
        notes: laundryNotes.trim() || null,
        recorded_by: user?.id || null,
      };
      if (!online) {
        if (!orgId) throw new Error('Select an organization before working offline.');
        payload.id = crypto.randomUUID();
        await queueHousekeepingItem({ kind: 'laundry', organizationId: orgId, payload: payload as Record<string, unknown> });
        const localMovement = {
          ...payload,
          id: payload.id,
          organization_id: orgId,
          created_at: new Date().toISOString(),
        } as LaundryRow;
        const nextLaundry = [localMovement, ...laundryRef.current];
        laundryRef.current = nextLaundry;
        setLaundry(nextLaundry);
        writeHousekeepingCache(orgId, date, { rooms, staff, entries: entriesRef.current, laundry: nextLaundry } satisfies CachedSheet);
        setPendingSync((current) => current + 1);
      } else {
        const { error } = await supabase.from('housekeeping_laundry_movements').insert(payload);
        if (error) throw error;
      }
      setLaundryQty(emptyQuantities());
      setLaundryNotes('');
      if (online) await fetchData();
    } catch (error) {
      console.error('Error recording laundry movement:', error);
      alert('Failed to record laundry movement: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSavingLaundry(false);
    }
  };

  const syncOfflineWork = async () => {
    if (!orgId || !navigator.onLine || syncing.current) return;
    syncing.current = true;
    try {
      const queued = await listHousekeepingOutbox(orgId);
      setPendingSync(queued.length);
      for (const item of queued) {
        try {
        if (item.kind === 'room') {
          const payload = { ...item.payload } as Database['public']['Tables']['housekeeping_attendant_sheets']['Insert'];
          if (item.photo) {
            const extension = item.photoName?.split('.').pop()?.toLowerCase() || 'jpg';
            const path = `${orgId}/${String(payload.service_date)}/${String(payload.room_id)}-${Date.now()}.${extension}`;
            const { error: uploadError } = await supabase.storage.from('housekeeping-photos').upload(path, item.photo, { contentType: item.photo.type, upsert: false });
            if (uploadError) throw uploadError;
            payload.photo_path = path;
          }
          const { error } = await supabase.from('housekeeping_attendant_sheets').upsert(payload, { onConflict: 'organization_id,service_date,room_id' });
          if (error) throw error;
        } else {
          const payload = item.payload as Database['public']['Tables']['housekeeping_laundry_movements']['Insert'];
          const { error } = await supabase.from('housekeeping_laundry_movements').upsert(payload, { onConflict: 'id' });
          if (error) throw error;
        }
          await removeHousekeepingOutboxItem(item.id);
        } catch (error) {
          console.error('Housekeeping offline sync paused:', error);
          break;
        }
      }
      setPendingSync((await listHousekeepingOutbox(orgId)).length);
      await fetchData();
    } finally {
      syncing.current = false;
    }
  };

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (online && orgId) void syncOfflineWork();
  }, [online, orgId]);

  const viewPhoto = async (path: string) => {
    const { data, error } = await supabase.storage.from('housekeeping-photos').createSignedUrl(path, 300);
    if (error) {
      alert('Unable to open the photo.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const totals = useMemo(() => {
    const consumed = emptyQuantities();
    const issued = emptyQuantities();
    const returned = emptyQuantities();
    for (const entry of entries) ITEMS.forEach(({ key }) => { consumed[key] += entry[key]; });
    for (const movement of laundry) ITEMS.forEach(({ key }) => {
      (movement.movement_type === 'issue' ? issued : returned)[key] += movement[key];
    });
    return { consumed, issued, returned };
  }, [entries, laundry]);

  if (loading) return <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">Loading room service sheet…</div>;

  return (
    <div className="space-y-6">
      {(!online || pendingSync > 0) && (
        <div className={`rounded-xl border p-3 flex items-center gap-3 ${online ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <WifiOff className="h-5 w-5 shrink-0" />
          <div><p className="text-sm font-semibold">{online ? 'Synchronizing saved work' : 'Working offline'}</p><p className="text-xs">{pendingSync} update{pendingSync === 1 ? '' : 's'} stored safely on this device and queued for automatic sync.</p></div>
        </div>
      )}

      <div className="flex gap-2 border-b border-slate-200">
        <button type="button" onClick={() => setWorkspaceTab('rooms')} className={`px-4 py-3 text-sm font-semibold border-b-2 flex items-center gap-2 ${workspaceTab === 'rooms' ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500'}`}><ClipboardCheck className="w-4 h-4" />Room Service</button>
        <button type="button" onClick={() => setWorkspaceTab('laundry')} className={`px-4 py-3 text-sm font-semibold border-b-2 flex items-center gap-2 ${workspaceTab === 'laundry' ? 'border-brand-700 text-brand-700' : 'border-transparent text-slate-500'}`}><Shirt className="w-4 h-4" />Laundry</button>
      </div>

      <div className={`bg-white border border-slate-200 rounded-xl p-4 grid gap-4 items-end ${workspaceTab === 'rooms' ? 'md:grid-cols-[auto_1fr_auto]' : 'md:grid-cols-[auto_1fr]'}`}>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Service date</label>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        {workspaceTab === 'rooms' && <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Room attendant</label>
          <select value={attendantId} onChange={(event) => setAttendantId(event.target.value)} className="w-full max-w-sm border border-slate-300 rounded-lg px-3 py-2">
            <option value="">Select attendant</option>
            {staff.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
          </select>
        </div>}
        {workspaceTab === 'rooms' && <button type="button" onClick={saveAll} disabled={dirty.size === 0} className="app-btn-primary flex items-center justify-center gap-2 disabled:opacity-50">
          <Save className="w-4 h-4" /> Save all ({dirty.size})
        </button>}
        {workspaceTab === 'laundry' && <p className="text-sm text-slate-500 md:pb-2">Laundry issues, returns and reconciliation for the selected date.</p>}
      </div>

      {workspaceTab === 'rooms' && <>
      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-slate-900">Choose how the attendant records usage</p>
          <p className="text-sm text-slate-600">Quick ticks apply one linen set (1 sheet, 2 pillow cases) or one towel set (2 bath, 1 hand, 1 mat). Quantity mode records exact pieces.</p>
        </div>
        <div className="inline-flex bg-white border border-slate-300 rounded-lg p-1 self-start">
          <button type="button" onClick={() => setMode('quick')} className={`px-4 py-2 rounded-md text-sm font-semibold ${mode === 'quick' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}>Quick ticks</button>
          <button type="button" onClick={() => setMode('quantities')} className={`px-4 py-2 rounded-md text-sm font-semibold ${mode === 'quantities' ? 'bg-brand-700 text-white' : 'text-slate-600'}`}>Exact quantities</button>
        </div>
      </div>

      <div className="space-y-4 md:hidden">
        {rooms.map((room) => {
          const draft = drafts[room.id] || { ...EMPTY_DRAFT };
          const saved = entries.some((entry) => entry.room_id === room.id) && !dirty.has(room.id);
          return (
            <article key={room.id} className={`rounded-2xl border p-4 shadow-sm ${dirty.has(room.id) ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div><h3 className="text-xl font-bold text-slate-900">Room {room.room_number}</h3><p className="text-xs capitalize text-slate-500">System status: {room.status}</p></div>
                {saved && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700"><Check className="h-3.5 w-3.5" /> Saved</span>}
              </div>
              <label className="block text-sm font-semibold text-slate-700">Observed occupancy
                <select value={draft.occupancy_observed} onChange={(event) => updateDraft(room.id, { occupancy_observed: event.target.value as Draft['occupancy_observed'] })} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base">
                  <option value="">Not checked</option><option value="occupied">Occupied</option><option value="vacant">Vacant</option>
                </select>
              </label>
              <div className="mt-4 grid grid-cols-1 gap-2">
                {([
                  ['cleaned', 'Room cleaned'],
                  ...(mode === 'quick' ? [['linen_changed', 'Linen changed'], ['towels_changed', 'Towels changed']] : []),
                ] as [keyof Draft, string][]).map(([key, label]) => (
                  <label key={key} className={`flex min-h-12 items-center justify-between rounded-xl border px-4 font-semibold ${draft[key] ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-700'}`}>
                    {label}<input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => updateDraft(room.id, { [key]: event.target.checked })} className="h-6 w-6 accent-brand-700" />
                  </label>
                ))}
              </div>
              {mode === 'quantities' && <div className="mt-4 grid grid-cols-2 gap-3">{ITEMS.map(({ key, label }) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input type="number" min="0" value={draft[key]} onChange={(event) => updateDraft(room.id, { [key]: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg text-slate-900" /></label>)}</div>}
              <div className="mt-4 grid gap-3">
                <label className="text-sm font-semibold text-slate-700">Missing items<input value={draft.missing_items} onChange={(event) => updateDraft(room.id, { missing_items: event.target.value })} placeholder="None" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
                <label className="text-sm font-semibold text-slate-700">Notes<input value={draft.notes} onChange={(event) => updateDraft(room.id, { notes: event.target.value })} placeholder="Optional notes" className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-normal" /></label>
              </div>
              <div className="mt-4 flex gap-2">
                <label className="inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white font-semibold text-slate-700"><Upload className="h-5 w-5" />{files[room.id] ? 'Photo selected' : 'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; setFiles((current) => ({ ...current, [room.id]: file })); if (file) setDirty((current) => new Set(current).add(room.id)); }} /></label>
                {draft.photo_path && <button type="button" onClick={() => void viewPhoto(draft.photo_path!)} className="min-h-12 rounded-xl border border-slate-300 px-4 text-brand-700"><Camera className="h-5 w-5" /></button>}
              </div>
              <button type="button" onClick={() => void saveRoom(room.id)} disabled={!dirty.has(room.id) || savingIds.has(room.id)} className="mt-4 min-h-12 w-full rounded-xl bg-slate-900 font-bold text-white disabled:opacity-40">{savingIds.has(room.id) ? 'Saving…' : online ? 'Save room' : 'Save offline'}</button>
            </article>
          );
        })}
      </div>

      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className={`w-full text-sm ${mode === 'quantities' ? 'min-w-[1500px]' : 'min-w-[1150px]'}`}>
          <thead className="bg-slate-50 text-slate-600 sticky top-0">
            <tr>
              <th className="p-3 text-left">Room</th>
              <th className="p-3 text-left">Observed</th>
              <th className="p-3 text-center">Cleaned</th>
              {mode === 'quick' ? (
                <><th className="p-3 text-center">Linen changed</th><th className="p-3 text-center">Towels changed</th></>
              ) : ITEMS.map((item) => <th key={item.key} className="p-3 text-center">{item.short}</th>)}
              <th className="p-3 text-left">Missing items</th>
              <th className="p-3 text-left">Photo</th>
              <th className="p-3 text-left">Notes</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rooms.map((room) => {
              const draft = drafts[room.id] || { ...EMPTY_DRAFT };
              const saved = entries.some((entry) => entry.room_id === room.id) && !dirty.has(room.id);
              return (
                <tr key={room.id} className={dirty.has(room.id) ? 'bg-amber-50/60' : 'hover:bg-slate-50'}>
                  <td className="p-3 whitespace-nowrap"><p className="font-bold text-slate-900">Room {room.room_number}</p><p className="text-xs text-slate-400">System: {room.status}</p></td>
                  <td className="p-3">
                    <select value={draft.occupancy_observed} onChange={(event) => updateDraft(room.id, { occupancy_observed: event.target.value as Draft['occupancy_observed'] })} className="border border-slate-300 rounded-md px-2 py-2">
                      <option value="">Not checked</option><option value="occupied">Occupied</option><option value="vacant">Vacant</option>
                    </select>
                  </td>
                  <td className="p-3 text-center"><input type="checkbox" checked={draft.cleaned} onChange={(event) => updateDraft(room.id, { cleaned: event.target.checked })} className="w-5 h-5 accent-brand-700" aria-label={`Room ${room.room_number} cleaned`} /></td>
                  {mode === 'quick' ? (
                    <>
                      <td className="p-3 text-center"><input type="checkbox" checked={draft.linen_changed} onChange={(event) => updateDraft(room.id, { linen_changed: event.target.checked })} className="w-5 h-5 accent-brand-700" aria-label={`Room ${room.room_number} linen changed`} /></td>
                      <td className="p-3 text-center"><input type="checkbox" checked={draft.towels_changed} onChange={(event) => updateDraft(room.id, { towels_changed: event.target.checked })} className="w-5 h-5 accent-brand-700" aria-label={`Room ${room.room_number} towels changed`} /></td>
                    </>
                  ) : ITEMS.map(({ key }) => (
                    <td key={key} className="p-3"><input type="number" min="0" step="1" value={draft[key]} onChange={(event) => updateDraft(room.id, { [key]: Math.max(0, Number.parseInt(event.target.value, 10) || 0) })} className="w-16 border border-slate-300 rounded-md px-2 py-2 text-center" /></td>
                  ))}
                  <td className="p-3"><input value={draft.missing_items} onChange={(event) => updateDraft(room.id, { missing_items: event.target.value })} placeholder="None" className="w-36 border border-slate-300 rounded-md px-2 py-2" /></td>
                  <td className="p-3">
                    <label className="inline-flex items-center gap-1 px-2 py-2 border border-slate-300 rounded-md cursor-pointer hover:bg-slate-50">
                      <Upload className="w-4 h-4" /><span className="text-xs">{files[room.id] ? 'Selected' : 'Add'}</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; setFiles((current) => ({ ...current, [room.id]: file })); if (file) setDirty((current) => new Set(current).add(room.id)); }} />
                    </label>
                    {draft.photo_path && <button type="button" onClick={() => void viewPhoto(draft.photo_path!)} className="ml-1 p-2 text-brand-700" title="View photo"><Camera className="w-4 h-4" /></button>}
                  </td>
                  <td className="p-3"><input value={draft.notes} onChange={(event) => updateDraft(room.id, { notes: event.target.value })} placeholder="Optional" className="w-36 border border-slate-300 rounded-md px-2 py-2" /></td>
                  <td className="p-3"><button type="button" onClick={() => void saveRoom(room.id)} disabled={!dirty.has(room.id) || savingIds.has(room.id)} className="px-3 py-2 rounded-md bg-slate-900 text-white disabled:opacity-40 whitespace-nowrap">{savingIds.has(room.id) ? 'Saving…' : saved ? <span className="flex gap-1"><Check className="w-4 h-4" /> Saved</span> : 'Save'}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rooms.length === 0 && <div className="p-10 text-center text-slate-500">No rooms are configured.</div>}
      </div>
      </>}

      {workspaceTab === 'laundry' && <section className="space-y-4">
        <div className="flex items-center gap-2"><Shirt className="w-6 h-6 text-brand-700" /><div><h2 className="text-xl font-bold text-slate-900">Laundry reconciliation</h2><p className="text-sm text-slate-500">Compare room consumption with clean issues and soiled returns for {date}.</p></div></div>
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[750px] text-sm">
            <thead className="bg-slate-50"><tr><th className="p-3 text-left">Item</th><th className="p-3 text-right">Room consumption</th><th className="p-3 text-right">Laundry issued</th><th className="p-3 text-right">Laundry returned</th><th className="p-3 text-right">Issue variance</th><th className="p-3 text-right" title="Laundry issued minus laundry returned">Unreturned</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {ITEMS.map(({ key, label }) => {
                const issueVariance = totals.issued[key] - totals.consumed[key];
                const unreturned = totals.issued[key] - totals.returned[key];
                return <tr key={key}><td className="p-3 font-semibold">{label}</td><td className="p-3 text-right">{totals.consumed[key]}</td><td className="p-3 text-right">{totals.issued[key]}</td><td className="p-3 text-right">{totals.returned[key]}</td><td className={`p-3 text-right font-semibold ${issueVariance < 0 ? 'text-red-600' : issueVariance > 0 ? 'text-amber-600' : 'text-green-600'}`}>{issueVariance > 0 ? '+' : ''}{issueVariance}</td><td className={`p-3 text-right font-semibold ${unreturned > 0 ? 'text-red-600' : unreturned < 0 ? 'text-amber-600' : 'text-green-600'}`}>{unreturned}</td></tr>;
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
            <div><h3 className="font-bold text-slate-900">Record laundry movement</h3><p className="text-sm text-slate-500">Issue = clean items given to housekeeping. Return = soiled items received back by laundry.</p></div>
            <div className="inline-flex border border-slate-300 rounded-lg p-1 self-start"><button type="button" onClick={() => setLaundryType('issue')} className={`px-4 py-2 rounded-md text-sm ${laundryType === 'issue' ? 'bg-blue-600 text-white' : ''}`}>Clean issue</button><button type="button" onClick={() => setLaundryType('return')} className={`px-4 py-2 rounded-md text-sm ${laundryType === 'return' ? 'bg-emerald-600 text-white' : ''}`}>Soiled return</button></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{ITEMS.map(({ key, label }) => <label key={key} className="text-xs font-medium text-slate-600">{label}<input type="number" min="0" value={laundryQty[key]} onChange={(event) => setLaundryQty((current) => ({ ...current, [key]: Math.max(0, Number.parseInt(event.target.value, 10) || 0) }))} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-base text-slate-900" /></label>)}</div>
          <div className="flex flex-col md:flex-row gap-3 mt-4"><input value={laundryNotes} onChange={(event) => setLaundryNotes(event.target.value)} placeholder="Reference or notes" className="flex-1 border border-slate-300 rounded-lg px-3 py-2" /><button type="button" onClick={() => void recordLaundry()} disabled={savingLaundry} className="app-btn-primary flex items-center justify-center gap-2"><ClipboardCheck className="w-4 h-4" />{savingLaundry ? 'Recording…' : 'Record movement'}</button><button type="button" onClick={() => void fetchData()} className="px-3 py-2 border border-slate-300 rounded-lg"><RefreshCw className="w-4 h-4" /></button></div>
        </div>
      </section>}
    </div>
  );
}
