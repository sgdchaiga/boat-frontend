-- A staff-recorded term deposit must be funded transactionally from a member's savings account.
-- This avoids creating an unfunded deposit through a plain table insert.
CREATE OR REPLACE FUNCTION public.open_sacco_fixed_deposit_for_member(
  p_member_id uuid,
  p_product_id uuid,
  p_source_account_id uuid,
  p_amount numeric,
  p_auto_renew boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff staff%ROWTYPE;
  v_member sacco_members%ROWTYPE;
  v_product sacco_fixed_deposit_products%ROWTYPE;
  v_account sacco_member_savings_accounts%ROWTYPE;
  v_deposit_id uuid;
  v_interest numeric;
  v_tax numeric;
  v_previous numeric;
BEGIN
  SELECT * INTO v_staff FROM staff WHERE id = auth.uid();
  IF NOT FOUND OR lower(coalesce(v_staff.role, '')) NOT IN ('accountant', 'manager', 'admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only finance managers, accountants and administrators can open fixed deposits';
  END IF;

  SELECT * INTO v_member FROM sacco_members
  WHERE id = p_member_id AND organization_id = v_staff.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member was not found'; END IF;

  SELECT * INTO v_product FROM sacco_fixed_deposit_products
  WHERE id = p_product_id AND organization_id = v_staff.organization_id AND is_active FOR SHARE;
  IF NOT FOUND OR p_amount < v_product.minimum_amount THEN
    RAISE EXCEPTION 'Choose an active product and an amount at or above its minimum';
  END IF;

  SELECT * INTO v_account FROM sacco_member_savings_accounts
  WHERE id = p_source_account_id AND organization_id = v_staff.organization_id
    AND sacco_member_id = p_member_id AND is_active FOR UPDATE;
  IF NOT FOUND OR upper(coalesce(v_account.savings_product_code, '')) IN ('SHA', 'SHARES', 'EQUITY') THEN
    RAISE EXCEPTION 'Choose an active ordinary savings account';
  END IF;
  IF v_account.balance < p_amount THEN RAISE EXCEPTION 'Insufficient available savings balance'; END IF;

  v_interest := round(p_amount * v_product.annual_rate / 100 * v_product.term_months / 12, 2);
  v_tax := round(v_interest * v_product.withholding_tax_rate / 100, 2);
  UPDATE sacco_member_savings_accounts SET balance = balance - p_amount WHERE id = v_account.id;

  INSERT INTO sacco_fixed_deposits(
    organization_id, sacco_member_id, member_name, amount, interest_rate, term_months,
    start_date, maturity_date, interest_earned, withholding_tax, net_interest,
    auto_renew, status, product_id, source_savings_account_id
  ) VALUES (
    v_staff.organization_id, v_member.id, v_member.name, p_amount, v_product.annual_rate, v_product.term_months,
    current_date, current_date + (v_product.term_months || ' months')::interval,
    v_interest, v_tax, v_interest - v_tax, p_auto_renew AND v_product.allow_auto_renew,
    'active', v_product.id, v_account.id
  ) RETURNING id INTO v_deposit_id;

  SELECT coalesce(balance, 0) INTO v_previous FROM sacco_cashbook_entries
  WHERE organization_id = v_staff.organization_id ORDER BY created_at DESC LIMIT 1;
  INSERT INTO sacco_cashbook_entries(
    organization_id, entry_date, description, reference, category, sacco_member_id, member_name, debit, credit, balance
  ) VALUES (
    v_staff.organization_id, current_date, 'Fixed deposit funded from savings', 'FD-' || left(v_deposit_id::text, 8),
    'fixed_deposit', v_member.id, v_member.name, 0, p_amount, coalesce(v_previous, 0) - p_amount
  );
  INSERT INTO sacco_fixed_deposit_events(organization_id, fixed_deposit_id, event_type, amount, note, actor_id)
  VALUES (v_staff.organization_id, v_deposit_id, 'opened', p_amount, 'Opened by staff from savings account', auth.uid());
  RETURN v_deposit_id;
END $$;

REVOKE ALL ON FUNCTION public.open_sacco_fixed_deposit_for_member(uuid, uuid, uuid, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_sacco_fixed_deposit_for_member(uuid, uuid, uuid, numeric, boolean) TO authenticated;
