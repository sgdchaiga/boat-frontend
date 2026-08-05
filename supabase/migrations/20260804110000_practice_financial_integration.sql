-- Link practice operations to BOAT's canonical invoices, expenses, journals and subscriptions.

ALTER TABLE public.practice_clients
  ADD COLUMN IF NOT EXISTS linked_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subscription_plan text,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'not_applicable';

ALTER TABLE public.retail_invoices
  ADD COLUMN IF NOT EXISTS practice_client_id uuid REFERENCES public.practice_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS practice_engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS practice_engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL;

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS practice_engagement_id uuid REFERENCES public.practice_engagements(id) ON DELETE SET NULL;

ALTER TABLE public.practice_time_entries
  ADD COLUMN IF NOT EXISTS staff_cost_amount numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_amount numeric(18,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_retail_invoices_practice_engagement ON public.retail_invoices (practice_engagement_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_practice_engagement ON public.expenses (practice_engagement_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_practice_engagement ON public.journal_entries (practice_engagement_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_practice_clients_renewal ON public.practice_clients (organization_id, renewal_date, subscription_status);

CREATE OR REPLACE VIEW public.practice_engagement_financial_summary
WITH (security_invoker = true)
AS
SELECT
  e.id AS engagement_id,
  e.organization_id,
  e.client_id,
  e.engagement_number,
  e.title,
  e.service_type,
  e.status,
  e.contract_value,
  e.budgeted_hours,
  e.budgeted_staff_cost,
  e.budgeted_expenses,
  COALESCE(inv.amount_invoiced, 0)::numeric(18,2) AS amount_invoiced,
  COALESCE(inv.amount_paid, 0)::numeric(18,2) AS amount_collected,
  COALESCE(tm.actual_hours, 0)::numeric(18,2) AS actual_hours,
  COALESCE(tm.staff_cost, 0)::numeric(18,2) AS actual_staff_cost,
  COALESCE(ex.direct_expenses, 0)::numeric(18,2) AS direct_expenses,
  (COALESCE(inv.amount_invoiced, 0) - COALESCE(tm.staff_cost, 0) - COALESCE(ex.direct_expenses, 0))::numeric(18,2) AS gross_profit,
  CASE WHEN COALESCE(inv.amount_invoiced, 0) = 0 THEN 0
    ELSE ((COALESCE(inv.amount_invoiced, 0) - COALESCE(tm.staff_cost, 0) - COALESCE(ex.direct_expenses, 0)) / inv.amount_invoiced * 100)::numeric(8,2)
  END AS profit_margin,
  GREATEST(e.contract_value - COALESCE(inv.amount_invoiced, 0), 0)::numeric(18,2) AS unbilled_contract_value
FROM public.practice_engagements e
LEFT JOIN (
  SELECT practice_engagement_id,
    SUM(total) FILTER (WHERE status <> 'void') AS amount_invoiced,
    SUM(total) FILTER (WHERE status = 'paid') AS amount_paid
  FROM public.retail_invoices WHERE practice_engagement_id IS NOT NULL GROUP BY practice_engagement_id
) inv ON inv.practice_engagement_id = e.id
LEFT JOIN (
  SELECT engagement_id, SUM(hours) AS actual_hours, SUM(staff_cost_amount) AS staff_cost
  FROM public.practice_time_entries WHERE approval_status = 'approved' GROUP BY engagement_id
) tm ON tm.engagement_id = e.id
LEFT JOIN (
  SELECT practice_engagement_id, SUM(amount) AS direct_expenses
  FROM public.expenses WHERE practice_engagement_id IS NOT NULL GROUP BY practice_engagement_id
) ex ON ex.practice_engagement_id = e.id;

GRANT SELECT ON public.practice_engagement_financial_summary TO authenticated;

COMMENT ON COLUMN public.retail_invoices.practice_engagement_id IS 'Connects a professional-services invoice to its engagement; retail_invoices remains the canonical invoice record.';
COMMENT ON COLUMN public.expenses.practice_engagement_id IS 'Connects an existing BOAT expense to an engagement for profitability reporting.';
COMMENT ON COLUMN public.journal_entries.practice_engagement_id IS 'Optional engagement dimension on canonical general-ledger journals.';
