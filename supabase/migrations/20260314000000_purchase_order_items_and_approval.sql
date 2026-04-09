-- Purchase order line items, department, approval, and convert-to-bill support

-- Ensure departments exists (used by POS/products)
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Purchase order line items
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description text NOT NULL,
  cost_price numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Add department and approval columns to purchase_orders
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS approved_by uuid;

-- Link bills to source purchase order when converted
ALTER TABLE bills ADD COLUMN IF NOT EXISTS purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for purchase_order_items" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);
