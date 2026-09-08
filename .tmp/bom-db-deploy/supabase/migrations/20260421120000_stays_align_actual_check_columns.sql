-- Ensure stays uses actual_check_in / actual_check_out (app + types expect these names).
-- Handles DBs that used check_in_time / check_out_time or are missing columns entirely.

-- ---- actual_check_in -------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'check_in_time'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'actual_check_in'
  ) THEN
    ALTER TABLE public.stays RENAME COLUMN check_in_time TO actual_check_in;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'actual_check_in'
  ) THEN
    ALTER TABLE public.stays ADD COLUMN actual_check_in timestamptz;
    UPDATE public.stays SET actual_check_in = COALESCE(created_at, now()) WHERE actual_check_in IS NULL;
    ALTER TABLE public.stays ALTER COLUMN actual_check_in SET DEFAULT now();
    ALTER TABLE public.stays ALTER COLUMN actual_check_in SET NOT NULL;
  END IF;
END $$;

-- ---- actual_check_out ------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'check_out_time'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'actual_check_out'
  ) THEN
    ALTER TABLE public.stays RENAME COLUMN check_out_time TO actual_check_out;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stays' AND column_name = 'actual_check_out'
  ) THEN
    ALTER TABLE public.stays ADD COLUMN actual_check_out timestamptz NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.stays.actual_check_in IS 'When the guest checked in (timestamptz).';
COMMENT ON COLUMN public.stays.actual_check_out IS 'When the guest checked out; NULL = still in house.';

NOTIFY pgrst, 'reload schema';
