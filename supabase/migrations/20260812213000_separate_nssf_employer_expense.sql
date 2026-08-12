-- Show employer NSSF separately from gross salaries on the income statement.
ALTER TABLE public.payroll_org_settings
  ADD COLUMN IF NOT EXISTS nssf_employer_expense_gl_account_id uuid
  REFERENCES public.gl_accounts(id) ON DELETE SET NULL;

DO $$
DECLARE
  s record;
  v_account_id uuid;
  v_parent_id uuid;
  v_business_type text;
  v_code text;
  v_run record;
  v_nssf numeric(18,2);
BEGIN
  FOR s IN
    SELECT organization_id, salary_expense_gl_account_id
    FROM public.payroll_org_settings
  LOOP
    -- Prefer the school chart's existing statutory-contribution account.
    SELECT id INTO v_account_id
    FROM public.gl_accounts
    WHERE organization_id = s.organization_id AND account_code = '6110'
    LIMIT 1;

    IF v_account_id IS NOT NULL THEN
      UPDATE public.gl_accounts
      SET account_name = 'NSSF Employer Contribution', account_type = 'expense', category = 'expense'
      WHERE id = v_account_id;
    ELSE
      SELECT id INTO v_parent_id FROM public.gl_accounts
      WHERE organization_id = s.organization_id AND account_code = '6000' LIMIT 1;
      SELECT business_type INTO v_business_type FROM public.gl_accounts
      WHERE id = s.salary_expense_gl_account_id LIMIT 1;
      v_code := '6110';
      IF EXISTS (SELECT 1 FROM public.gl_accounts WHERE organization_id = s.organization_id AND account_code = v_code) THEN
        v_code := '6115';
      END IF;
      INSERT INTO public.gl_accounts
        (organization_id, account_code, account_name, account_type, category, parent_id, is_active, business_type)
      VALUES
        (s.organization_id, v_code, 'NSSF Employer Contribution', 'expense', 'expense', v_parent_id, true, v_business_type)
      RETURNING id INTO v_account_id;
    END IF;

    UPDATE public.payroll_org_settings
    SET nssf_employer_expense_gl_account_id = v_account_id
    WHERE organization_id = s.organization_id
      AND nssf_employer_expense_gl_account_id IS NULL;

    -- Correct legacy posted payroll journals whose salary debit included employer NSSF.
    FOR v_run IN
      SELECT pr.id, pr.journal_entry_id
      FROM public.payroll_runs pr
      WHERE pr.organization_id = s.organization_id
        AND pr.journal_entry_id IS NOT NULL
    LOOP
      SELECT COALESCE(SUM(nssf_employer), 0) INTO v_nssf
      FROM public.payroll_run_lines WHERE payroll_run_id = v_run.id;

      IF v_nssf > 0 AND NOT EXISTS (
        SELECT 1 FROM public.journal_entry_lines
        WHERE journal_entry_id = v_run.journal_entry_id
          AND line_description = 'NSSF employer contribution'
      ) THEN
        UPDATE public.journal_entry_lines
        SET debit = GREATEST(0, debit - v_nssf),
            line_description = 'Gross salaries and wages'
        WHERE journal_entry_id = v_run.journal_entry_id
          AND gl_account_id = s.salary_expense_gl_account_id
          AND line_description = 'Payroll salary & employer NSSF expense';

        IF FOUND THEN
          INSERT INTO public.journal_entry_lines
            (journal_entry_id, gl_account_id, debit, credit, line_description)
          VALUES
            (v_run.journal_entry_id, v_account_id, v_nssf, 0, 'NSSF employer contribution');
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMENT ON COLUMN public.payroll_org_settings.nssf_employer_expense_gl_account_id IS
  'Expense account debited separately for the employer share of NSSF.';
