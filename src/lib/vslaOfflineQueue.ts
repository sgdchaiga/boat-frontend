import { randomUuid } from "@/lib/randomUuid";
import { supabase } from "@/lib/supabase";

export type VslaOfflineCollectionKind = "savings" | "fine" | "social" | "loan_repayment";
export type VslaOfflineCollectionStatus = "queued" | "syncing" | "rejected";

export interface VslaOfflineCollection {
  id: string;
  idempotencyKey: string;
  organizationId: string;
  meetingId: string;
  memberId: string;
  kind: VslaOfflineCollectionKind;
  shares?: number;
  amount?: number;
  loanId?: string;
  createdAt: string;
  status: VslaOfflineCollectionStatus;
  rejectionReason?: string;
}

export interface VslaOfflineMeetingSnapshot {
  organizationId: string;
  savedAt: string;
  meeting: { id: string; meeting_date: string; status: "open" };
  members: Array<{ id: string; full_name: string; member_number: string | null }>;
  loans: Array<{ id: string; member_id: string; outstanding_balance: number; status: string }>;
}

type EncryptedRow = { id: string; iv: ArrayBuffer; ciphertext: ArrayBuffer };

const DATABASE = "boat-vsla-offline-v1";
const DATABASE_VERSION = 2;
const QUEUE_STORE = "collections";
const KEY_STORE = "keys";
const SNAPSHOT_STORE = "meeting-snapshots";
const DEVICE_KEY = "collection-encryption-key";
const QUEUE_EVENT = "boat:vsla-offline-queue";
const DEVICE_ID_KEY = "boat.vsla.v12.offline-device-id";

export function getVslaOfflineDeviceId(): string {
  if (typeof window === "undefined") return "";
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const deviceId = randomUuid();
  window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function ensureBrowser() {
  if (typeof window === "undefined" || !window.indexedDB || !window.crypto?.subtle) {
    throw new Error("This browser cannot securely store VSLA offline entries.");
  }
}

function openDatabase(): Promise<IDBDatabase> {
  ensureBrowser();
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(QUEUE_STORE)) database.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE);
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open encrypted VSLA offline storage."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Secure offline storage operation failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Secure offline storage operation failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Secure offline storage operation was aborted."));
  });
}

async function encryptionKey(database: IDBDatabase): Promise<CryptoKey> {
  const readTransaction = database.transaction(KEY_STORE, "readonly");
  const current = await requestResult(readTransaction.objectStore(KEY_STORE).get(DEVICE_KEY) as IDBRequest<CryptoKey | undefined>);
  await transactionDone(readTransaction);
  if (current) return current;

  const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const writeTransaction = database.transaction(KEY_STORE, "readwrite");
  writeTransaction.objectStore(KEY_STORE).put(key, DEVICE_KEY);
  await transactionDone(writeTransaction);
  return key;
}

async function encrypt<T extends { id: string }>(row: T, key: CryptoKey): Promise<EncryptedRow> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(row));
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { id: row.id, iv: iv.buffer, ciphertext };
}

async function decrypt<T>(row: EncryptedRow, key: CryptoKey): Promise<T> {
  const plaintext = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(row.iv) }, key, row.ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

function notifyQueueChanged() {
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
}

async function saveCollection(row: VslaOfflineCollection): Promise<void> {
  const database = await openDatabase();
  try {
    const key = await encryptionKey(database);
    const encrypted = await encrypt(row, key);
    const transaction = database.transaction(QUEUE_STORE, "readwrite");
    transaction.objectStore(QUEUE_STORE).put(encrypted);
    await transactionDone(transaction);
    notifyQueueChanged();
  } finally {
    database.close();
  }
}

