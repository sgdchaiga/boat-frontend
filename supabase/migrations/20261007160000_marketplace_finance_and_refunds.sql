-- Merchant financial controls: commission, settlement, refund register and optional GL posting.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS finance_journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL;
ALTER TABLE public.marketplace_settlements
  ADD COLUMN IF NOT EXISTS period_from date,
  ADD COLUMN IF NOT EXISTS period_to date,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES public.staff(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.marketplace_finance_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  clearing_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  sales_revenue_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  commission_expense_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  settlement_account_gl_account_id uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketplace_settlement_orders (
  settlement_id uuid NOT NULL REFERENCES public.marketplace_settlements(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  gross_amount numeric(15,2) NOT NULL DEFAULT 0,
  commission_amount numeric(15,2) NOT NULL DEFAULT 0,
  payment_charge_amount numeric(15,2) NOT NULL DEFAULT 0,
  net_amount numeric(15,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (settlement_id, order_id),
  UNIQUE(order_id)
);

CREATE TABLE IF NOT EXISTS public.marketplace_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.marketplace_customers(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  commission_reversal numeric(15,2) NOT NULL DEFAULT 0 CHECK (commission_reversal >= 0),
  currency text NOT NULL DEFAULT 'UGX',
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('requested', 'approved', 'paid', 'failed', 'cancelled')),
  reason text NOT NULL,
  payment_reference text,
  journal_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_refunds_order ON public.marketplace_refunds(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_refunds_org ON public.marketplace_refunds(organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_marketplace_finance_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_marketplace_finance_settings_touch ON public.marketplace_finance_settings;
CREATE TRIGGER trg_marketplace_finance_settings_touch BEFORE UPDATE ON public.marketplace_finance_settings FOR EACH ROW EXECUTE FUNCTION public.touch_marketplace_finance_updated_at();
DROP TRIGGER IF EXISTS trg_marketplace_refunds_touch ON public.marketplace_refunds;
CREATE TRIGGER trg_marketplace_refunds_touch BEFORE UPDATE ON public.marketplace_refunds FOR EACH ROW EXECUTE FUNCTION public.touch_marketplace_finance_updated_at();

ALTER TABLE public.marketplace_finance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_settlement_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_finance_settings_org ON public.marketplace_finance_settings FOR ALL TO authenticated
  USING (public.marketplace_org_access(organization_id)) WITH CHECK (public.marketplace_org_access(organization_id));
CREATE POLICY marketplace_settlement_orders_org_read ON public.marketplace_settlement_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_settlements settlement WHERE settlement.id = settlement_id AND public.marketplace_org_access(settlement.organization_id)));
CREATE POLICY marketplace_refunds_org_read ON public.marketplace_refunds FOR SELECT TO authenticated
  USING (public.marketplace_org_access(organization_id));
CREATE POLICY marketplace_refunds_customer_read ON public.marketplace_refunds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.marketplace_customers customer WHERE customer.id = customer_id AND customer.user_id = auth.uid()));
GRANT SELECT, INSERT, UPDATE ON public.marketplace_finance_settings TO authenticated;
GRANT SELECT ON public.marketplace_settlement_orders, public.marketplace_refunds TO authenticated;

-- Settlement state changes are controlled by RPC rather than broad table writes.
DROP POLICY IF EXISTS marketplace_org_marketplace_settlements ON public.marketplace_settlements;
CREATE POLICY marketplace_settlements_org_read ON public.marketplace_settlements FOR SELECT TO authenticated
  USING (public.marketplace_org_access(organization_id));

CREATE OR REPLACE FUNCTION public.marketplace_create_settlement(p_merchant_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_merchant record;
  v_settlement_id uuid;
  v_gross numeric(15,2);
  v_charges numeric(15,2);
  v_commission numeric(15,2);
BEGIN
  SELECT merchant.id, merchant.organization_id INTO v_merchant
  FROM public.marketplace_merchant_profiles merchant
  WHERE merchant.id = p_merchant_id AND public.marketplace_org_access(merchant.organization_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace merchant not found'; END IF;

  SELECT COALESCE(SUM(order_row.gross_amount), 0), COALESCE(SUM(order_row.payment_charge), 0), COALESCE(SUM(order_row.platform_fee), 0)
    INTO v_gross, v_charges, v_commission
  FROM public.marketplace_orders order_row
  WHERE order_row.merchant_id = p_merchant_id
    AND order_row.status IN ('paid', 'fulfilled')
    AND NOT EXISTS (SELECT 1 FROM public.marketplace_settlement_orders line WHERE line.order_id = order_row.id);
  IF v_gross <= 0 THEN RAISE EXCEPTION 'There are no paid marketplace orders ready for settlement'; END IF;

  INSERT INTO public.marketplace_settlements (organization_id, merchant_id, status, gross_sales, payment_charges, platform_commissions, net_amount, period_from, period_to)
  VALUES (v_merchant.organization_id, p_merchant_id, 'payable', v_gross, v_charges, v_commission, v_gross - v_charges - v_commission, current_date, current_date)
  RETURNING id INTO v_settlement_id;

  INSERT INTO public.marketplace_settlement_orders (settlement_id, order_id, gross_amount, commission_amount, payment_charge_amount, net_amount)
  SELECT v_settlement_id, order_row.id, order_row.gross_amount, order_row.platform_fee, order_row.payment_charge, order_row.gross_amount - order_row.platform_fee - order_row.payment_charge
  FROM public.marketplace_orders order_row
  WHERE order_row.merchant_id = p_merchant_id
    AND order_row.status IN ('paid', 'fulfilled')
    AND NOT EXISTS (SELECT 1 FROM public.marketplace_settlement_orders line WHERE line.order_id = order_row.id);

  RETURN v_settlement_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_mark_settlement_paid(p_settlement_id uuid, p_reference text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settlement public.marketplace_settlements%ROWTYPE; BEGIN
  SELECT * INTO v_settlement FROM public.marketplace_settlements WHERE id = p_settlement_id AND public.marketplace_org_access(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace settlement not found'; END IF;
  IF v_settlement.status NOT IN ('payable', 'paid') THEN RAISE EXCEPTION 'Only payable settlements can be marked paid'; END IF;
  UPDATE public.marketplace_settlements SET status = 'paid', paid_at = COALESCE(paid_at, now()), paid_by = COALESCE(paid_by, auth.uid()), reference = COALESCE(NULLIF(trim(p_reference), ''), reference) WHERE id = v_settlement.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_record_refund(p_order_id uuid, p_amount numeric, p_reason text, p_reference text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_previous numeric(15,2);
  v_commission_reversal numeric(15,2);
  v_refund_id uuid;
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id AND public.marketplace_org_access(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace order not found'; END IF;
  IF v_order.status NOT IN ('paid', 'fulfilled') THEN RAISE EXCEPTION 'Only paid or fulfilled orders can be refunded'; END IF;
  IF EXISTS (SELECT 1 FROM public.marketplace_settlement_orders WHERE order_id = p_order_id) THEN RAISE EXCEPTION 'This order is already in a settlement; record the refund through the settlement adjustment workflow'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_order.gross_amount THEN RAISE EXCEPTION 'Enter a valid refund amount'; END IF;
  IF NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Enter a refund reason'; END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_previous FROM public.marketplace_refunds WHERE order_id = p_order_id AND status = 'paid';
  IF v_previous + p_amount > v_order.gross_amount THEN RAISE EXCEPTION 'Refund exceeds the unrefunded order amount'; END IF;
  v_commission_reversal := ROUND(v_order.platform_fee * p_amount / NULLIF(v_order.gross_amount, 0), 2);

  INSERT INTO public.marketplace_refunds (order_id, customer_id, organization_id, amount, commission_reversal, currency, reason, payment_reference, requested_by, paid_at)
  VALUES (v_order.id, v_order.customer_id, v_order.organization_id, p_amount, v_commission_reversal, v_order.currency, trim(p_reason), NULLIF(trim(p_reference), ''), auth.uid(), now())
  RETURNING id INTO v_refund_id;
  IF v_previous + p_amount >= v_order.gross_amount THEN
    -- A fully refunded fulfilled retail order returns its linked stock exactly once.
    IF v_order.status = 'fulfilled' THEN
      INSERT INTO public.product_stock_movements (organization_id, product_id, source_type, source_id, quantity_in, quantity_out, unit_cost, note, movement_date)
      SELECT v_order.organization_id, product.id, 'marketplace_refund', v_refund_id, item.quantity, 0, COALESCE(product.cost_price, 0), 'BOAT Market full refund ' || v_order.order_number, now()
      FROM public.marketplace_order_items item
      JOIN public.products product ON product.id::text = item.source_record_id AND product.organization_id = v_order.organization_id
      WHERE item.order_id = v_order.id AND item.source_module = 'retail_product' AND product.track_inventory IS DISTINCT FROM false;
    END IF;
    UPDATE public.marketplace_orders SET status = 'refunded' WHERE id = v_order.id;
  END IF;
  RETURN v_refund_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_post_order_journal(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.marketplace_orders%ROWTYPE;
  v_setting public.marketplace_finance_settings%ROWTYPE;
  v_lines jsonb;
  v_journal_id uuid;
BEGIN
  SELECT * INTO v_order FROM public.marketplace_orders WHERE id = p_order_id AND public.marketplace_org_access(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace order not found'; END IF;
  IF v_order.status NOT IN ('paid', 'fulfilled') THEN RAISE EXCEPTION 'Only paid orders can be posted to the GL'; END IF;
  IF v_order.finance_journal_entry_id IS NOT NULL THEN RETURN v_order.finance_journal_entry_id; END IF;
  SELECT * INTO v_setting FROM public.marketplace_finance_settings WHERE organization_id = v_order.organization_id;
  IF v_setting.clearing_gl_account_id IS NULL OR v_setting.sales_revenue_gl_account_id IS NULL OR (v_order.platform_fee > 0 AND v_setting.commission_expense_gl_account_id IS NULL) THEN
    RAISE EXCEPTION 'Configure BOAT Pay clearing, marketplace sales revenue, and commission expense GL accounts first';
  END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('gl_account_id', v_setting.clearing_gl_account_id, 'debit', v_order.gross_amount, 'credit', 0, 'line_description', 'BOAT Market payment clearing'),
    jsonb_build_object('gl_account_id', v_setting.sales_revenue_gl_account_id, 'debit', 0, 'credit', v_order.gross_amount, 'line_description', 'BOAT Market sale')
  );
  IF v_order.platform_fee > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('gl_account_id', v_setting.commission_expense_gl_account_id, 'debit', v_order.platform_fee, 'credit', 0, 'line_description', 'Marketplace commission'),
      jsonb_build_object('gl_account_id', v_setting.clearing_gl_account_id, 'debit', 0, 'credit', v_order.platform_fee, 'line_description', 'Marketplace commission retained')
    );
  END IF;
  v_journal_id := public.create_journal_entry_atomic(current_date, 'BOAT Market order ' || v_order.order_number, 'marketplace_order', v_order.id, auth.uid(), v_lines, v_order.organization_id);
  UPDATE public.marketplace_orders SET finance_journal_entry_id = v_journal_id WHERE id = v_order.id;
  RETURN v_journal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_post_settlement_journal(p_settlement_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settlement public.marketplace_settlements%ROWTYPE; v_setting public.marketplace_finance_settings%ROWTYPE; v_journal_id uuid; BEGIN
  SELECT * INTO v_settlement FROM public.marketplace_settlements WHERE id = p_settlement_id AND public.marketplace_org_access(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace settlement not found'; END IF;
  IF v_settlement.status <> 'paid' THEN RAISE EXCEPTION 'Mark the settlement paid before posting its GL entry'; END IF;
  IF v_settlement.journal_entry_id IS NOT NULL THEN RETURN v_settlement.journal_entry_id; END IF;
  SELECT * INTO v_setting FROM public.marketplace_finance_settings WHERE organization_id = v_settlement.organization_id;
  IF v_setting.clearing_gl_account_id IS NULL OR v_setting.settlement_account_gl_account_id IS NULL THEN RAISE EXCEPTION 'Configure BOAT Pay clearing and settlement GL accounts first'; END IF;
  v_journal_id := public.create_journal_entry_atomic(current_date, 'BOAT Market settlement ' || COALESCE(v_settlement.reference, v_settlement.id::text), 'marketplace_settlement', v_settlement.id, auth.uid(), jsonb_build_array(
    jsonb_build_object('gl_account_id', v_setting.settlement_account_gl_account_id, 'debit', v_settlement.net_amount, 'credit', 0, 'line_description', 'Marketplace settlement received'),
    jsonb_build_object('gl_account_id', v_setting.clearing_gl_account_id, 'debit', 0, 'credit', v_settlement.net_amount, 'line_description', 'BOAT Market clearing settled')
  ), v_settlement.organization_id);
  UPDATE public.marketplace_settlements SET journal_entry_id = v_journal_id WHERE id = v_settlement.id;
  RETURN v_journal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_post_refund_journal(p_refund_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_refund public.marketplace_refunds%ROWTYPE; v_setting public.marketplace_finance_settings%ROWTYPE; v_lines jsonb; v_journal_id uuid; BEGIN
  SELECT * INTO v_refund FROM public.marketplace_refunds WHERE id = p_refund_id AND public.marketplace_org_access(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Marketplace refund not found'; END IF;
  IF v_refund.status <> 'paid' THEN RAISE EXCEPTION 'Only paid refunds can be posted to the GL'; END IF;
  IF v_refund.journal_entry_id IS NOT NULL THEN RETURN v_refund.journal_entry_id; END IF;
  SELECT * INTO v_setting FROM public.marketplace_finance_settings WHERE organization_id = v_refund.organization_id;
  IF v_setting.clearing_gl_account_id IS NULL OR v_setting.sales_revenue_gl_account_id IS NULL OR (v_refund.commission_reversal > 0 AND v_setting.commission_expense_gl_account_id IS NULL) THEN RAISE EXCEPTION 'Configure clearing, sales revenue, and commission GL accounts first'; END IF;
  v_lines := jsonb_build_array(
    jsonb_build_object('gl_account_id', v_setting.sales_revenue_gl_account_id, 'debit', v_refund.amount, 'credit', 0, 'line_description', 'Marketplace refund'),
    jsonb_build_object('gl_account_id', v_setting.clearing_gl_account_id, 'debit', 0, 'credit', v_refund.amount, 'line_description', 'Marketplace refund paid')
  );
  IF v_refund.commission_reversal > 0 THEN
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('gl_account_id', v_setting.clearing_gl_account_id, 'debit', v_refund.commission_reversal, 'credit', 0, 'line_description', 'Marketplace commission reversal'),
      jsonb_build_object('gl_account_id', v_setting.commission_expense_gl_account_id, 'debit', 0, 'credit', v_refund.commission_reversal, 'line_description', 'Marketplace commission reversal')
    );
  END IF;
  v_journal_id := public.create_journal_entry_atomic(current_date, 'BOAT Market refund ' || v_refund.id::text, 'marketplace_refund', v_refund.id, auth.uid(), v_lines, v_refund.organization_id);
  UPDATE public.marketplace_refunds SET journal_entry_id = v_journal_id WHERE id = v_refund.id;
  RETURN v_journal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.marketplace_create_settlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_mark_settlement_paid(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_record_refund(uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_post_order_journal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_post_settlement_journal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_post_refund_journal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marketplace_create_settlement(uuid), public.marketplace_mark_settlement_paid(uuid, text), public.marketplace_record_refund(uuid, numeric, text, text), public.marketplace_post_order_journal(uuid), public.marketplace_post_settlement_journal(uuid), public.marketplace_post_refund_journal(uuid) TO authenticated;
