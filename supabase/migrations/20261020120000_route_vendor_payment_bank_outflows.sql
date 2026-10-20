-- Supplier payments record the selected bank in vendor_payments.bank_name.
-- Older journals, however, credited the default cash account even for a bank
-- transfer. Move only their funding line to the matching active bank GL so the
-- bank account ledger and GL balance include the historical outflow.
UPDATE public.journal_entry_lines AS line
SET gl_account_id = bank_account.id
FROM public.journal_entries AS journal
JOIN public.vendor_payments AS payment
  ON payment.id = journal.reference_id
JOIN public.gl_accounts AS bank_account
  ON bank_account.organization_id = journal.organization_id
  AND lower(trim(bank_account.account_name)) = lower(trim(payment.bank_name))
  AND bank_account.account_type = 'asset'
  AND bank_account.is_active = true
WHERE line.journal_entry_id = journal.id
  AND journal.reference_type = 'vendor_payment'
  AND journal.is_posted = true
  AND coalesce(journal.is_deleted, false) = false
  AND payment.payment_method = 'bank_transfer'
  AND nullif(trim(payment.bank_name), '') IS NOT NULL
  AND line.credit > 0
  AND line.line_description = 'Source of funds';
