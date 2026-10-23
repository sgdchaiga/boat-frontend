-- Transitional Google Sheets cashbook sync.  A sheet remains read-only to BOAT;
-- imported rows keep their source identity so repeated synchronisation is safe.
CREATE TABLE IF NOT EXISTS public.sacco_cashbook_sync_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Google Sheets cashbook',
  spreadsheet_id text NOT NULL,
  sheet_name text NOT NULL,
  header_row integer NOT NULL DEFAULT 1 CHECK (header_row > 0),
  column_map jsonb NOT NULL DEFAULT '{"date":"Date","description":"Description","reference":"Reference","category":"Category","debit":"Debit","credit":"Credit","balance":"Balance","member_name":"Member"}'::jsonb,
  auto_sync_enabled boolean NOT NULL DEFAULT true,
  sync_frequency_minutes integer NOT NULL DEFAULT 15 CHECK (sync_frequency_minutes BETWEEN 5 AND 1440),
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, spreadsheet_id, sheet_name)
);

CREATE TABLE IF NOT EXISTS public.sacco_cashbook_sync_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.sacco_cashbook_sync_sources(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL,
  source_hash text NOT NULL,
  cashbook_entry_id uuid REFERENCES public.sacco_cashbook_entries(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','invalid','changed_after_import')),
  message text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_row_number)
);

ALTER TABLE public.sacco_cashbook_entries
  ADD COLUMN IF NOT EXISTS external_source_id uuid REFERENCES public.sacco_cashbook_sync_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_row_number integer,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sacco_cashbook_external_row
  ON public.sacco_cashbook_entries(external_source_id, external_row_number)
  WHERE external_source_id IS NOT NULL AND external_row_number IS NOT NULL;

ALTER TABLE public.sacco_cashbook_sync_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sacco_cashbook_sync_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sacco_cashbook_sync_sources_org ON public.sacco_cashbook_sync_sources;
CREATE POLICY sacco_cashbook_sync_sources_org ON public.sacco_cashbook_sync_sources FOR ALL TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
DROP POLICY IF EXISTS sacco_cashbook_sync_rows_org ON public.sacco_cashbook_sync_rows;
CREATE POLICY sacco_cashbook_sync_rows_org ON public.sacco_cashbook_sync_rows FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM public.staff WHERE id = auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sacco_cashbook_sync_sources TO authenticated;
GRANT SELECT ON public.sacco_cashbook_sync_rows TO authenticated;
GRANT ALL ON public.sacco_cashbook_sync_sources, public.sacco_cashbook_sync_rows TO service_role;

DROP TRIGGER IF EXISTS trg_sacco_cashbook_sync_sources_touch ON public.sacco_cashbook_sync_sources;
CREATE TRIGGER trg_sacco_cashbook_sync_sources_touch BEFORE UPDATE ON public.sacco_cashbook_sync_sources
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_cb_updated_at();
DROP TRIGGER IF EXISTS trg_sacco_cashbook_sync_rows_touch ON public.sacco_cashbook_sync_rows;
CREATE TRIGGER trg_sacco_cashbook_sync_rows_touch BEFORE UPDATE ON public.sacco_cashbook_sync_rows
FOR EACH ROW EXECUTE FUNCTION public.touch_sacco_cb_updated_at();

COMMENT ON TABLE public.sacco_cashbook_sync_sources IS 'Read-only external cashbook sources during a controlled migration to BOAT.';
COMMENT ON TABLE public.sacco_cashbook_sync_rows IS 'Immutable import audit: changed spreadsheet rows are flagged, never silently overwrite a BOAT cashbook entry.';
