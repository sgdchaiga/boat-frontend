-- Complete Phase 2: staff capacity planning and secure client portal APIs.

CREATE TABLE IF NOT EXISTS public.practice_staff_skills (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE, skill_name text NOT NULL, proficiency text NOT NULL DEFAULT 'working' CHECK(proficiency IN('learning','working','advanced','expert')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(staff_id,skill_name)
);
CREATE TABLE IF NOT EXISTS public.practice_staff_availability (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE, week_start date NOT NULL, available_hours numeric(8,2) NOT NULL DEFAULT 40,
 leave_hours numeric(8,2) NOT NULL DEFAULT 0, training_hours numeric(8,2) NOT NULL DEFAULT 0, fieldwork_hours numeric(8,2) NOT NULL DEFAULT 0,
 notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(staff_id,week_start)
);
CREATE TABLE IF NOT EXISTS public.practice_client_portal_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 client_id uuid NOT NULL REFERENCES public.practice_clients(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES public.practice_client_contacts(id) ON DELETE SET NULL, is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(client_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_practice_availability_week ON public.practice_staff_availability(organization_id,week_start,staff_id);
CREATE INDEX IF NOT EXISTS idx_practice_skills_lookup ON public.practice_staff_skills(organization_id,skill_name,proficiency);
CREATE INDEX IF NOT EXISTS idx_practice_portal_user ON public.practice_client_portal_users(user_id,is_active);
ALTER TABLE public.practice_staff_skills ENABLE ROW LEVEL SECURITY;ALTER TABLE public.practice_staff_availability ENABLE ROW LEVEL SECURITY;ALTER TABLE public.practice_client_portal_users ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE table_name text; BEGIN FOREACH table_name IN ARRAY ARRAY['practice_staff_skills','practice_staff_availability'] LOOP EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING(public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid())) WITH CHECK(public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()))',table_name||'_same_org',table_name);EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',table_name);END LOOP;END $$;
CREATE POLICY practice_portal_users_self_or_staff ON public.practice_client_portal_users FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()));
CREATE POLICY practice_portal_users_manage_staff ON public.practice_client_portal_users FOR ALL TO authenticated USING(public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid())) WITH CHECK(public.is_platform_admin() OR organization_id=(SELECT s.organization_id FROM public.staff s WHERE s.id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.practice_client_portal_users TO authenticated;

CREATE OR REPLACE FUNCTION public.practice_portal_can_access(p_client_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_platform_admin() OR EXISTS(SELECT 1 FROM public.practice_client_portal_users p WHERE p.client_id=p_client_id AND p.user_id=auth.uid() AND p.is_active)
 OR EXISTS(SELECT 1 FROM public.practice_clients c JOIN public.staff s ON s.organization_id=c.organization_id WHERE c.id=p_client_id AND s.id=auth.uid());$$;
CREATE OR REPLACE FUNCTION public.practice_client_portal_snapshot(p_client_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;BEGIN IF NOT public.practice_portal_can_access(p_client_id) THEN RAISE EXCEPTION 'Client portal access denied';END IF;
SELECT jsonb_build_object('client',jsonb_build_object('id',c.id,'name',c.name,'subscription_plan',c.subscription_plan,'subscription_status',c.subscription_status,'renewal_date',c.renewal_date),
'engagements',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'number',e.engagement_number,'title',e.title,'service_type',e.service_type,'start_date',e.start_date,'due_date',e.due_date,'status',e.status)) FROM public.practice_engagements e WHERE e.client_id=c.id),'[]'::jsonb),
'document_requests',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'category',d.category,'due_date',d.due_date,'status',d.status)) FROM public.practice_document_requests d WHERE d.client_id=c.id),'[]'::jsonb),
'tickets',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'number',t.ticket_number,'title',t.title,'module',t.module,'priority',t.priority,'status',t.status,'reported_at',t.reported_at)) FROM public.practice_support_tickets t WHERE t.client_id=c.id),'[]'::jsonb),
'invoices',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'number',i.invoice_number,'issue_date',i.issue_date,'due_date',i.due_date,'total',i.total,'status',i.status)) FROM public.retail_invoices i WHERE i.practice_client_id=c.id AND i.status<>'void'),'[]'::jsonb),
'signoffs',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'title',s.title,'type',s.signoff_type,'status',s.status,'requested_at',s.requested_at)) FROM public.practice_client_signoffs s WHERE s.client_id=c.id),'[]'::jsonb)) INTO result FROM public.practice_clients c WHERE c.id=p_client_id;RETURN result;END $$;
CREATE OR REPLACE FUNCTION public.practice_client_portal_submit_ticket(p_client_id uuid,p_title text,p_description text,p_module text DEFAULT NULL,p_priority text DEFAULT 'normal') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v_org uuid;v_id uuid;BEGIN IF NOT public.practice_portal_can_access(p_client_id) THEN RAISE EXCEPTION 'Access denied';END IF;SELECT organization_id INTO v_org FROM public.practice_clients WHERE id=p_client_id;INSERT INTO public.practice_support_tickets(organization_id,client_id,ticket_number,title,description,module,priority,reported_by_name) VALUES(v_org,p_client_id,'SUP-'||extract(year from now())::text||'-'||right(extract(epoch from now())::bigint::text,6),p_title,p_description,p_module,p_priority,'Client portal') RETURNING id INTO v_id;RETURN v_id;END $$;
CREATE OR REPLACE FUNCTION public.practice_client_portal_decide_signoff(p_signoff_id uuid,p_decision text,p_notes text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v_client uuid;BEGIN SELECT client_id INTO v_client FROM public.practice_client_signoffs WHERE id=p_signoff_id;IF NOT public.practice_portal_can_access(v_client) THEN RAISE EXCEPTION 'Access denied';END IF;IF p_decision NOT IN('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision';END IF;UPDATE public.practice_client_signoffs SET status=p_decision,client_notes=p_notes,decided_at=now(),updated_at=now() WHERE id=p_signoff_id;END $$;
GRANT EXECUTE ON FUNCTION public.practice_portal_can_access(uuid),public.practice_client_portal_snapshot(uuid),public.practice_client_portal_submit_ticket(uuid,text,text,text,text),public.practice_client_portal_decide_signoff(uuid,text,text) TO authenticated;
