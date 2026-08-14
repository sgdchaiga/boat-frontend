-- Retail credit lifecycle fields for mixed/credit sales and collection tracking.

ALTER TABLE public.retail_sales
  ADD COLUMN IF NOT EXISTS sale_type text NOT NULL DEFAULT 'cash' CHECK (sale_type IN ('cash', 'credit', 'mixed')),
  ADD COLUMN IF NOT EXISTS credit_due_date date;

ALTER TABLE public.retail_customers
  ADD COLUMN IF NOT EXISTS credit_limit numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  ADD COLUMN IF NOT EXISTS current_credit_balance numeric(15,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.retail_sales.sale_type IS
  'Cash = fully paid now; Credit = no immediate cash; Mixed = part paid, part credit.';
COMMENT ON COLUMN public.retail_sales.credit_due_date IS
  'Optional due date when sale has a credit balance.';
COMMENT ON COLUMN public.retail_customers.credit_limit IS
  'Customer-level credit limit for POS credit control.';
COMMENT ON COLUMN public.retail_customers.current_credit_balance IS
  'Running credit exposure from open retail POS balances (for quick checks).';
