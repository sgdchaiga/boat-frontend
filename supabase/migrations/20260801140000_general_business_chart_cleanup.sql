-- Hide legacy industry-template accounts from General Business without deleting
-- history. Only unused accounts are deactivated; journal-linked accounts remain
-- active so prior financial statements and audit trails stay complete.
UPDATE public.gl_accounts ga
SET is_active = false
FROM public.organizations o
WHERE ga.organization_id = o.id
  AND o.business_type = 'general_business'
  AND ga.is_active = true
  AND lower(coalesce(ga.account_code,'') || ' ' || coalesce(ga.account_name,'') || ' ' || coalesce(ga.category,'')) ~
    '(hotel|guest|room revenue|room charge|accommodation|housekeeping|sauna|bar pos|kitchen pos|clinic|patient|consultation|laboratory|medical|pharmacy|dispensary|school|student|tuition|bursary|school fees|term fees|sacco|vsla|member savings|share-out|share out|loan portfolio|teller vault|manufacturing wip|work in progress|finished goods production|production overhead|scrap inventory)'
  AND NOT EXISTS (
    SELECT 1 FROM public.journal_entry_lines jel WHERE jel.gl_account_id = ga.id
  );
