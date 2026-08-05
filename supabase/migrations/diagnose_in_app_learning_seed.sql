-- Diagnostic only: identifies which learning seed target raises an error.
-- Each test is rolled back inside its own exception block or explicitly cleaned up.

CREATE TEMP TABLE learning_seed_diagnostics (
  phase text PRIMARY KEY,
  result text NOT NULL
) ON COMMIT DROP;

DO $diagnostic$
DECLARE
  test_tour_id uuid;
  error_message text;
  error_context text;
BEGIN
  BEGIN
    INSERT INTO public.help_articles(page_key,module_key,title,short_description)
    VALUES ('__diagnostic__','practice','Diagnostic','Diagnostic');
    DELETE FROM public.help_articles WHERE page_key='__diagnostic__';
    INSERT INTO learning_seed_diagnostics VALUES ('1_help_articles','OK');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT, error_context = PG_EXCEPTION_CONTEXT;
    INSERT INTO learning_seed_diagnostics VALUES ('1_help_articles',error_message || E'\n' || error_context);
  END;

  BEGIN
    INSERT INTO public.help_tooltips(page_key,field_key,term,explanation)
    VALUES ('__diagnostic__','diagnostic','Diagnostic','Diagnostic');
    DELETE FROM public.help_tooltips WHERE page_key='__diagnostic__';
    INSERT INTO learning_seed_diagnostics VALUES ('2_help_tooltips','OK');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT, error_context = PG_EXCEPTION_CONTEXT;
    INSERT INTO learning_seed_diagnostics VALUES ('2_help_tooltips',error_message || E'\n' || error_context);
  END;

  BEGIN
    INSERT INTO public.guided_tours(page_key,title,description)
    VALUES ('__diagnostic__','Diagnostic','Diagnostic') RETURNING id INTO test_tour_id;
    INSERT INTO public.guided_tour_steps(tour_id,step_order,title,body)
    VALUES (test_tour_id,1,'Diagnostic','Diagnostic');
    DELETE FROM public.guided_tours WHERE id=test_tour_id;
    INSERT INTO learning_seed_diagnostics VALUES ('3_guided_tours_and_steps','OK');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT, error_context = PG_EXCEPTION_CONTEXT;
    INSERT INTO learning_seed_diagnostics VALUES ('3_guided_tours_and_steps',error_message || E'\n' || error_context);
  END;

  BEGIN
    INSERT INTO public.training_tasks(module_key,page_key,title,instructions)
    VALUES ('practice','__diagnostic__','Diagnostic','Diagnostic');
    DELETE FROM public.training_tasks WHERE page_key='__diagnostic__';
    INSERT INTO learning_seed_diagnostics VALUES ('4_training_tasks','OK');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_message = MESSAGE_TEXT, error_context = PG_EXCEPTION_CONTEXT;
    INSERT INTO learning_seed_diagnostics VALUES ('4_training_tasks',error_message || E'\n' || error_context);
  END;
END
$diagnostic$;

SELECT phase,result
FROM learning_seed_diagnostics
ORDER BY phase;

