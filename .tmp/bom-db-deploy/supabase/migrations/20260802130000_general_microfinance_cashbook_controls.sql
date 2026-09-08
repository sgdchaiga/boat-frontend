-- Controlled General Business / Microfinance cashbook corrections and channel balances.
ALTER TABLE public.general_business_cashbook_entries
  ADD COLUMN IF NOT EXISTS workspace_type text NOT NULL DEFAULT 'general_business'
    CHECK (workspace_type IN ('general_business','microfinance')),
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','voided','replaced')),
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_of_entry_id uuid REFERENCES public.general_business_cashbook_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_entry_id uuid REFERENCES public.general_business_cashbook_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason text;

UPDATE public.general_business_cashbook_entries e SET workspace_type='microfinance'
FROM public.organizations o WHERE o.id=e.organization_id AND o.business_type='microfinance';

-- Existing entries pre-date maker/checker and are treated as accepted historical postings.
UPDATE public.general_business_cashbook_entries
SET approval_status='approved', approved_at=coalesce(posted_at,created_at)
WHERE approval_status='pending';

INSERT INTO public.organization_permissions(organization_id,role_key,permission_key,allowed)
SELECT ort.organization_id,ort.role_key,'cashbook_transaction_control',ort.role_key IN ('admin','manager','accountant')
FROM public.organization_role_types ort
ON CONFLICT(organization_id,role_key,permission_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.protect_posted_general_cashbook_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Posted cashbook entries cannot be deleted; use an authorized reversal'; END IF;
 IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
   OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.description IS DISTINCT FROM OLD.description
   OR NEW.counterpart_gl_account_id IS DISTINCT FROM OLD.counterpart_gl_account_id OR NEW.cash_gl_account_id IS DISTINCT FROM OLD.cash_gl_account_id
   OR NEW.cash_in IS DISTINCT FROM OLD.cash_in OR NEW.cash_out IS DISTINCT FROM OLD.cash_out OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
   OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.headquarters IS DISTINCT FROM OLD.headquarters
   OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
 THEN RAISE EXCEPTION 'Posted financial fields are immutable; use correction or void'; END IF;
 NEW.updated_at:=now(); NEW.updated_by:=auth.uid(); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_posted_general_cashbook_entry ON public.general_business_cashbook_entries;
CREATE TRIGGER protect_posted_general_cashbook_entry BEFORE UPDATE OR DELETE ON public.general_business_cashbook_entries
FOR EACH ROW EXECUTE FUNCTION public.protect_posted_general_cashbook_entry();

CREATE OR REPLACE FUNCTION public.gb_cashbook_can_control(target_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM staff s
  LEFT JOIN organization_permissions p ON p.organization_id=s.organization_id AND p.role_key=lower(s.role) AND p.permission_key='cashbook_transaction_control'
  LEFT JOIN staff_permission_overrides ov ON ov.organization_id=s.organization_id AND ov.staff_id=s.id AND ov.permission_key='cashbook_transaction_control'
  WHERE s.id=auth.uid() AND s.organization_id=target_org AND (lower(s.role)='super_admin' OR coalesce(ov.allowed,p.allowed,lower(s.role) IN ('admin','manager','accountant')))
 );
$$;

CREATE OR REPLACE FUNCTION public.approve_general_cashbook_entry(p_organization_id uuid,p_entry_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$ BEGIN
 IF NOT gb_cashbook_can_control(p_organization_id) THEN RAISE EXCEPTION 'You do not have permission to approve cashbook entries'; END IF;
 UPDATE general_business_cashbook_entries SET approval_status='approved',approved_by=auth.uid(),approved_at=now(),updated_by=auth.uid(),updated_at=now()
 WHERE id=p_entry_id AND organization_id=p_organization_id AND approval_status='pending' AND created_by IS DISTINCT FROM auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Entry is unavailable, already processed, or cannot be self-approved'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.void_general_cashbook_entry(p_organization_id uuid,p_entry_id uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old general_business_cashbook_entries%rowtype; rid uuid:=gen_random_uuid(); jid uuid;
BEGIN
 IF NOT gb_cashbook_can_control(p_organization_id) THEN RAISE EXCEPTION 'You do not have permission to void cashbook entries'; END IF;
 IF coalesce(trim(p_reason),'')='' THEN RAISE EXCEPTION 'A void reason is required'; END IF;
 SELECT * INTO old FROM general_business_cashbook_entries WHERE id=p_entry_id AND organization_id=p_organization_id FOR UPDATE;
 IF NOT FOUND OR old.approval_status IN ('voided','replaced') OR old.reversal_of_entry_id IS NOT NULL THEN RAISE EXCEPTION 'Entry cannot be voided'; END IF;
 INSERT INTO journal_entries(entry_date,description,reference_type,reference_id,created_by,organization_id,is_posted,is_deleted)
 VALUES(current_date,'Reversal: '||old.description||' — '||trim(p_reason),old.workspace_type||'_cashbook_reversal',rid,auth.uid(),p_organization_id,true,false) RETURNING id INTO jid;
 INSERT INTO journal_entry_lines(journal_entry_id,gl_account_id,debit,credit,line_description,sort_order)
 SELECT jid,gl_account_id,credit,debit,'Reversal: '||coalesce(line_description,old.description),sort_order FROM journal_entry_lines WHERE journal_entry_id=old.journal_entry_id;
 INSERT INTO general_business_cashbook_entries(id,organization_id,transaction_date,headquarters,payment_method,description,supplier_name,customer_name,counterpart_gl_account_id,cash_gl_account_id,cash_in,cash_out,reference,journal_entry_id,created_by,workspace_type,approval_status,reversal_of_entry_id,correction_reason)
 VALUES(rid,p_organization_id,current_date,old.headquarters,old.payment_method,'Reversal: '||old.description,old.supplier_name,old.customer_name,old.counterpart_gl_account_id,old.cash_gl_account_id,old.cash_out,old.cash_in,old.reference,jid,auth.uid(),old.workspace_type,'approved',old.id,trim(p_reason));
 UPDATE general_business_cashbook_entries SET approval_status='voided',correction_reason=trim(p_reason),updated_by=auth.uid(),updated_at=now() WHERE id=old.id;
 RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.correct_general_cashbook_entry(p_organization_id uuid,p_entry_id uuid,p_reason text,p_description text,p_reference text) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old general_business_cashbook_entries%rowtype; nid uuid;
BEGIN
 SELECT * INTO old FROM general_business_cashbook_entries WHERE id=p_entry_id AND organization_id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
 PERFORM void_general_cashbook_entry(p_organization_id,p_entry_id,p_reason);
 nid:=post_general_business_cashbook_entry(p_organization_id,old.transaction_date,old.headquarters,old.payment_method,coalesce(nullif(trim(p_description),''),old.description),old.supplier_name,old.customer_name,old.counterpart_gl_account_id,old.cash_gl_account_id,old.cash_in,old.cash_out,p_reference);
 UPDATE general_business_cashbook_entries SET workspace_type=old.workspace_type,correction_reason=trim(p_reason) WHERE id=nid;
 UPDATE general_business_cashbook_entries SET approval_status='replaced',replaced_by_entry_id=nid WHERE id=p_entry_id;
 RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.cashbook_daily_channel_positions(p_organization_id uuid,p_date date)
RETURNS TABLE(channel text,opening_balance numeric,day_movement numeric,closing_balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 WITH accounts AS (
  SELECT id,CASE WHEN lower(coalesce(account_name,'')) ~ '(mobile|momo|mpesa|m-pesa|airtel)' THEN 'mobile_money'
    WHEN lower(coalesce(account_name,'')) ~ '(bank|current account|checking|savings account)' THEN 'bank'
    WHEN lower(coalesce(account_name,'')) ~ '(card|wallet)' THEN 'wallet' ELSE 'cash' END channel
  FROM gl_accounts WHERE organization_id=p_organization_id AND account_type='asset' AND lower(coalesce(category,'')||' '||coalesce(account_name,'')) ~ '(cash|bank|mobile|momo|wallet|card|till|float|imprest)'
 ), movement AS (
  SELECT a.channel,je.entry_date,sum(coalesce(jel.debit,0)-coalesce(jel.credit,0)) amount FROM journal_entry_lines jel JOIN journal_entries je ON je.id=jel.journal_entry_id JOIN accounts a ON a.id=jel.gl_account_id
  WHERE je.organization_id=p_organization_id AND je.is_posted=true AND je.is_deleted=false AND je.entry_date<=p_date GROUP BY a.channel,je.entry_date
 ) SELECT channel,coalesce(sum(amount) FILTER(WHERE entry_date<p_date),0),coalesce(sum(amount) FILTER(WHERE entry_date=p_date),0),coalesce(sum(amount),0) FROM movement GROUP BY channel;
$$;

GRANT EXECUTE ON FUNCTION public.approve_general_cashbook_entry(uuid,uuid),public.void_general_cashbook_entry(uuid,uuid,text),public.correct_general_cashbook_entry(uuid,uuid,text,text,text),public.cashbook_daily_channel_positions(uuid,date) TO authenticated;