async function saveSnapshot(snapshot: VslaOfflineMeetingSnapshot): Promise<void> {
  const database = await openDatabase();
  try {
    const key = await encryptionKey(database);
    const encrypted = await encrypt({ ...snapshot, id: snapshot.organizationId }, key);
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put(encrypted);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveVslaOfflineMeetingSnapshot(snapshot: Omit<VslaOfflineMeetingSnapshot, "savedAt">): Promise<void> {
  await saveSnapshot({ ...snapshot, savedAt: new Date().toISOString() });
}

export async function readVslaOfflineMeetingSnapshot(organizationId: string): Promise<VslaOfflineMeetingSnapshot | null> {
  try {
    const database = await openDatabase();
    try {
      const key = await encryptionKey(database);
      const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
      const encrypted = await requestResult(transaction.objectStore(SNAPSHOT_STORE).get(organizationId) as IDBRequest<EncryptedRow | undefined>);
      await transactionDone(transaction);
      if (!encrypted) return null;
      const decrypted = await decrypt<VslaOfflineMeetingSnapshot & { id: string }>(encrypted, key);
      return decrypted.organizationId === organizationId ? decrypted : null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

export async function clearVslaOfflineMeetingSnapshot(organizationId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).delete(organizationId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function readVslaOfflineCollections(organizationId: string): Promise<VslaOfflineCollection[]> {
  try {
    const database = await openDatabase();
    try {
      const key = await encryptionKey(database);
      const transaction = database.transaction(QUEUE_STORE, "readonly");
      const encrypted = await requestResult(transaction.objectStore(QUEUE_STORE).getAll() as IDBRequest<EncryptedRow[]>);
      await transactionDone(transaction);
      const rows = await Promise.all(encrypted.map((row) => decrypt<VslaOfflineCollection>(row, key)));
      return rows.filter((row) => row.organizationId === organizationId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } finally {
      database.close();
    }
  } catch {
    return [];
  }
}

export async function queueVslaOfflineCollection(input: Omit<VslaOfflineCollection, "id" | "idempotencyKey" | "createdAt" | "status">): Promise<VslaOfflineCollection> {
  const row: VslaOfflineCollection = {
    ...input,
    id: randomUuid(),
    idempotencyKey: randomUuid(),
    createdAt: new Date().toISOString(),
    status: "queued",
  };
  await saveCollection(row);
  return row;
}

export async function syncVslaOfflineCollections(organizationId: string): Promise<VslaOfflineCollection[]> {
  if (typeof navigator === "undefined" || !navigator.onLine) return readVslaOfflineCollections(organizationId);

  // A page reload can interrupt a sync after the item was marked "syncing".
  // Replaying it is safe because the original idempotency key is retained.
  const candidates = (await readVslaOfflineCollections(organizationId)).filter((row) => row.status === "queued" || row.status === "syncing");
  for (const candidate of candidates) {
    await saveCollection({ ...candidate, status: "syncing", rejectionReason: undefined });
    const result = candidate.kind === "loan_repayment"
      ? await supabase.rpc("vsla_v12_sync_offline_loan_repayment", {
          p_device_id: getVslaOfflineDeviceId(),
          p_meeting_id: candidate.meetingId,
          p_loan_id: candidate.loanId ?? null,
          p_amount: candidate.amount ?? null,
          p_idempotency_key: candidate.idempotencyKey,
        })
      : await supabase.rpc("vsla_v12_sync_offline_collection", {
          p_device_id: getVslaOfflineDeviceId(),
          p_meeting_id: candidate.meetingId,
          p_member_id: candidate.memberId,
          p_kind: candidate.kind,
          p_shares: candidate.shares ?? null,
          p_amount: candidate.amount ?? null,
          p_idempotency_key: candidate.idempotencyKey,
        });

    if (result.error) {
      const transientConnectionFailure = !navigator.onLine || !result.error.code || /network|failed to fetch|timeout|connection/i.test(result.error.message);
      if (transientConnectionFailure) {
        await saveCollection({ ...candidate, status: "queued", rejectionReason: undefined });
        break;
      }
      await saveCollection({ ...candidate, status: "rejected", rejectionReason: result.error.message });
      continue;
    }

    const database = await openDatabase();
    try {
      const transaction = database.transaction(QUEUE_STORE, "readwrite");
      transaction.objectStore(QUEUE_STORE).delete(candidate.id);
      await transactionDone(transaction);
      notifyQueueChanged();
    } finally {
      database.close();
    }
  }
  return readVslaOfflineCollections(organizationId);
}

export async function discardRejectedVslaOfflineCollection(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const key = await encryptionKey(database);
    const readTransaction = database.transaction(QUEUE_STORE, "readonly");
    const encrypted = await requestResult(readTransaction.objectStore(QUEUE_STORE).get(id) as IDBRequest<EncryptedRow | undefined>);
    await transactionDone(readTransaction);
    if (!encrypted) return;
    const row = await decrypt<VslaOfflineCollection>(encrypted, key);
    if (row.status !== "rejected") throw new Error("Only a server-rejected offline item can be removed.");
    const writeTransaction = database.transaction(QUEUE_STORE, "readwrite");
    writeTransaction.objectStore(QUEUE_STORE).delete(id);
    await transactionDone(writeTransaction);
    notifyQueueChanged();
  } finally {
    database.close();
  }
}

export function subscribeToVslaOfflineQueue(listener: () => void): () => void {
  window.addEventListener(QUEUE_EVENT, listener);
  return () => window.removeEventListener(QUEUE_EVENT, listener);
}
