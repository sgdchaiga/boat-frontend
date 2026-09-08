-- Gender types lookup table (Admin-configurable)
-- Code: 1-character code, e.g. 'M', 'F', 'O'

CREATE TABLE IF NOT EXISTS gender_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (char_length(code) = 1),
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE gender_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for gender_types"
  ON gender_types FOR ALL
  USING (true)
  WITH CHECK (true);

