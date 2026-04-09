# BOAT deployment: online vs LAN + cloud sync (hotel & retail)

BOAT is one app for **hotel** and **retail**; both share the same Supabase schema and org-scoped data (`organization_id` / RLS).

## Modes

| `VITE_DEPLOYMENT_MODE` | Supabase target | Sync queue |
|------------------------|-------------------|------------|
| `online` (default) | Hosted project | Not used |
| `lan` | On-prem Supabase on the business server | Writes enqueue `sync_outbox` for cloud backup |

Set **`VITE_TENANT_ID`** to a stable UUID per business. It should match:

- `tenant_settings.cloud_tenant_id` on the LAN database (after you insert that row)
- How you identify that tenant in the **cloud** when you add `tenant_id` to mirrored domain tables (optional next step)

Often this aligns with your **`organizations.id`** for that property—pick one scheme and stay consistent.

## One server per business

1. Self-host Supabase (Docker) on-site, or use local dev with `supabase start`.
2. Apply **`supabase/migrations/20260329000001_lan_sync_outbox.sql`** to that LAN project.
3. Insert tenant metadata:

   ```sql
   INSERT INTO tenant_settings (cloud_tenant_id, business_name)
   VALUES ('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', 'Hotel / store name');
   ```

4. Build the BOAT web app with `.env` pointing `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` at the **LAN** API, plus `VITE_DEPLOYMENT_MODE=lan` and `VITE_TENANT_ID` matching `cloud_tenant_id`.
5. Other PCs use the app via `http://<server-ip>:<port>`; they only talk to the LAN server.

## Cloud project

1. Apply **`supabase/migrations/20260329000002_cloud_sync_events.sql`** to the hosted project.
2. Keep **service role** keys only on the sync worker host, never in the browser bundle.

## Sync worker (LAN → cloud)

On the business server (or any host that can reach LAN Supabase and the internet), run on a schedule:

```bash
npm run sync:worker
```

Configure environment (e.g. systemd, Task Scheduler):

| Variable | Purpose |
|----------|---------|
| `LOCAL_SUPABASE_URL` | LAN Supabase API URL |
| `LOCAL_SERVICE_ROLE_KEY` | Service role on LAN (read `sync_outbox`, set `synced_at`) |
| `CLOUD_SUPABASE_URL` | Hosted project URL |
| `CLOUD_SERVICE_ROLE_KEY` | Hosted service role (insert into `sync_events`) |

The worker copies pending `sync_outbox` rows to **`sync_events`** and marks them synced locally.

## App integration

`enqueueSyncOutbox` is wired for example flows (**guests** = hotel, **vendors** = retail/purchases). Add the same call after other successful writes as needed.

## Next steps

- Add **`tenant_id`** (or use existing `organization_id`) on cloud tables and replay or apply `sync_events` into live rows for analytics and backup parity.
- Harden `sync_outbox` RLS if your LAN includes untrusted clients.
