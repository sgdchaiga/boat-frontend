-- Phase 3 of the in-app learning seed: practice tasks and diagnostic cleanup.
DELETE FROM public.training_tasks
WHERE organization_id IS NULL
  AND module_key = 'practice'
  AND title IN (
    'Create a training client',
    'Match the UGX 850,000 deposit',
    'Correct the deliberate posting error'
  );

INSERT INTO public.training_tasks(module_key,page_key,title,instructions,success_criteria,task_order,points) VALUES
('practice','practice_clients','Create a training client','Create Kampala Traders Ltd - Training Account with a primary contact.','["Training marker present","Primary contact present","Identifiers complete"]',1,10),
('practice','accounting_bank_reconciliation','Match the UGX 850,000 deposit','Match the deposit to invoice INV-0045 in the protected training account.','["Correct records matched","Difference reduced","No live record affected"]',2,20),
('practice','accounting_manual','Correct the deliberate posting error','Prepare a balanced adjustment journal and attach evidence.','["Journal balances","Explanation clear","Evidence attached"]',3,20);

DELETE FROM public.help_articles
WHERE page_key = '__migration_test__';

