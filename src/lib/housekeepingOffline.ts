export type HousekeepingOutboxItem = {
  id: string;
  kind: 'room' | 'laundry';
  organizationId: string;
  payload: Record<string, unknown>;
  photo?: Blob;
  photoName?: string;
  createdAt: string;
};

const DB_NAME = 'boat-housekeeping-offline';
const STORE = 'outbox';
const CACHE_PREFIX = 'boat.housekeeping.cache.v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueHousekeepingItem(item: Omit<HousekeepingOutboxItem, 'id' | 'createdAt'>) {
  const db = await openDb();
  const queued: HousekeepingOutboxItem = { ...item, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(queued);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
  return queued;
}

export async function listHousekeepingOutbox(organizationId: string): Promise<HousekeepingOutboxItem[]> {
  const db = await openDb();
  const rows = await new Promise<HousekeepingOutboxItem[]>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result || []).filter((item) => item.organizationId === organizationId));
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function removeHousekeepingOutboxItem(id: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export function writeHousekeepingCache(organizationId: string, date: string, value: unknown) {
  localStorage.setItem(`${CACHE_PREFIX}:${organizationId}:${date}`, JSON.stringify(value));
}

export function readHousekeepingCache<T>(organizationId: string, date: string): T | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}:${organizationId}:${date}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}
