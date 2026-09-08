-- Standard Microfinance chart of accounts plus controlled repayment reversal.

create or replace function public.seed_microfinance_chart_of_accounts(p_organization_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
  inserted_count integer := 0;
  account_id uuid;
  parent_account_id uuid;
begin
  if p_organization_id is null then raise exception 'organization_id is required'; end if;
  if not public.mf_can_manage_sensitive(p_organization_id) then raise exception 'Access denied'; end if;

  for r in
    select * from (values
      ('1000','Assets','asset','other',null::text),
      ('1100','Cash and cash equivalents','asset','cash','1000'),
      ('1110','Cash on hand','asset','cash','1100'),
      ('1120','Bank account','asset','cash','1100'),
      ('1130','Mobile money account','asset','cash','1100'),
      ('1200','Loan portfolio','asset','receivable','1000'),
      ('1210','Loan principal receivable','asset','receivable','1200'),
      ('1220','Interest receivable','asset','receivable','1200'),
      ('1230','Fees receivable','asset','receivable','1200'),
      ('1240','Suspended interest memorandum','asset','receivable','1200'),
      ('1290','Allowance for loan losses','asset','receivable','1200'),
      ('1500','Property and equipment','asset','other','1000'),
      ('1590','Accumulated depreciation','asset','other','1500'),
      ('2000','Liabilities','liability','other',null::text),
      ('2100','Current liabilities','liability','payable','2000'),
      ('2110','Accounts payable','liability','payable','2100'),
      ('2120','Insurance payable','liability','payable','2100'),
      ('2130','Taxes payable','liability','payable','2100'),
      ('2140','Borrower overpayments','liability','payable','2100'),
      ('3000','Equity','equity','other',null::text),
      ('3100','Owner capital','equity','other','3000'),
      ('3200','Retained earnings','equity','other','3000'),
      ('3300','Owner drawings','equity','other','3000'),
      ('4000','Income','income','revenue',null::text),
      ('4100','Interest income on loans','income','revenue','4000'),
      ('4110','Processing fee income','income','revenue','4000'),
      ('4120','Loan form fee income','income','revenue','4000'),
      ('4130','Insurance commission income','income','revenue','4000'),
      ('4140','Penalty income','income','revenue','4000'),
      ('4150','Other loan fee income','income','revenue','4000'),
      ('4160','Written-off loan recovery income','income','revenue','4000'),
      ('4200','Other operating income','income','other','4000'),
      ('5000','Operating expenses','expense','expense',null::text),
      ('5100','Salaries and wages','expense','expense','5000'),
      ('5110','Rent expense','expense','expense','5000'),
      ('5120','Utilities','expense','expense','5000'),
      ('5130','Transport and field visits','expense','expense','5000'),
      ('5140','Communication expense','expense','expense','5000'),
      ('5150','Bank and mobile-money charges','expense','expense','5000'),
      ('5160','Professional fees','expense','expense','5000'),
      ('5170','Depreciation expense','expense','expense','5000'),
      ('5200','Loan-loss provision expense','expense','expense','5000'),
      ('5210','Loan write-off expense','expense','expense','5000'),
      ('5290','Other operating expenses','expense','expense','5000')
    ) v(account_code,account_name,account_type,category,parent_code)
  loop
    select id into account_id from public.gl_accounts
     where organization_id=p_organization_id and account_code=r.account_code limit 1;
    if account_id is not null then continue; end if;
    parent_account_id := null;
    if r.parent_code is not null then
      select id into parent_account_id from public.gl_accounts
       where organization_id=p_organization_id and account_code=r.parent_code limit 1;
    end if;
    insert into public.gl_accounts(
      id,organization_id,account_code,account_name,account_type,category,parent_id,is_active
    ) values (
      gen_random_uuid(),p_organization_id,r.account_code,r.account_name,r.account_type,r.category,parent_account_id,true
    );
    inserted_count := inserted_count + 1;
  end loop;

  insert into public.mf_accounting_settings(
    organization_id,loan_principal_receivable_id,interest_receivable_id,interest_income_id,
    processing_fee_income_id,loan_form_income_id,insurance_account_id,penalty_income_id,
    cash_account_id,bank_account_id,mobile_money_account_id,loan_loss_provision_id,
    provision_expense_id,writeoff_expense_id,written_off_recovery_income_id,
    suspended_interest_account_id,updated_at,updated_by
  )
  select p_organization_id,
    (min(id::text) filter(where account_code='1210'))::uuid,(min(id::text) filter(where account_code='1220'))::uuid,
    (min(id::text) filter(where account_code='4100'))::uuid,(min(id::text) filter(where account_code='4110'))::uuid,
    (min(id::text) filter(where account_code='4120'))::uuid,(min(id::text) filter(where account_code='2120'))::uuid,
    (min(id::text) filter(where account_code='4140'))::uuid,(min(id::text) filter(where account_code='1110'))::uuid,
    (min(id::text) filter(where account_code='1120'))::uuid,(min(id::text) filter(where account_code='1130'))::uuid,
    (min(id::text) filter(where account_code='1290'))::uuid,(min(id::text) filter(where account_code='5200'))::uuid,
    (min(id::text) filter(where account_code='5210'))::uuid,(min(id::text) filter(where account_code='4160'))::uuid,
    (min(id::text) filter(where account_code='1240'))::uuid,now(),auth.uid()
  from public.gl_accounts where organization_id=p_organization_id
  on conflict(organization_id) do update set
    loan_principal_receivable_id=coalesce(mf_accounting_settings.loan_principal_receivable_id,excluded.loan_principal_receivable_id),
    interest_receivable_id=coalesce(mf_accounting_settings.interest_receivable_id,excluded.interest_receivable_id),
    interest_income_id=coalesce(mf_accounting_settings.interest_income_id,excluded.interest_income_id),
    processing_fee_income_id=coalesce(mf_accounting_settings.processing_fee_income_id,excluded.processing_fee_income_id),
    loan_form_income_id=coalesce(mf_accounting_settings.loan_form_income_id,excluded.loan_form_income_id),
    insurance_account_id=coalesce(mf_accounting_settings.insurance_account_id,excluded.insurance_account_id),
    penalty_income_id=coalesce(mf_accounting_settings.penalty_income_id,excluded.penalty_income_id),
    cash_account_id=coalesce(mf_accounting_settings.cash_account_id,excluded.cash_account_id),
    bank_account_id=coalesce(mf_accounting_settings.bank_account_id,excluded.bank_account_id),
    mobile_money_account_id=coalesce(mf_accounting_settings.mobile_money_account_id,excluded.mobile_money_account_id),
    loan_loss_provision_id=coalesce(mf_accounting_settings.loan_loss_provision_id,excluded.loan_loss_provision_id),
    provision_expense_id=coalesce(mf_accounting_settings.provision_expense_id,excluded.provision_expense_id),
    writeoff_expense_id=coalesce(mf_accounting_settings.writeoff_expense_id,excluded.writeoff_expense_id),
    written_off_recovery_income_id=coalesce(mf_accounting_settings.written_off_recovery_income_id,excluded.written_off_recovery_income_id),
    suspended_interest_account_id=coalesce(mf_accounting_settings.suspended_interest_account_id,excluded.suspended_interest_account_id),
    updated_at=now(),updated_by=auth.uid();

  return inserted_count;
end $$;

create or replace function public.mf_reverse_repayment(p_repayment_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  payment public.mf_repayments%rowtype; loan public.mf_loans%rowtype;
  settings public.mf_accounting_settings%rowtype; cash_gl uuid; journal_id uuid;
  principal_part numeric:=0; interest_part numeric:=0; fee_part numeric:=0; penalty_part numeric:=0;
  lines jsonb:='[]'::jsonb; reversal_id uuid:=gen_random_uuid();
begin
  if nullif(trim(p_reason),'') is null then raise exception 'Reversal reason is required'; end if;
  select * into payment from public.mf_repayments where id=p_repayment_id for update;
  if payment.id is null or payment.status<>'posted' then raise exception 'Only a posted repayment can be reversed'; end if;
  if not public.mf_can_manage_sensitive(payment.organization_id) then raise exception 'Access denied'; end if;
  select * into loan from public.mf_loans where id=payment.loan_id for update;
  select * into settings from public.mf_accounting_settings where organization_id=payment.organization_id;
  select coalesce(sum(amount) filter(where component='principal'),0),
         coalesce(sum(amount) filter(where component='interest'),0),
         coalesce(sum(amount) filter(where component='fee'),0),
         coalesce(sum(amount) filter(where component='penalty'),0)
    into principal_part,interest_part,fee_part,penalty_part
    from public.mf_repayment_allocations where repayment_id=payment.id;
  cash_gl:=public.mf_payment_gl_account(settings,payment.payment_method);
  lines:=jsonb_build_array(jsonb_build_object('gl_account_id',cash_gl,'debit',0,'credit',payment.amount,'line_description','Repayment reversal'));
  if principal_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.loan_principal_receivable_id,'debit',principal_part,'credit',0,'line_description','Restore loan principal')); end if;
  if interest_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',coalesce(settings.interest_receivable_id,settings.interest_income_id),'debit',interest_part,'credit',0,'line_description','Restore loan interest')); end if;
  if fee_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.processing_fee_income_id,'debit',fee_part,'credit',0,'line_description','Reverse loan fees')); end if;
  if penalty_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.penalty_income_id,'debit',penalty_part,'credit',0,'line_description','Reverse penalties')); end if;
  journal_id:=public.create_journal_entry_atomic(current_date,'Repayment reversal: '||p_reason,'mf_repayment_reversal',reversal_id,auth.uid(),lines,payment.organization_id);
  insert into public.mf_repayments(id,organization_id,loan_id,receipt_number,external_reference,amount,payment_date,payment_method,status,reversal_of,reversal_reason,journal_entry_id,posted_by,posted_at,created_by)
  values(reversal_id,payment.organization_id,payment.loan_id,'REV-'||coalesce(payment.receipt_number,payment.id::text),'REV-'||payment.external_reference,payment.amount,current_date,payment.payment_method,'posted',payment.id,p_reason,journal_id,auth.uid(),now(),auth.uid());
  update public.mf_repayments set status='reversed',reversal_reason=p_reason where id=payment.id;
  update public.mf_loans set outstanding_principal=outstanding_principal+principal_part,outstanding_interest=outstanding_interest+interest_part,
    outstanding_fees=outstanding_fees+fee_part,outstanding_penalties=outstanding_penalties+penalty_part,
    status=case when status='closed' then 'active' else status end,updated_at=now(),updated_by=auth.uid() where id=loan.id;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value,reason)
  values(payment.organization_id,auth.uid(),'repayment_reversed','mf_repayments',payment.id,jsonb_build_object('reversal_id',reversal_id,'journal_entry_id',journal_id),p_reason);
  return reversal_id;
end $$;

grant execute on function public.seed_microfinance_chart_of_accounts(uuid) to authenticated,service_role;
grant execute on function public.mf_reverse_repayment(uuid,text) to authenticated,service_role;
