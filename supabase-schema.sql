-- Run this SQL in your Supabase project (SQL Editor) to create tables
-- for saving loans, fixed deposits, fixed assets, and journal entries.

-- ========== AUTH: user_profiles (required for sign-in to work) ==========
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'teller' CHECK (role IN ('admin','manager','teller')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Allow authenticated users to read their own profile and service role to manage
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
CREATE POLICY "Users can read own profile" ON user_profiles FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
CREATE POLICY "Users can insert own profile" ON user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Trigger: create profile when new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'teller')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Add columns to cashbook if missing (for reference, category, member links)
ALTER TABLE cashbook ADD COLUMN IF NOT EXISTS reference text DEFAULT '';
ALTER TABLE cashbook ADD COLUMN IF NOT EXISTS category text DEFAULT '';
ALTER TABLE cashbook ADD COLUMN IF NOT EXISTS member_id uuid;
ALTER TABLE cashbook ADD COLUMN IF NOT EXISTS member_name text;

-- Loans table
CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  loan_type text NOT NULL,
  amount numeric NOT NULL,
  interest_rate numeric NOT NULL,
  term integer NOT NULL,
  monthly_payment numeric NOT NULL,
  application_date date NOT NULL,
  approval_date date,
  disbursement_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','disbursed','closed','defaulted')),
  balance numeric NOT NULL,
  paid_amount numeric NOT NULL DEFAULT 0,
  guarantors jsonb DEFAULT '[]'::jsonb,
  purpose text DEFAULT '',
  approval_stage integer DEFAULT 0,
  interest_basis text DEFAULT 'declining' CHECK (interest_basis IN ('flat','declining')),
  fees jsonb,
  created_at timestamptz DEFAULT now()
);

-- Fixed deposits table
CREATE TABLE IF NOT EXISTS fixed_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  amount numeric NOT NULL,
  interest_rate numeric NOT NULL,
  term integer NOT NULL,
  start_date date NOT NULL,
  maturity_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','matured','withdrawn')),
  interest_earned numeric DEFAULT 0,
  auto_renew boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Fixed assets table
CREATE TABLE IF NOT EXISTS fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  purchase_date date NOT NULL,
  purchase_cost numeric NOT NULL,
  current_value numeric NOT NULL,
  depreciation_rate numeric NOT NULL,
  location text DEFAULT '',
  condition text DEFAULT 'Good' CHECK (condition IN ('Excellent','Good','Fair','Poor')),
  serial_number text DEFAULT '',
  status text NOT NULL DEFAULT 'In Use' CHECK (status IN ('In Use','Disposed','Under Repair')),
  created_at timestamptz DEFAULT now()
);

-- Journal entries table (entries stored as JSONB)
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  description text NOT NULL,
  reference text DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('posted','draft')),
  entries jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS (Row Level Security) - optional but recommended
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (adjust policy to match your auth setup)
CREATE POLICY "Allow all for anon" ON loans FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON fixed_deposits FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON fixed_assets FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON journal_entries FOR ALL USING (true);
