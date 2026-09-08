-- Phase 2: timesheet and engagement-expense submission/approval workflows.

ALTER TABLE public.practice_time_entries
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS practice_task_id uuid REFERENCES public.practice_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_submitted_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_approval_status text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS practice_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS practice_approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS practice_rejection_reason text,
  ADD COLUMN IF NOT EXISTS recoverable_from_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_storage_path text;

ALTER TABLE public.expenses DROP CONSTRAINT IF EXISTS expenses_practice_approval_status_check;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_practice_approval_status_check
  CHECK (practice_approval_status IN ('not_applicable','draft','submitted','approved','rejected'));

CREATE INDEX IF NOT EXISTS idx_practice_time_staff_week ON public.practice_time_entries (organization_id, staff_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_practice_time_approval_queue ON public.practice_time_entries (organization_id, approval_status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_expenses_practice_approval_queue ON public.expenses (organization_id, practice_approval_status, practice_submitted_at) WHERE practice_engagement_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('practice-expense-receipts', 'practice-expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS practice_expense_receipts_same_org ON storage.objects;
CREATE POLICY practice_expense_receipts_same_org ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'practice-expense-receipts' AND (public.is_platform_admin() OR (storage.foldername(name))[1] = (SELECT s.organization_id::text FROM public.staff s WHERE s.id = auth.uid())))
WITH CHECK (bucket_id = 'practice-expense-receipts' AND (public.is_platform_admin() OR (storage.foldername(name))[1] = (SELECT s.organization_id::text FROM public.staff s WHERE s.id = auth.uid())));
