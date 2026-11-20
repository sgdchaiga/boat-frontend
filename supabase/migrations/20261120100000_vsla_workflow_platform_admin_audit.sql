-- A platform administrator may administer a VSLA tenant without being a member
-- of that tenant's staff table. Keep that authenticated actor in the workflow
-- audit record, while using the tenant-staff FK only when a staff row exists.
ALTER TABLE public.vsla_workflow_settings
  ADD COLUMN IF NOT EXISTS changed_by_auth_user_id uuid;

CREATE OR REPLACE FUNCTION public.set_vsla_workflow_version(
  p_organization_id uuid,
  p_workflow_version text,
  p_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_staff_actor uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Platform administrator access is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id=p_organization_id AND business_type='vsla'
  ) THEN
    RAISE EXCEPTION 'VSLA organization not found';
  END IF;
  IF p_workflow_version NOT IN ('legacy','v1_2') THEN
    RAISE EXCEPTION 'Unsupported VSLA workflow version';
  END IF;

  SELECT s.id INTO v_staff_actor
  FROM public.staff s
  WHERE s.id=auth.uid()
  LIMIT 1;

  INSERT INTO public.vsla_workflow_settings(
    organization_id,workflow_version,changed_at,changed_by,changed_by_auth_user_id,change_reason
  ) VALUES (
    p_organization_id,p_workflow_version,now(),v_staff_actor,auth.uid(),nullif(trim(coalesce(p_reason,'')), '')
  )
  ON CONFLICT(organization_id) DO UPDATE SET
    workflow_version=EXCLUDED.workflow_version,
    changed_at=EXCLUDED.changed_at,
    changed_by=EXCLUDED.changed_by,
    changed_by_auth_user_id=EXCLUDED.changed_by_auth_user_id,
    change_reason=EXCLUDED.change_reason;

  IF p_workflow_version='v1_2' THEN
    INSERT INTO public.vsla_approval_policies(organization_id,transaction_type,created_by)
    SELECT p_organization_id, rule.transaction_type, v_staff_actor
    FROM unnest(ARRAY['loan_disbursed','expense_paid','cash_adjustment','shareout_accrual','shareout_payment','reversal']::text[]) AS rule(transaction_type)
    ON CONFLICT(organization_id,transaction_type) DO NOTHING;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_vsla_workflow_version(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_vsla_workflow_version(uuid,text,text) TO authenticated;
