-- Surface posted Modern-mode cash movements in the Cash Book register.
CREATE OR REPLACE FUNCTION public.cashbook_modern_gl_entries(
  p_organization_id uuid,
  p_date_from date,
  p_date_to date,
  p_limit integer DEFAULT 2000
) RETURNS TABLE(
  journal_entry_id uuid,
  entry_date date,
  description text,
  reference_type text,
  reference_id uuid,
  created_at timestamptz,
  cash_account_name text,
  cash_movement numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH cash_lines AS (
    SELECT
      je.id AS journal_entry_id,
      je.entry_date,
      je.description,
      je.reference_type,
      je.reference_id,
      je.created_at,
      string_agg(DISTINCT ga.account_name, ', ' ORDER BY ga.account_name) AS cash_account_name,
      sum(coalesce(jel.debit, 0) - coalesce(jel.credit, 0)) AS cash_movement
    FROM public.journal_entries je
    JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
    JOIN public.gl_accounts ga ON ga.id = jel.gl_account_id
    WHERE je.organization_id = p_organization_id
      AND je.is_posted = true
      AND je.is_deleted = false
      AND je.entry_date BETWEEN p_date_from AND p_date_to
      AND ga.account_type = 'asset'
      AND (
        lower(coalesce(ga.category, '')) = 'cash'
        OR lower(coalesce(ga.category, '')) LIKE '%cash equivalent%'
        OR lower(coalesce(ga.account_name, '')) ~ '(cash|petty cash|imprest|float|till|bank|current account|checking|savings account|mobile money|momo|mpesa|m-pesa|airtel money|mtn money|wallet)'
      )
    GROUP BY je.id, je.entry_date, je.description, je.reference_type, je.reference_id, je.created_at
    HAVING abs(sum(coalesce(jel.debit, 0) - coalesce(jel.credit, 0))) > 0.01
  )
  SELECT * FROM cash_lines
  ORDER BY entry_date DESC, created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 2000), 10000));
$$;

GRANT EXECUTE ON FUNCTION public.cashbook_modern_gl_entries(uuid, date, date, integer) TO authenticated;
