-- Backfill missing asset recognition for payroll loans and missing accrual
-- journals for issued school-fee invoices. Existing active journals are left intact.
DO $$
DECLARE
  r record;
  v_journal_id uuid;
  v_staff_advance uuid;
  v_cash uuid;
  v_receivable uuid;
  v_revenue uuid;
BEGIN
  FOR r IN
    SELECT l.*, ps.staff_loan_receivable_gl_account_id
    FROM public.payroll_loans l
    JOIN public.payroll_org_settings ps ON ps.organization_id = l.organization_id
    WHERE l.principal_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries je
        WHERE je.reference_type = 'payroll_loan_disbursement'
          AND je.reference_id = l.id AND COALESCE(je.is_deleted, false) = false
      )
  LOOP
    v_staff_advance := r.staff_loan_receivable_gl_account_id;
    SELECT cash_gl_account_id INTO v_cash FROM public.journal_gl_settings WHERE organization_id = r.organization_id;
    IF v_staff_advance IS NOT NULL AND v_cash IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, description, reference_type, reference_id, organization_id, is_posted, is_deleted)
      VALUES (COALESCE(r.created_at::date, CURRENT_DATE), 'Staff loan disbursed' || CASE WHEN r.reference IS NULL THEN '' ELSE ' — ' || r.reference END,
              'payroll_loan_disbursement', r.id, r.organization_id, true, false)
      RETURNING id INTO v_journal_id;
      INSERT INTO public.journal_entry_lines(journal_entry_id, gl_account_id, debit, credit, line_description, sort_order, dimensions)
      VALUES
        (v_journal_id, v_staff_advance, r.principal_amount, 0, 'Staff advance disbursed', 0, jsonb_build_object('staff_id', r.staff_id)),
        (v_journal_id, v_cash, 0, r.principal_amount, 'Cash paid to staff', 1, jsonb_build_object('staff_id', r.staff_id));
    END IF;
  END LOOP;

  FOR r IN
    SELECT i.*
    FROM public.student_invoices i
    JOIN public.journal_gl_settings s ON s.organization_id = i.organization_id
    WHERE COALESCE(s.school_accounting_basis, 'accrual') = 'accrual'
      AND i.status NOT IN ('draft', 'cancelled') AND i.total_due > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entries je
        WHERE je.reference_type = 'school_invoice'
          AND je.reference_id = i.id AND COALESCE(je.is_deleted, false) = false
      )
  LOOP
    SELECT receivable_gl_account_id, revenue_gl_account_id INTO v_receivable, v_revenue
    FROM public.journal_gl_settings WHERE organization_id = r.organization_id;
    IF v_receivable IS NOT NULL AND v_revenue IS NOT NULL THEN
      INSERT INTO public.journal_entries(entry_date, description, reference_type, reference_id, organization_id, is_posted, is_deleted)
      VALUES (COALESCE(r.issue_date, r.created_at::date, CURRENT_DATE), 'School fees receivable: ' || r.invoice_number,
              'school_invoice', r.id, r.organization_id, true, false)
      RETURNING id INTO v_journal_id;
      INSERT INTO public.journal_entry_lines(journal_entry_id, gl_account_id, debit, credit, line_description, sort_order, dimensions)
      VALUES
        (v_journal_id, v_receivable, r.total_due, 0, 'Student fees receivable', 0, jsonb_build_object('student_id', r.student_id)),
        (v_journal_id, v_revenue, 0, r.total_due, 'Fee income (accrual)', 1, jsonb_build_object('student_id', r.student_id));
    END IF;
  END LOOP;
END $$;
