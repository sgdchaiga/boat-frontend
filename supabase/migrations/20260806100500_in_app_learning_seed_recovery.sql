-- Recovery seed for databases where the learning foundation schema was created
-- but the original content seed did not finish. Safe to run repeatedly.

DELETE FROM public.help_articles
WHERE organization_id IS NULL
  AND page_key IN (
    'practice_clients','data_migration','transactions','accounting_bank_reconciliation',
    'accounting_manual','practice_documents','accounting_trial','accounting_income',
    'reports','practice_quality','practice_tasks','practice_dashboard'
  );

INSERT INTO public.help_articles(page_key,module_key,title,short_description,instructions,common_mistakes,related_guidance,troubleshooting) VALUES
('practice_clients','practice','Set up a client','Create the client record used by engagements, documents, billing and reports.','["Confirm the legal name and client type.","Add primary contacts and communication details.","Complete tax and compliance identifiers before opening an engagement."]','["Creating duplicate client records","Starting work before compliance details are captured"]','["Client acceptance and conflict checks","Opening balances"]','["If a client is not visible, confirm your organization and permissions."]'),
('data_migration','practice','Import opening balances','Bring approved opening balances into BOAT before normal processing begins.','["Download and complete the BOAT template.","Validate account codes and the effective date.","Confirm total debits equal total credits.","Preview exceptions before posting."]','["Importing an unbalanced file","Using transactions from a locked period"]','["Trial balance","Period controls"]','["Correct every validation row, then upload the revised file."]'),
('transactions','practice','Import accounting transactions','Validate and import transaction files without losing source-document traceability.','["Choose the correct client and period.","Upload the source file.","Map every required column.","Review duplicates and exceptions before import."]','["Mapping amounts to the wrong debit or credit field","Ignoring duplicate references"]','["Bank statement import","Adjustment journals"]','["Return to column mapping when a required field is blank."]'),
('accounting_bank_reconciliation','practice','Complete a bank reconciliation','Match BOAT cashbook activity to the bank statement and explain every difference.','["Select the bank account and statement period.","Enter the statement closing balance.","Match receipts and payments.","Investigate remaining differences and save the reconciliation."]','["Using the ledger balance as the statement balance","Leaving old unmatched items unexplained"]','["Bank statement mapping","Adjustment journals"]','["Verify the opening balance, date range and duplicate entries."]'),
('accounting_manual','practice','Post adjustment journals','Record approved corrections and period-end adjustments with a complete audit trail.','["Select the correct client and period.","Enter balanced debit and credit lines.","Attach supporting evidence.","Submit for review or approval."]','["Posting into a locked period","Using suspense without explanation"]','["Working papers","Review and approvals"]','["Request authorized reopening or use the next permitted period."]'),
('practice_documents','practice','Prepare working papers','Store evidence supporting balances, judgements and conclusions.','["Choose the client and engagement.","Use the approved naming convention.","Link the paper to the relevant task or balance.","Resolve review notes."]','["Uploading to the wrong engagement","Completing with unresolved review points"]','["Trial balance","Financial statements"]','["Check file type, size and engagement access."]'),
('accounting_trial','practice','Review the trial balance','Confirm the ledger is balanced and ready for financial-statement preparation.','["Select the reporting date.","Review unusual and suspense balances.","Open supporting ledgers and working papers.","Resolve material exceptions."]','["Reviewing the wrong period","Accepting unsupported balances"]','["Working papers","Financial statements"]','["Trace unexpected balances to journals and source transactions."]'),
('accounting_income','practice','Generate financial statements','Produce statements from the approved trial balance and mapped accounts.','["Confirm mappings and period.","Generate draft statements.","Review comparatives, notes and rounding.","Submit for approval."]','["Generating before adjustments are approved","Leaving unmapped accounts"]','["Trial balance","Management reports"]','["Resolve unmapped or unsupported balances before regenerating."]'),
('reports','practice','Prepare management and board reports','Turn approved accounting information into concise management reporting.','["Choose the approved period.","Review key movements.","Add supported explanations.","Resolve review points before issue."]','["Reporting from an incomplete period","Publishing unresolved review notes"]','["Financial statements","Review and approvals"]','["Verify filters and posting status when totals differ."]'),
('practice_quality','practice','Review and approve work','Document review points, evidence, decisions and client sign-off.','["Open the quality workspace.","Raise specific review notes.","Assign and resolve each point.","Approve only after evidence is complete."]','["Approving with open review notes","Unclear correction requests"]','["Working papers","Client sign-off"]','["Reopen the task if evidence must be replaced."]'),
('practice_tasks','practice','Close an accounting period','Protect approved records after reconciliation, review and reporting are complete.','["Confirm reconciliations and papers are complete.","Verify journals and review points.","Generate final reports and backups.","Close with authorized access."]','["Closing before reconciliation","Reopening without an audit reason"]','["Financial statements","Review and approvals"]','["Use the close checklist to find the blocking item."]'),
('practice_dashboard','practice','Professional Practice overview','Monitor clients, engagements, deadlines, WIP and exceptions.','["Review overdue and high-risk work.","Open the relevant client or engagement.","Assign actions and monitor completion."]','["Treating alerts as entries","Ignoring unassigned overdue work"]','["Clients","Engagements","Staff capacity"]','["Refresh filters and confirm access if work is missing."]');

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

INSERT INTO public.guided_tours(id,page_key,title,description)
VALUES (
  'ba470000-0000-4000-8000-000000000001',
  'practice_dashboard',
  'Professional Practice quick tour',
  'Move from a dashboard exception to the client work needing attention.'
);

INSERT INTO public.guided_tour_steps(tour_id,step_order,title,body)
VALUES
('ba470000-0000-4000-8000-000000000001',1,'Start with exceptions','Review overdue work, unresolved points and high-risk engagements first.'),
('ba470000-0000-4000-8000-000000000001',2,'Open the client or engagement','Open the record that owns the work and evidence.'),
('ba470000-0000-4000-8000-000000000001',3,'Assign and monitor the action','Give the task an owner and due date, then monitor completion.');

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
