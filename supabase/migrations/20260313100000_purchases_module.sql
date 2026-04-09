-- Purchases module: vendors, expenses, purchase_orders, bills, vendor_payments, vendor_credits

-- Vendors (suppliers)
CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  address text,
  created_at timestamptz DEFAULT now()
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  description text,
  expense_date date DEFAULT current_date,
  category text,
  created_at timestamptz DEFAULT now()
);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  order_date date DEFAULT current_date,
  status text DEFAULT 'pending',
  total_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Bills (vendor invoices / payables)
CREATE TABLE IF NOT EXISTS bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  bill_date date DEFAULT current_date,
  due_date date,
  amount numeric NOT NULL,
  description text,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- Vendor Payments (payments made to vendors)
CREATE TABLE IF NOT EXISTS vendor_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  bill_id uuid REFERENCES bills(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  payment_date date DEFAULT current_date,
  payment_method text DEFAULT 'bank_transfer',
  reference text,
  created_at timestamptz DEFAULT now()
);

-- Vendor Credits (refunds/credits from vendors)
CREATE TABLE IF NOT EXISTS vendor_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  amount numeric NOT NULL,
  reason text,
  credit_date date DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

-- RLS: enable for service role (adjust policies for your auth setup)
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_credits ENABLE ROW LEVEL SECURITY;

-- Allow full access (customize RLS policies for your auth/roles)
CREATE POLICY "Allow all for vendors" ON vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for purchase_orders" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for bills" ON bills FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for vendor_payments" ON vendor_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for vendor_credits" ON vendor_credits FOR ALL USING (true) WITH CHECK (true);
