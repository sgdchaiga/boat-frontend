-- Journal entries and GL: double-entry bookkeeping
-- General Ledger, Trial Balance, Income Statement, Balance Sheet, Cashflow all reference these tables.

-- GL Accounts (chart of accounts) - create if not present
CREATE TABLE IF NOT EXISTS gl_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE,
  account_name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  category text,
  parent_id uuid REFERENCES gl_accounts(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Journal header: one per transaction
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT current_date,
  description text NOT NULL,
  reference_type text,
  reference_id uuid,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES staff(id) ON DELETE SET NULL
);

-- Journal lines: debit and credit per account (sum of debits must equal sum of credits per entry)
CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  gl_account_id uuid NOT NULL REFERENCES gl_accounts(id) ON DELETE RESTRICT,
  debit numeric(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  line_description text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CHECK (debit = 0 OR credit = 0)
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account ON journal_entry_lines(gl_account_id);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can manage journal_entries"
  ON journal_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can manage journal_entry_lines"
  ON journal_entry_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
