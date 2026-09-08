-- Phase 1 hardening: restrict profitability output to management/finance roles.

CREATE OR REPLACE VIEW public.practice_engagement_financial_summary
WITH (security_invoker = true)
AS
SELECT
  e.id AS engagement_id, e.organization_id, e.client_id, e.engagement_number,
  e.title, e.service_type, e.status, e.contract_value, e.budgeted_hours,
  e.budgeted_staff_cost, e.budgeted_expenses,
  COALESCE(inv.amount_invoiced, 0)::numeric(18,2) AS amount_invoiced,
  COALESCE(inv.amount_paid, 0)::numeric(18,2) AS amount_collected,
  COALESCE(tm.actual_hours, 0)::numeric(18,2) AS actual_hours,
  COALESCE(tm.staff_cost, 0)::numeric(18,2) AS actual_staff_cost,
  COALESCE(ex.direct_expenses, 0)::numeric(18,2) AS direct_expenses,
  (COALESCE(inv.amount_invoiced, 0) - COALESCE(tm.staff_cost, 0) - COALESCE(ex.direct_expenses, 0))::numeric(18,2) AS gross_profit,
  CASE WHEN COALESCE(inv.amount_invoiced, 0) = 0 THEN 0 ELSE ((COALESCE(inv.amount_invoiced, 0) - COALESCE(tm.staff_cost, 0) - COALESCE(ex.direct_expenses, 0)) / inv.amount_invoiced * 100)::numeric(8,2) END AS profit_margin,
  GREATEST(e.contract_value - COALESCE(inv.amount_invoiced, 0), 0)::numeric(18,2) AS unbilled_contract_value
FROM public.practice_engagements e
LEFT JOIN (SELECT practice_engagement_id, SUM(total) FILTER (WHERE status <> 'void') amount_invoiced, SUM(total) FILTER (WHERE status = 'paid') amount_paid FROM public.retail_invoices WHERE practice_engagement_id IS NOT NULL GROUP BY practice_engagement_id) inv ON inv.practice_engagement_id = e.id
LEFT JOIN (SELECT engagement_id, SUM(hours) actual_hours, SUM(staff_cost_amount) staff_cost FROM public.practice_time_entries WHERE approval_status = 'approved' GROUP BY engagement_id) tm ON tm.engagement_id = e.id
LEFT JOIN (SELECT practice_engagement_id, SUM(amount) direct_expenses FROM public.expenses WHERE practice_engagement_id IS NOT NULL GROUP BY practice_engagement_id) ex ON ex.practice_engagement_id = e.id
WHERE public.is_platform_admin()
   OR EXISTS (SELECT 1 FROM public.staff s WHERE s.id = auth.uid() AND s.organization_id = e.organization_id AND lower(s.role) IN ('owner','admin','super_admin','manager','finance_manager','accountant'));

GRANT SELECT ON public.practice_engagement_financial_summary TO authenticated;
