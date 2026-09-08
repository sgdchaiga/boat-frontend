CREATE TABLE IF NOT EXISTS public.hotel_checkout_correction_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  stay_id uuid NOT NULL REFERENCES stays(id) ON DELETE CASCADE, old_checkout timestamptz, new_checkout timestamptz,
  changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.hotel_billing_edit_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  billing_id uuid NOT NULL REFERENCES billing(id) ON DELETE CASCADE, old_row jsonb NOT NULL, new_row jsonb NOT NULL,
  changed_by uuid, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.audit_hotel_checkout_correction() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN IF OLD.actual_check_out IS DISTINCT FROM NEW.actual_check_out AND OLD.actual_check_out IS NOT NULL THEN
  INSERT INTO hotel_checkout_correction_audit(organization_id,stay_id,old_checkout,new_checkout,changed_by) VALUES(NEW.organization_id,NEW.id,OLD.actual_check_out,NEW.actual_check_out,auth.uid()); END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_audit_hotel_checkout_correction ON stays;
CREATE TRIGGER trg_audit_hotel_checkout_correction AFTER UPDATE OF actual_check_out ON stays FOR EACH ROW EXECUTE FUNCTION audit_hotel_checkout_correction();
CREATE OR REPLACE FUNCTION public.audit_hotel_billing_edit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN INSERT INTO hotel_billing_edit_audit(organization_id,billing_id,old_row,new_row,changed_by) VALUES(NEW.organization_id,NEW.id,to_jsonb(OLD),to_jsonb(NEW),auth.uid()); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_audit_hotel_billing_edit ON billing;
CREATE TRIGGER trg_audit_hotel_billing_edit AFTER UPDATE ON billing FOR EACH ROW EXECUTE FUNCTION audit_hotel_billing_edit();
ALTER TABLE hotel_checkout_correction_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_billing_edit_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY hotel_checkout_audit_read ON hotel_checkout_correction_audit FOR SELECT TO authenticated USING (organization_id=(SELECT organization_id FROM staff WHERE id=auth.uid()) OR is_platform_admin());
CREATE POLICY hotel_billing_audit_read ON hotel_billing_edit_audit FOR SELECT TO authenticated USING (organization_id=(SELECT organization_id FROM staff WHERE id=auth.uid()) OR is_platform_admin());
GRANT SELECT ON hotel_checkout_correction_audit,hotel_billing_edit_audit TO authenticated;
