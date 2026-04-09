-- POS: add customer_name to kitchen_orders so orders identify customer and table
ALTER TABLE kitchen_orders
  ADD COLUMN IF NOT EXISTS customer_name text;

-- Ensure kitchen_orders can link to rooms for display (if room_id references rooms)
-- No change if already correct. If kitchen_orders doesn't exist, create it:
-- CREATE TABLE IF NOT EXISTS kitchen_orders (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   room_id uuid REFERENCES rooms(id),
--   table_number text,
--   customer_name text,
--   order_status text NOT NULL DEFAULT 'pending',
--   created_at timestamptz DEFAULT now()
-- );
