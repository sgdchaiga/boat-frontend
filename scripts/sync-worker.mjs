/**
 * LAN → cloud: drains `sync_outbox` (local Postgres or on-prem Supabase) into `sync_events` (hosted Supabase).
 * Run on a schedule when internet is available. Cloud service role key only — never in the browser.
 *
 * Local Postgres + Fastify (preferred):
 *   DATABASE_URL=postgresql://...
 *   CLOUD_SUPABASE_URL=...
 *   CLOUD_SERVICE_ROLE_KEY=...
 *
 * Legacy on-prem Supabase REST:
 *   LOCAL_SUPABASE_URL=...
 *   LOCAL_SERVICE_ROLE_KEY=...
 *   CLOUD_SUPABASE_URL=...
 *   CLOUD_SERVICE_ROLE_KEY=...
 *
 * Optional env files (auto-loaded if present): deploy/sync.env, then repo .env
 * Optional: SYNC_BATCH_SIZE (default 50)
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
dotenv.config({ path: join(repoRoot, "deploy/sync.env") });
dotenv.config({ path: join(repoRoot, ".env") });

const cloudUrl = process.env.CLOUD_SUPABASE_URL;
const cloudKey = process.env.CLOUD_SERVICE_ROLE_KEY;
const batchSize = Number(process.env.SYNC_BATCH_SIZE || 50);

function requireEnv(name, value) {
  if (!value) {
    console.error(`[sync-worker] Missing env: ${name}`);
    process.exit(1);
  }
}

requireEnv("CLOUD_SUPABASE_URL", cloudUrl);
requireEnv("CLOUD_SERVICE_ROLE_KEY", cloudKey);

const cloud = createClient(cloudUrl, cloudKey);

const databaseUrl = process.env.DATABASE_URL?.trim();
const localUrl = process.env.LOCAL_SUPABASE_URL?.trim();
const localKey = process.env.LOCAL_SERVICE_ROLE_KEY?.trim();

const selectSql = `
  SELECT id, tenant_id, table_name, operation, record_id, payload, idempotency_key, created_at
  FROM sync_outbox
  WHERE synced_at IS NULL
  ORDER BY created_at ASC
  LIMIT $1
`;

async function runWithPg(conn) {
  const client = new pg.Client({ connectionString: conn });
  await client.connect();

  let rows;
  try {
    const res = await client.query(selectSql, [batchSize]);
    rows = res.rows;
  } catch (fetchErr) {
    console.error("[sync-worker] Failed to read sync_outbox:", fetchErr.message);
    await client.end();
    process.exit(1);
  }

  if (!rows?.length) {
    console.log("[sync-worker] No pending rows.");
    await client.end();
    return;
  }

  let ok = 0;
  for (const row of rows) {
    const cloudRow = {
      id: row.id,
      tenant_id: row.tenant_id,
      table_name: row.table_name,
      operation: row.operation,
      record_id: row.record_id,
      payload: row.payload,
      idempotency_key: row.idempotency_key,
      source_created_at: row.created_at,
    };

    const { error: insErr } = await cloud.from("sync_events").upsert(cloudRow, {
      onConflict: "id",
    });

    if (insErr) {
      console.error(`[sync-worker] Cloud insert failed for ${row.id}:`, insErr.message);
      continue;
    }

    try {
      await client.query(`UPDATE sync_outbox SET synced_at = $1 WHERE id = $2`, [
        new Date().toISOString(),
        row.id,
      ]);
    } catch (updErr) {
      console.error(`[sync-worker] Failed to mark synced ${row.id}:`, updErr.message);
      continue;
    }

    ok += 1;
  }

  await client.end();
  console.log(`[sync-worker] Synced ${ok}/${rows.length} row(s) via DATABASE_URL.`);
}

async function runWithSupabaseLocal() {
  requireEnv("LOCAL_SUPABASE_URL", localUrl);
  requireEnv("LOCAL_SERVICE_ROLE_KEY", localKey);

  const local = createClient(localUrl, localKey);

  const { data: rows, error: fetchErr } = await local
    .from("sync_outbox")
    .select("id, tenant_id, table_name, operation, record_id, payload, idempotency_key, created_at")
    .is("synced_at", null)
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (fetchErr) {
    console.error("[sync-worker] Failed to read sync_outbox:", fetchErr.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log("[sync-worker] No pending rows.");
    return;
  }

  let ok = 0;
  for (const row of rows) {
    const cloudRow = {
      id: row.id,
      tenant_id: row.tenant_id,
      table_name: row.table_name,
      operation: row.operation,
      record_id: row.record_id,
      payload: row.payload,
      idempotency_key: row.idempotency_key,
      source_created_at: row.created_at,
    };

    const { error: insErr } = await cloud.from("sync_events").upsert(cloudRow, {
      onConflict: "id",
    });

    if (insErr) {
      console.error(`[sync-worker] Cloud insert failed for ${row.id}:`, insErr.message);
      continue;
    }

    const { error: updErr } = await local
      .from("sync_outbox")
      .update({ synced_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updErr) {
      console.error(`[sync-worker] Failed to mark synced ${row.id}:`, updErr.message);
      continue;
    }

    ok += 1;
  }

  console.log(`[sync-worker] Synced ${ok}/${rows.length} row(s) via local Supabase.`);
}

async function run() {
  if (databaseUrl) {
    await runWithPg(databaseUrl);
  } else if (localUrl && localKey) {
    await runWithSupabaseLocal();
  } else {
    console.error(
      "[sync-worker] Set DATABASE_URL (Postgres + Fastify) or LOCAL_SUPABASE_URL + LOCAL_SERVICE_ROLE_KEY (legacy)."
    );
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("[sync-worker]", e);
  process.exit(1);
});
