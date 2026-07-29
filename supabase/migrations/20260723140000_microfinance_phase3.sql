-- BOAT Microfinance Phase 3: accounting integration, reconciliation and BOAT Connect controls.

create table if not exists public.mf_accounting_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  loan_principal_receivable_id uuid references public.gl_accounts(id),
  interest_receivable_id uuid references public.gl_accounts(id),
  interest_income_id uuid references public.gl_accounts(id),
  processing_fee_income_id uuid references public.gl_accounts(id),
  loan_form_income_id uuid references public.gl_accounts(id),
  insurance_account_id uuid references public.gl_accounts(id),
  penalty_income_id uuid references public.gl_accounts(id),
  cash_account_id uuid references public.gl_accounts(id),
  bank_account_id uuid references public.gl_accounts(id),
  mobile_money_account_id uuid references public.gl_accounts(id),
  loan_loss_provision_id uuid references public.gl_accounts(id),
  provision_expense_id uuid references public.gl_accounts(id),
  writeoff_expense_id uuid references public.gl_accounts(id),
  written_off_recovery_income_id uuid references public.gl_accounts(id),
  suspended_interest_account_id uuid references public.gl_accounts(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.mf_sync_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_system text not null,
  source_filename text,
  import_type text not null check (import_type in ('borrowers','applications','opening_loans','repayments','guarantors','collateral','followups')),
  status text not null default 'processing' check (status in ('processing','completed','completed_with_errors','failed')),
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  rejected_rows integer not null default 0,
  conflict_rows integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references auth.users(id)
);

create table if not exists public.mf_sync_import_errors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  import_id uuid not null references public.mf_sync_imports(id) on delete cascade,
  row_number integer not null,
  field_name text,
  reason text not null,
  row_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.mf_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  import_id uuid not null references public.mf_sync_imports(id) on delete cascade,
  record_type text not null,
  external_reference text not null,
  boat_record_id uuid,
  incoming_payload jsonb not null,
  existing_payload jsonb,
  status text not null default 'open' check (status in ('open','accepted_incoming','kept_boat','resolved')),
  resolution_reason text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mf_sync_imports_org_idx on public.mf_sync_imports(organization_id,started_at desc);
create index if not exists mf_sync_conflicts_queue_idx on public.mf_sync_conflicts(organization_id,status,created_at);

create or replace function public.mf_payment_gl_account(settings public.mf_accounting_settings, method text)
returns uuid language sql immutable as $$
  select case method
    when 'bank' then settings.bank_account_id
    when 'mobile_money' then settings.mobile_money_account_id
    when 'cheque' then settings.bank_account_id
    when 'transfer' then settings.bank_account_id
    else settings.cash_account_id end;
$$;

