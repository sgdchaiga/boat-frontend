-- Bills: approval columns + normalize status values for GRN/bills workflow

ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

-- Backfill approval timestamp for bills that were already approved or paid
UPDATE public.bills
SET approved_at = COALESCE(approved_at, created_at)
WHERE status IN ('approved', 'paid', 'overdue', 'partially_paid')
  AND approved_at IS NULL;

-- Map legacy status values
UPDATE public.bills SET status = 'pending_approval' WHERE status = 'pending';
UPDATE public.bills SET status = 'pending_approval' WHERE status IS NULL;
UPDATE public.bills SET status = 'partially_paid' WHERE status = 'approved';
