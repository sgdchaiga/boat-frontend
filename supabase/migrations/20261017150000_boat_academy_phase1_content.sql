-- Phase 1 Academy catalogue: concise, operational first lessons for each launch module.
-- The same lesson bodies are also seeded as contextual Help & Learning articles.

DO $$
DECLARE
  r record;
  v_course uuid;
  v_course_version uuid;
  v_lesson uuid;
  v_lesson_version uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('hotel-front-desk-basics','Hotel Front Desk Essentials','hotel','frontdesk','dashboard','Start a safe hotel shift','Learn the day-to-day sequence for arrivals, stays, billing and handover.','Open the dashboard and confirm today''s arrivals.|Review rooms requiring attention before check-in.|Check guest details and payment instructions before confirming a stay.|Use the billing page to review charges before checkout.|Complete the shift handover with unresolved items noted.'),
      ('sacco-member-and-teller-basics','SACCO Member and Teller Operations','sacco','sacco','sacco_dashboard','Process member service safely','Use the member record, teller workspace and controls without bypassing approvals.','Confirm the member identity and active account before starting.|Select the correct transaction type and verify amount, date and counterparty.|Review the confirmation screen before posting.|Never use training guidance to override limits, approvals or audit requirements.|Reconcile your till and escalate exceptions at shift close.'),
      ('school-fees-and-collections','School Fees and Collections','school','school','school_dashboard','Record school collections correctly','Follow the safe route from student record to receipt and daily collection review.','Find the correct student and confirm the payer and billing period.|Review the outstanding balance and applicable fee structure.|Record the payment using the verified payment method.|Issue the receipt only after the payment details are confirmed.|Review daily collections and report any variance promptly.'),
      ('retail-pos-basics','Retail POS Essentials','retail','retail_pos','retail_pos','Complete a reliable retail sale','Use the POS workflow, payment capture and receipt process without creating duplicate sales.','Confirm the correct outlet and cashier session.|Search or scan the exact item and verify quantity.|Apply only approved prices or discounts.|Select the payment method and confirm payment before completing.|Give the customer the receipt and report voids through the approved process.'),
      ('manufacturing-production-basics','Manufacturing Production Basics','manufacturing','manufacturing','manufacturing','Move a work order through production','Use approved bills of materials and record output with a traceable production trail.','Confirm the work order and approved bill of materials.|Check available materials before issue to production.|Record actual quantities, scrap and production dates accurately.|Do not alter completed production records outside the approved correction process.|Review costing and stock movement before closing the order.'),
      ('accounting-period-controls','Accounting Period Controls','accounting_practice','accounting','accounting_manual','Post and review accounting work safely','Build a controlled path from source document through journal, reconciliation and reporting.','Start from an approved source document and correct accounting period.|Ensure debit and credit totals balance before posting.|Attach or retain supporting evidence for every adjustment.|Reconcile bank and cash differences before relying on reports.|Use authorized approval and period-close controls; never force a live correction.')
    ) AS x(course_key,course_title,business_type,module_key,page_key,lesson_title,summary,steps)
  LOOP
    INSERT INTO public.academy_courses(organization_id,course_key,business_types,module_keys,is_active)
    VALUES(NULL,r.course_key,ARRAY[r.business_type],ARRAY[r.module_key],true)
    ON CONFLICT(organization_id,course_key) DO UPDATE SET business_types=EXCLUDED.business_types,module_keys=EXCLUDED.module_keys,is_active=true,updated_at=now()
    RETURNING id INTO v_course;
    SELECT id INTO v_course_version FROM public.academy_course_versions WHERE course_id=v_course AND version=1;
    IF v_course_version IS NULL THEN
      INSERT INTO public.academy_course_versions(course_id,version,title,summary,status,published_at)
      VALUES(v_course,1,r.course_title,r.summary,'published',now()) RETURNING id INTO v_course_version;
    ELSE
      UPDATE public.academy_course_versions SET title=r.course_title,summary=r.summary,status='published',published_at=coalesce(published_at,now()) WHERE id=v_course_version;
    END IF;
    INSERT INTO public.academy_lessons(organization_id,lesson_key,module_key,page_key,is_active)
    VALUES(NULL,r.course_key||'-lesson',r.module_key,r.page_key,true)
    ON CONFLICT(organization_id,lesson_key) DO UPDATE SET module_key=EXCLUDED.module_key,page_key=EXCLUDED.page_key,is_active=true,updated_at=now()
    RETURNING id INTO v_lesson;
    SELECT id INTO v_lesson_version FROM public.academy_lesson_versions WHERE lesson_id=v_lesson AND version=1;
    IF v_lesson_version IS NULL THEN
      INSERT INTO public.academy_lesson_versions(lesson_id,version,title,summary,content,status,published_at)
      VALUES(v_lesson,1,r.lesson_title,r.summary,(SELECT jsonb_agg(jsonb_build_object('type','text','text',trim(value))) FROM unnest(string_to_array(r.steps,'|')) value),'published',now()) RETURNING id INTO v_lesson_version;
    ELSE
      UPDATE public.academy_lesson_versions SET title=r.lesson_title,summary=r.summary,content=(SELECT jsonb_agg(jsonb_build_object('type','text','text',trim(value))) FROM unnest(string_to_array(r.steps,'|')) value),status='published',published_at=coalesce(published_at,now()) WHERE id=v_lesson_version;
    END IF;
    INSERT INTO public.academy_course_lessons(course_version_id,lesson_version_id,lesson_order,is_required)
    VALUES(v_course_version,v_lesson_version,1,true) ON CONFLICT(course_version_id,lesson_version_id) DO UPDATE SET lesson_order=1,is_required=true;
    INSERT INTO public.help_articles(organization_id,page_key,module_key,title,short_description,instructions,common_mistakes,related_guidance,troubleshooting,role_keys,version,is_active)
    VALUES(NULL,r.page_key,r.module_key,r.lesson_title,r.summary,(SELECT jsonb_agg(trim(value)) FROM unnest(string_to_array(r.steps,'|')) value),'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}',1,true)
    ON CONFLICT(organization_id,page_key,version) DO UPDATE SET module_key=EXCLUDED.module_key,title=EXCLUDED.title,short_description=EXCLUDED.short_description,instructions=EXCLUDED.instructions,is_active=true,updated_at=now();
  END LOOP;
END $$;
