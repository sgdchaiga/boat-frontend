-- Allow school fee payments recorded as wallet (student wallet debit).

ALTER TABLE public.school_payments DROP CONSTRAINT IF EXISTS school_payments_method_check;

ALTER TABLE public.school_payments
  ADD CONSTRAINT school_payments_method_check CHECK (
    method IN ('cash', 'mobile_money', 'bank', 'transfer', 'other', 'wallet')
  );
