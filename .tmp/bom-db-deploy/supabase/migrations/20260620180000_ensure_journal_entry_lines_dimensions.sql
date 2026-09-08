-- Ensure journal line dimensions column exists for environments that missed
-- the dimensions migration but already run newer RPC/function definitions.
ALTER TABLE public.journal_entry_lines
  ADD COLUMN IF NOT EXISTS dimensions jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.journal_entry_lines.dimensions IS
  'Optional analytics dimensions, e.g. {"branch":"Main","department_id":"uuid"}.';

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_dimensions_gin
  ON public.journal_entry_lines USING gin (dimensions jsonb_path_ops);
