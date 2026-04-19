import type { SupabaseClient } from "@supabase/supabase-js";
import { getTenantIdFromEnv, shouldEnqueueLanSync } from "@/lib/deployment";
import { randomUuid } from "@/lib/randomUuid";

export type SyncOperation = "INSERT" | "UPDATE" | "DELETE";

export interface SyncOutboxPayload {
  tableName: string;
  operation: SyncOperation;
  recordId: string;
  payload: Record<string, unknown>;
}

/**
 * Queue a change for LAN → cloud sync. No-op when not in `lan` mode or tenant id missing.
 * Call after a successful write to the local database.
 */
export async function enqueueSyncOutbox(
  client: SupabaseClient,
  event: SyncOutboxPayload
): Promise<{ error: Error | null }> {
  if (!shouldEnqueueLanSync()) {
    return { error: null };
  }

  const tenantId = getTenantIdFromEnv();
  if (!tenantId) {
    return { error: null };
  }

  const idempotencyKey = `${event.tableName}:${event.recordId}:${event.operation}:${randomUuid()}`;

  const { error } = await client.from("sync_outbox").insert({
    tenant_id: tenantId,
    table_name: event.tableName,
    operation: event.operation,
    record_id: event.recordId,
    payload: event.payload,
    idempotency_key: idempotencyKey,
  });

  if (error) {
    console.error("[BOAT sync] sync_outbox insert failed:", error.message);
  }

  return { error: error ? new Error(error.message) : null };
}
