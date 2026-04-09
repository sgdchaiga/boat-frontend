-- LAN / on-prem Supabase: one business per server (hotel + retail in one BOAT install).
-- Apply to the self-hosted project used on-site.

CREATE TABLE IF NOT EXISTS tenant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cloud_tenant_id uuid NOT NULL UNIQUE,
  business_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenant_settings IS 'Single row per server install: links this LAN database to the cloud tenant id.';

CREATE TABLE IF NOT EXISTS sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz
);

CREATE INDEX IF NOT EXISTS sync_outbox_pending_idx
  ON sync_outbox (created_at)
  WHERE synced_at IS NULL;

COMMENT ON TABLE sync_outbox IS 'LAN → cloud sync queue; processed by npm run sync:worker using service role.';

ALTER TABLE sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_outbox_insert_authenticated"
  ON sync_outbox FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "sync_outbox_select_authenticated"
  ON sync_outbox FOR SELECT TO authenticated
  USING (true);

-- After migrate:
-- INSERT INTO tenant_settings (cloud_tenant_id, business_name) VALUES ('<uuid>', 'Property name');
-- Set VITE_TENANT_ID to the same value as cloud_tenant_id in the BOAT web app build.