create or replace function public.mf_can_post_repayments(target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select public.mf_can_manage_sensitive(target_org) or exists (
    select 1 from public.staff s where s.id=auth.uid() and s.organization_id=target_org
      and lower(coalesce(s.role::text,'')) in ('cashier','loan_officer')
  ) or exists (
    select 1 from public.organization_members m where m.user_id=auth.uid()
      and m.organization_id=target_org and m.is_active=true
      and lower(coalesce(m.role::text,'')) in ('cashier','loan_officer')
  );
$$;

create or replace function public.mf_post_repayment(p_repayment_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  payment public.mf_repayments%rowtype;
  loan public.mf_loans%rowtype;
  settings public.mf_accounting_settings%rowtype;
  remaining numeric(18,2); penalty_part numeric(18,2); fee_part numeric(18,2);
  interest_part numeric(18,2); principal_part numeric(18,2); overpayment numeric(18,2);
  cash_gl uuid; lines jsonb := '[]'::jsonb; journal_id uuid;
begin
  select * into payment from public.mf_repayments where id=p_repayment_id for update;
  if payment.id is null then raise exception 'Repayment not found'; end if;
  if not public.mf_can_post_repayments(payment.organization_id) then raise exception 'Access denied'; end if;
  if payment.status='posted' then return payment.journal_entry_id; end if;
  if payment.status<>'pending_posting' then raise exception 'Repayment cannot be posted'; end if;
  select * into loan from public.mf_loans where id=payment.loan_id for update;
  if loan.status in ('approved','ready_for_disbursement') or loan.disbursement_date is null then
    raise exception 'Repayment cannot be posted before disbursement';
  end if;
  select * into settings from public.mf_accounting_settings where organization_id=payment.organization_id;
  cash_gl:=public.mf_payment_gl_account(settings,payment.payment_method);
  if cash_gl is null or settings.loan_principal_receivable_id is null
    or settings.interest_income_id is null or settings.penalty_income_id is null
    or settings.processing_fee_income_id is null then
    raise exception 'Complete Microfinance GL mappings before posting';
  end if;

  remaining:=payment.amount;
  penalty_part:=least(remaining,loan.outstanding_penalties); remaining:=remaining-penalty_part;
  fee_part:=least(remaining,loan.outstanding_fees); remaining:=remaining-fee_part;
  interest_part:=least(remaining,loan.outstanding_interest); remaining:=remaining-interest_part;
  principal_part:=least(remaining,loan.outstanding_principal); remaining:=remaining-principal_part;
  overpayment:=remaining;

  lines:=lines||jsonb_build_array(jsonb_build_object(
    'gl_account_id',cash_gl,'debit',payment.amount,'credit',0,
    'line_description','Microfinance repayment received',
    'dimensions',jsonb_build_object('loan_id',loan.id,'borrower_id',loan.borrower_id)
  ));
  if principal_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.loan_principal_receivable_id,'debit',0,'credit',principal_part,'line_description','Loan principal recovered')); end if;
  if interest_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',coalesce(settings.interest_receivable_id,settings.interest_income_id),'debit',0,'credit',interest_part,'line_description','Loan interest recovered')); end if;
  if fee_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.processing_fee_income_id,'debit',0,'credit',fee_part,'line_description','Loan fees recovered')); end if;
  if penalty_part>0 then lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.penalty_income_id,'debit',0,'credit',penalty_part,'line_description','Loan penalties recovered')); end if;
  if overpayment>0 then raise exception 'Payment exceeds the outstanding loan balance by %; configure an overpayment liability before posting',overpayment; end if;

  journal_id:=public.create_journal_entry_atomic(
    payment.payment_date,'Microfinance repayment '||payment.external_reference,'mf_repayment',
    payment.id,auth.uid(),lines,payment.organization_id
  );
  insert into public.mf_repayment_allocations(organization_id,repayment_id,component,amount,created_by)
  select payment.organization_id,payment.id,x.component,x.amount,auth.uid()
  from (values ('penalty',penalty_part),('fee',fee_part),('interest',interest_part),('principal',principal_part)) x(component,amount)
  where x.amount>0;
  update public.mf_loans set
    outstanding_penalties=outstanding_penalties-penalty_part,
    outstanding_fees=outstanding_fees-fee_part,
    outstanding_interest=outstanding_interest-interest_part,
    outstanding_principal=outstanding_principal-principal_part,
    status=case when outstanding_principal-principal_part<=0 and outstanding_interest-interest_part<=0
      and outstanding_fees-fee_part<=0 and outstanding_penalties-penalty_part<=0 then 'closed' else status end,
    updated_at=now(),updated_by=auth.uid()
  where id=loan.id;
  update public.mf_repayments set status='posted',posted_by=auth.uid(),posted_at=now(),journal_entry_id=journal_id where id=payment.id;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value)
  values(payment.organization_id,auth.uid(),'repayment_posted','mf_repayments',payment.id,
    jsonb_build_object('journal_entry_id',journal_id,'principal',principal_part,'interest',interest_part,'fees',fee_part,'penalties',penalty_part));
  return journal_id;
end $$;

create or replace function public.mf_post_disbursement(p_disbursement_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.mf_disbursements%rowtype; loan public.mf_loans%rowtype;
  settings public.mf_accounting_settings%rowtype; cash_gl uuid; journal_id uuid; lines jsonb;
begin
  select * into d from public.mf_disbursements where id=p_disbursement_id for update;
  if d.id is null or not public.mf_can_manage_sensitive(d.organization_id) then raise exception 'Access denied'; end if;
  if d.journal_entry_id is not null then return d.journal_entry_id; end if;
  select * into loan from public.mf_loans where id=d.loan_id for update;
  if loan.status not in ('approved','ready_for_disbursement') then raise exception 'Loan is not approved for disbursement'; end if;
  select * into settings from public.mf_accounting_settings where organization_id=d.organization_id;
  cash_gl:=public.mf_payment_gl_account(settings,d.method);
  if cash_gl is null or settings.loan_principal_receivable_id is null then raise exception 'Complete Microfinance GL mappings before posting'; end if;
  lines:=jsonb_build_array(
    jsonb_build_object('gl_account_id',settings.loan_principal_receivable_id,'debit',d.amount+d.charges_financed,'credit',0,'line_description','Microfinance loan principal'),
    jsonb_build_object('gl_account_id',cash_gl,'debit',0,'credit',d.net_amount,'line_description','Loan proceeds paid')
  );
  if d.charges_deducted+d.charges_financed>0 then
    if settings.processing_fee_income_id is null then raise exception 'Fee income GL mapping is required'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('gl_account_id',settings.processing_fee_income_id,'debit',0,'credit',d.charges_deducted+d.charges_financed,'line_description','Loan charges'));
  end if;
  journal_id:=public.create_journal_entry_atomic(d.disbursed_at::date,'Microfinance disbursement '||d.disbursement_reference,'mf_disbursement',d.id,auth.uid(),lines,d.organization_id);
  update public.mf_disbursements set journal_entry_id=journal_id where id=d.id;
  update public.mf_loans set status='active',disbursement_date=d.disbursed_at::date,updated_at=now(),updated_by=auth.uid() where id=loan.id;
  return journal_id;
