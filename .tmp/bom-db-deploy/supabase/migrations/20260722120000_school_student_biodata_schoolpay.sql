-- Student biodata and SchoolPay support.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS other_names text,
  ADD COLUMN IF NOT EXISTS school_pay_number text,
  ADD COLUMN IF NOT EXISTS learner_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_org_school_pay_number
  ON public.students (organization_id, school_pay_number)
  WHERE school_pay_number IS NOT NULL AND btrim(school_pay_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_org_learner_id
  ON public.students (organization_id, learner_id)
  WHERE learner_id IS NOT NULL AND btrim(learner_id) <> '';

ALTER TABLE public.school_payments DROP CONSTRAINT IF EXISTS school_payments_method_check;
ALTER TABLE public.school_payments
  ADD CONSTRAINT school_payments_method_check
  CHECK (method IN ('cash', 'mobile_money', 'bank', 'transfer', 'school_pay', 'other', 'wallet'));

COMMENT ON COLUMN public.students.school_pay_number IS 'SchoolPay payment/reference number assigned to the learner.';
COMMENT ON COLUMN public.students.learner_id IS 'External learner identifier, including SchoolPay learner ID where applicable.';
