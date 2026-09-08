-- Hosted (multi-tenant) Supabase: receives mirrored events from each business LAN server.
-- Apply to your cloud BOAT project.

CREATE TABLE IF NOT EXISTS sync_events (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  table_name text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  source_created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS sync_events_tenant_received_idx
  ON sync_events (tenant_id, received_at DESC);

COMMENT ON TABLE sync_events IS 'Append-only mirror of LAN sync_outbox; worker inserts with service role only.';

ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
