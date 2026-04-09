-- Add human-readable transaction_id to journal_entries (e.g. JE-00001)

CREATE SEQUENCE IF NOT EXISTS journal_entries_transaction_seq;

-- Add column nullable first
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS transaction_id text;

-- Backfill existing rows with JE-00001, JE-00002, ...
WITH numbered AS (
  SELECT id, 'JE-' || lpad(row_number() OVER (ORDER BY created_at, id)::text, 5, '0') AS tid
  FROM journal_entries
  WHERE transaction_id IS NULL
)
UPDATE journal_entries j
SET transaction_id = n.tid
FROM numbered n
WHERE j.id = n.id;

-- Set sequence so next insert gets next number
SELECT setval(
  'journal_entries_transaction_seq',
  COALESCE(
    (SELECT MAX(CAST(NULLIF(REGEXP_REPLACE(transaction_id, '^JE-', ''), '') AS INTEGER)) FROM journal_entries WHERE transaction_id ~ '^JE-[0-9]+$'),
    0
  )
);

-- Default for new rows
ALTER TABLE journal_entries
  ALTER COLUMN transaction_id SET DEFAULT ('JE-' || lpad(nextval('journal_entries_transaction_seq')::text, 5, '0'));

-- Enforce unique and not null (drop first if re-running migration)
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_transaction_id_key;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_transaction_id_key UNIQUE (transaction_id);
ALTER TABLE journal_entries ALTER COLUMN transaction_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_transaction_id ON journal_entries(transaction_id);