end $$;

create or replace function public.mf_post_provisions(p_organization_id uuid,p_calculation_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare settings public.mf_accounting_settings%rowtype; adjustment numeric(18,2); batch_id uuid:=gen_random_uuid(); journal_id uuid;
begin
  if not public.mf_can_manage_sensitive(p_organization_id) then raise exception 'Access denied'; end if;
  select * into settings from public.mf_accounting_settings where organization_id=p_organization_id;
  if settings.loan_loss_provision_id is null or settings.provision_expense_id is null then raise exception 'Provision GL mappings are required'; end if;
  select coalesce(sum(shortfall_or_excess),0) into adjustment from public.mf_provisions
  where organization_id=p_organization_id and calculation_date=p_calculation_date and status='calculated';
  if adjustment=0 then raise exception 'No unposted provision adjustment'; end if;
  journal_id:=public.create_journal_entry_atomic(p_calculation_date,'Microfinance loan-loss provision','mf_provision',batch_id,auth.uid(),
    case when adjustment>0 then jsonb_build_array(
      jsonb_build_object('gl_account_id',settings.provision_expense_id,'debit',adjustment,'credit',0,'line_description','Provision expense'),
      jsonb_build_object('gl_account_id',settings.loan_loss_provision_id,'debit',0,'credit',adjustment,'line_description','Loan-loss provision'))
    else jsonb_build_array(
      jsonb_build_object('gl_account_id',settings.loan_loss_provision_id,'debit',abs(adjustment),'credit',0,'line_description','Provision release'),
      jsonb_build_object('gl_account_id',settings.provision_expense_id,'debit',0,'credit',abs(adjustment),'line_description','Provision expense reversal')) end,
    p_organization_id);
  update public.mf_provisions set status='posted',journal_entry_id=journal_id where organization_id=p_organization_id and calculation_date=p_calculation_date and status='calculated';
  return journal_id;
end $$;

create or replace function public.mf_loan_subledger_reconciliation(p_organization_id uuid,p_as_of date default current_date)
returns table(subledger_principal numeric,gl_control_balance numeric,difference numeric) language sql stable security definer set search_path=public as $$
  with settings as (select * from public.mf_accounting_settings where organization_id=p_organization_id),
  subledger as (
    select coalesce(sum(outstanding_principal),0)::numeric amount from public.mf_loans
    where organization_id=p_organization_id and status not in ('closed','written_off')
  ), ledger as (
    select coalesce(sum(jel.debit-jel.credit),0)::numeric amount
    from public.journal_entry_lines jel join public.journal_entries je on je.id=jel.journal_entry_id
    join settings s on s.loan_principal_receivable_id=jel.gl_account_id
    where je.organization_id=p_organization_id and je.entry_date<=p_as_of and coalesce(je.is_deleted,false)=false
  )
  select round(subledger.amount,2),round(ledger.amount,2),round(subledger.amount-ledger.amount,2) from subledger,ledger;
$$;

do $$
declare t text;
begin
  foreach t in array array['mf_accounting_settings','mf_sync_imports','mf_sync_import_errors','mf_sync_conflicts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists mf_org_select on public.%I',t);
    execute format('create policy mf_org_select on public.%I for select using (public.mf_is_org_user(organization_id))',t);
    execute format('drop policy if exists mf_org_insert on public.%I',t);
    execute format('create policy mf_org_insert on public.%I for insert with check (public.mf_is_org_user(organization_id))',t);
    execute format('drop policy if exists mf_org_update on public.%I',t);
    execute format('create policy mf_org_update on public.%I for update using (public.mf_is_org_user(organization_id)) with check (public.mf_is_org_user(organization_id))',t);
  end loop;
end $$;

drop policy if exists mf_org_insert on public.mf_accounting_settings;
create policy mf_org_insert on public.mf_accounting_settings for insert
with check (public.mf_can_manage_sensitive(organization_id));
drop policy if exists mf_org_update on public.mf_accounting_settings;
create policy mf_org_update on public.mf_accounting_settings for update
using (public.mf_can_manage_sensitive(organization_id))
with check (public.mf_can_manage_sensitive(organization_id));

grant select,insert,update on public.mf_accounting_settings,public.mf_sync_imports,public.mf_sync_import_errors,public.mf_sync_conflicts to authenticated;
grant execute on function public.mf_post_repayment(uuid),public.mf_post_disbursement(uuid),
  public.mf_post_provisions(uuid,date),public.mf_loan_subledger_reconciliation(uuid,date) to authenticated;
