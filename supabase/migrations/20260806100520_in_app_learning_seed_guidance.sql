-- Phase 2 of the in-app learning seed: tooltips and guided tour.
DELETE FROM public.help_tooltips
WHERE organization_id IS NULL
  AND page_key IN ('accounting_trial','accounting_bank_reconciliation','practice_finance','accounting_manual');

INSERT INTO public.help_tooltips(page_key,field_key,term,explanation) VALUES
('accounting_trial','trial_balance','Trial balance','A list of ledger account balances used to confirm total debits equal total credits.'),
('accounting_bank_reconciliation','reconciling_item','Reconciling item','A timing difference or error explaining why the bank statement and ledger balances differ.'),
('practice_finance','wip','Work in progress (WIP)','Time and costs recorded on client work that have not yet been billed or written off.'),
('accounting_manual','locked_period','Locked period','A completed period where changes require authorized reopening or a later-period adjustment.');

DELETE FROM public.guided_tours
WHERE organization_id IS NULL
  AND page_key = 'practice_dashboard'
  AND version = 1;

INSERT INTO public.guided_tours(id,page_key,title,description) VALUES
('ba470000-0000-4000-8000-000000000001','practice_dashboard','Professional Practice quick tour','Move from a dashboard exception to the client work needing attention.');

INSERT INTO public.guided_tour_steps(tour_id,step_order,title,body) VALUES
('ba470000-0000-4000-8000-000000000001',1,'Start with exceptions','Review overdue work, unresolved points and high-risk engagements first.'),
('ba470000-0000-4000-8000-000000000001',2,'Open the client or engagement','Open the record that owns the work and evidence.'),
('ba470000-0000-4000-8000-000000000001',3,'Assign and monitor the action','Give the task an owner and due date, then monitor completion.');

