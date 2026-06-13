-- Retire cash receipts and reverse journals when a retail POS sale is hard-deleted.

CREATE OR REPLACE FUNCTION public.reverse_retail_pos_cash_for_deleted_sale(
  p_sale_id uuid,
  p_organization_id uuid,
  p_created_by uuid,
  p_reason text DEFAULT 'Retail POS sale deleted'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.journal_entries%ROWTYPE;
  v_reversal_id uuid;
BEGIN
  UPDATE public.payments
  SET payment_status = 'refunded'
  WHERE organization_id = p_organization_id
    AND payment_source = 'pos_retail'
    AND transaction_id = p_sale_id::text
    AND payment_status = 'completed';

  FOR v_entry IN
    SELECT *
    FROM public.journal_entries
    WHERE organization_id = p_organization_id
      AND reference_type = 'pos'
      AND reference_id = p_sale_id
      AND coalesce(is_deleted, false) = false
      AND coalesce(is_posted, true) = true
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.journal_entries
      WHERE organization_id = p_organization_id
        AND reference_type = 'manual'
        AND reference_id = v_entry.id
        AND coalesce(is_deleted, false) = false
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.journal_entries (
      entry_date, description, reference_type, reference_id,
      created_by, organization_id, is_posted, is_deleted
    ) VALUES (
      current_date,
      'Reversal: ' || v_entry.description || ' (' || p_reason || ')',
      'manual',
      v_entry.id,
      p_created_by,
      p_organization_id,
      true,
      false
    )
    RETURNING id INTO v_reversal_id;

    INSERT INTO public.journal_entry_lines (
      journal_entry_id, gl_account_id, debit, credit, line_description, sort_order
    )
    SELECT
      v_reversal_id,
      gl_account_id,
      credit,
      debit,
      'Reversal: ' || coalesce(line_description, v_entry.description),
      sort_order
    FROM public.journal_entry_lines
    WHERE journal_entry_id = v_entry.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_retail_pos_cash_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.reverse_retail_pos_cash_for_deleted_sale(
    OLD.id,
    OLD.organization_id,
    OLD.created_by,
    'Retail POS sale deleted'
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_retail_pos_cash_before_delete ON public.retail_sales;
CREATE TRIGGER trg_reverse_retail_pos_cash_before_delete
BEFORE DELETE ON public.retail_sales
FOR EACH ROW
EXECUTE FUNCTION public.reverse_retail_pos_cash_before_delete();

-- Repair completed Treasury collections left behind by already-deleted retail sales.
DO $$
DECLARE
  v_orphan record;
BEGIN
  FOR v_orphan IN
    SELECT DISTINCT
      p.transaction_id::uuid AS sale_id,
      p.organization_id
    FROM public.payments p
    WHERE p.payment_source = 'pos_retail'
      AND p.payment_status = 'completed'
      AND p.transaction_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND NOT EXISTS (
        SELECT 1 FROM public.retail_sales rs WHERE rs.id::text = p.transaction_id
      )
  LOOP
    PERFORM public.reverse_retail_pos_cash_for_deleted_sale(
      v_orphan.sale_id,
      v_orphan.organization_id,
      NULL,
      'Repair orphaned deleted retail POS sale'
    );
  END LOOP;
END;
$$;

-- Reconcile legacy rows whose payment was refunded but sale header remained posted.
UPDATE public.retail_sales rs
SET sale_status = 'refunded',
    payment_status = 'refunded',
    amount_paid = 0,
    amount_due = 0,
    change_amount = 0,
    updated_at = now()
WHERE EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.organization_id = rs.organization_id
      AND p.transaction_id = rs.id::text
      AND p.payment_source = 'pos_retail'
      AND p.payment_status = 'refunded'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.organization_id = rs.organization_id
      AND p.transaction_id = rs.id::text
      AND p.payment_source = 'pos_retail'
      AND p.payment_status = 'completed'
  )
  AND (rs.sale_status <> 'refunded' OR rs.payment_status <> 'refunded' OR rs.amount_paid <> 0 OR rs.amount_due <> 0);

GRANT EXECUTE ON FUNCTION public.reverse_retail_pos_cash_for_deleted_sale(uuid, uuid, uuid, text) TO authenticated;
