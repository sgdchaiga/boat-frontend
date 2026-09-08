-- Ensure public.gender_types exists (fixes PGRST205 when older migrations were not applied).
-- Admin → Gender Types uses this table.

CREATE TABLE IF NOT EXISTS public.gender_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gender_types_code_len CHECK (char_length(code) = 1),
  CONSTRAINT gender_types_code_unique UNIQUE (code)
);

COMMENT ON TABLE public.gender_types IS 'Lookup: 1-character gender code (e.g. M, F, O) and display name.';

ALTER TABLE public.gender_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for gender_types" ON public.gender_types;
DROP POLICY IF EXISTS "gender_types_authenticated_all" ON public.gender_types;
DROP POLICY IF EXISTS "gender_types_service_role_all" ON public.gender_types;

CREATE POLICY "gender_types_authenticated_all"
  ON public.gender_types
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "gender_types_service_role_all"
  ON public.gender_types
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gender_types TO authenticated;
GRANT ALL ON TABLE public.gender_types TO service_role;

-- Optional seed (skip if rows exist)
INSERT INTO public.gender_types (code, name, is_active)
VALUES
  ('M', 'Male', true),
  ('F', 'Female', true),
  ('O', 'Other', true)
ON CONFLICT (code) DO NOTHING;
