CREATE TABLE IF NOT EXISTS public.user_app_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  general_business_mode text NOT NULL DEFAULT 'modern'
    CHECK (general_business_mode IN ('modern', 'cashbook')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

ALTER TABLE public.user_app_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_manage_own_app_preferences" ON public.user_app_preferences;
CREATE POLICY "users_manage_own_app_preferences"
  ON public.user_app_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.staff s
      WHERE s.id = auth.uid() AND s.organization_id = user_app_preferences.organization_id
    )
  );

CREATE OR REPLACE FUNCTION public.cashbook_daily_gl_position(
  p_organization_id uuid,
  p_date date
) RETURNS TABLE(opening_balance numeric, day_movement numeric, closing_balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH cash_accounts AS (
    SELECT id
    FROM public.gl_accounts
    WHERE organization_id = p_organization_id
      AND account_type = 'asset'
      AND (
        lower(coalesce(category, '')) = 'cash'
        OR lower(coalesce(category, '')) LIKE '%cash equivalent%'
        OR lower(coalesce(account_name, '')) ~ '(cash|petty cash|imprest|float|till|bank|current account|checking|savings account|mobile money|momo|mpesa|m-pesa|airtel money|mtn money|wallet)'
      )
  ), movements AS (
    SELECT je.entry_date, sum(coalesce(jel.debit, 0) - coalesce(jel.credit, 0)) AS amount
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    JOIN cash_accounts ca ON ca.id = jel.gl_account_id
    WHERE je.organization_id = p_organization_id
      AND je.is_posted = true
      AND je.is_deleted = false
      AND je.entry_date <= p_date
    GROUP BY je.entry_date
  )
  SELECT
    coalesce(sum(amount) FILTER (WHERE entry_date < p_date), 0),
    coalesce(sum(amount) FILTER (WHERE entry_date = p_date), 0),
    coalesce(sum(amount), 0)
  FROM movements;
$$;

GRANT EXECUTE ON FUNCTION public.cashbook_daily_gl_position(uuid, date) TO authenticated;
