-- BOAT Microfinance Phase 2: arrears, collections, suspension, provisioning,
-- penalties, waivers, restructuring, write-offs and recoveries.

create table if not exists public.mf_collection_followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  borrower_id uuid not null references public.mf_borrowers(id) on delete restrict,
  amount_overdue numeric(18,2) not null default 0,
  days_overdue integer not null default 0,
  assigned_officer_id uuid references public.staff(id),
  contact_date date not null default current_date,
  contact_method text not null check (contact_method in ('phone','sms','email','field_visit','other')),
  borrower_response text,
  promise_to_pay_amount numeric(18,2),
  promise_date date,
  followup_date date,
  field_visit_notes text,
  outcome text,
  next_action text,
  status text not null default 'open' check (status in ('open','promise_pending','broken_promise','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create table if not exists public.mf_penalties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  schedule_id uuid references public.mf_repayment_schedules(id) on delete restrict,
  penalty_date date not null default current_date,
  calculation_basis text not null check (calculation_basis in ('fixed','overdue_amount','overdue_principal')),
  rate numeric(12,6),
  amount numeric(18,2) not null check (amount > 0),
  amount_paid numeric(18,2) not null default 0,
  amount_waived numeric(18,2) not null default 0,
  reason text not null,
  status text not null default 'posted' check (status in ('posted','part_paid','paid','waived','reversed')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  constraint mf_penalty_balances check (amount_paid >= 0 and amount_waived >= 0 and amount_paid + amount_waived <= amount)
);

create table if not exists public.mf_waivers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  component text not null check (component in ('penalty','fee','interest')),
  source_record_id uuid,
  amount numeric(18,2) not null check (amount > 0),
  reason text not null,
  status text not null default 'approved' check (status in ('requested','approved','rejected','reversed')),
  requested_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mf_interest_suspensions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  action text not null check (action in ('suspend','resume')),
  effective_date date not null default current_date,
  accrued_before_suspension numeric(18,2) not null default 0,
  interest_paid numeric(18,2) not null default 0,
  interest_outstanding numeric(18,2) not null default 0,
  suspended_interest numeric(18,2) not null default 0,
  memorandum_interest numeric(18,2) not null default 0,
  reason text not null,
  automatic boolean not null default false,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.mf_classification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null,
  min_days_past_due integer not null check (min_days_past_due >= 0),
  max_days_past_due integer,
  provision_rate numeric(7,4) not null check (provision_rate between 0 and 100),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  unique (organization_id, name),
  check (max_days_past_due is null or max_days_past_due >= min_days_past_due)
);

create table if not exists public.mf_provisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  calculation_date date not null,
  classification text not null,
  outstanding_principal numeric(18,2) not null,
  provision_rate numeric(7,4) not null,
  required_provision numeric(18,2) not null,
  existing_provision numeric(18,2) not null default 0,
  shortfall_or_excess numeric(18,2) not null default 0,
  status text not null default 'calculated' check (status in ('calculated','approved','posted','reversed')),
  approved_by uuid references auth.users(id),
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (loan_id, calculation_date)
);

create table if not exists public.mf_restructures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  restructure_type text not null check (restructure_type in ('term_extension','frequency_change','installment_reduction','rate_change','capitalization','refinance','top_up','moratorium')),
  reason text not null,
  outstanding_principal numeric(18,2) not null,
  outstanding_interest numeric(18,2) not null default 0,
  original_terms jsonb not null,
  new_terms jsonb not null,
  old_schedule_version integer not null,
  new_schedule_version integer,
  status text not null default 'approved' check (status in ('requested','approved','implemented','rejected','reversed')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  implemented_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table if not exists public.mf_writeoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  writeoff_date date not null,
  principal_written_off numeric(18,2) not null check (principal_written_off >= 0),
  interest_written_off numeric(18,2) not null default 0 check (interest_written_off >= 0),
  fees_written_off numeric(18,2) not null default 0 check (fees_written_off >= 0),
  penalties_written_off numeric(18,2) not null default 0 check (penalties_written_off >= 0),
  reason text not null,
  status text not null default 'approved' check (status in ('requested','approved','posted','reversed')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  journal_entry_id uuid references public.journal_entries(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (loan_id, writeoff_date)
);

create table if not exists public.mf_recoveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  writeoff_id uuid not null references public.mf_writeoffs(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict,
  recovery_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash','bank','mobile_money','cheque','transfer')),
  external_reference text not null,
  journal_entry_id uuid references public.journal_entries(id),
  received_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (organization_id, external_reference)
);

create index if not exists mf_followups_worklist_idx on public.mf_collection_followups(organization_id, status, followup_date);
create index if not exists mf_penalties_loan_idx on public.mf_penalties(organization_id, loan_id, status);
create index if not exists mf_suspensions_loan_idx on public.mf_interest_suspensions(organization_id, loan_id, effective_date desc);
create index if not exists mf_provisions_date_idx on public.mf_provisions(organization_id, calculation_date);

create or replace function public.mf_apply_penalty_balance()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.mf_loans
  set outstanding_penalties=outstanding_penalties+new.amount,updated_at=now()
  where id=new.loan_id and organization_id=new.organization_id;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value,reason)
  values(new.organization_id,auth.uid(),'penalty_posted','mf_penalties',new.id,
    jsonb_build_object('loan_id',new.loan_id,'amount',new.amount),new.reason);
  return new;
end $$;
drop trigger if exists mf_penalty_balance_after_insert on public.mf_penalties;
create trigger mf_penalty_balance_after_insert after insert on public.mf_penalties
for each row execute function public.mf_apply_penalty_balance();

create or replace function public.mf_can_manage_sensitive(target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.staff s
    where s.id=auth.uid() and s.organization_id=target_org
      and lower(coalesce(s.role::text,'')) in ('super_admin','admin','manager','accountant')
  ) or exists (
    select 1 from public.organization_members m
    where m.user_id=auth.uid() and m.organization_id=target_org and m.is_active=true
      and lower(coalesce(m.role::text,'')) in ('owner','super_admin','admin','manager','accountant')
  );
$$;

create or replace function public.mf_refresh_arrears(p_organization_id uuid, p_as_of_date date default current_date)
returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if not public.mf_is_org_user(p_organization_id) then raise exception 'Access denied'; end if;

  update public.mf_repayment_schedules s
  set days_past_due=greatest(0,p_as_of_date-s.due_date),
      status=case
        when s.outstanding_amount <= 0 then 'paid'
        when s.due_date < p_as_of_date then 'overdue'
        when s.due_date=p_as_of_date then 'due'
        else 'pending' end
  where s.organization_id=p_organization_id and s.is_current=true;

  update public.mf_loans l
  set days_past_due=coalesce(x.max_dpd,0),
      status=case
        when coalesce(x.max_dpd,0)>=90 then 'non_performing'
        when coalesce(x.max_dpd,0)>0 then 'in_arrears'
        when l.status in ('in_arrears','non_performing') then 'active'
        else l.status end,
      updated_at=now()
  from (
    select loan_id,max(days_past_due) filter(where outstanding_amount>0) max_dpd
    from public.mf_repayment_schedules
    where organization_id=p_organization_id and is_current=true
    group by loan_id
  ) x
  where l.id=x.loan_id and l.organization_id=p_organization_id
    and l.status not in ('closed','written_off');
  get diagnostics affected=row_count;

  update public.mf_collection_followups
  set status='broken_promise',updated_at=now()
  where organization_id=p_organization_id and status='promise_pending'
    and promise_date < p_as_of_date;

  insert into public.mf_audit_log(organization_id,user_id,action,record_type,new_value)
  values(p_organization_id,auth.uid(),'arrears_refreshed','mf_loans',jsonb_build_object('as_of',p_as_of_date,'loans',affected));
  return affected;
end $$;

create or replace function public.mf_suspend_interest(p_loan_id uuid, p_reason text, p_automatic boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare loan public.mf_loans%rowtype; result uuid;
begin
  select * into loan from public.mf_loans where id=p_loan_id for update;
  if loan.id is null or not public.mf_can_manage_sensitive(loan.organization_id) then raise exception 'Access denied'; end if;
  if loan.interest_suspended then raise exception 'Interest is already suspended'; end if;
  insert into public.mf_interest_suspensions(
    organization_id,loan_id,action,accrued_before_suspension,interest_outstanding,
    suspended_interest,reason,automatic,approved_by
  ) values(
    loan.organization_id,loan.id,'suspend',loan.outstanding_interest,loan.outstanding_interest,
    loan.outstanding_interest,p_reason,p_automatic,auth.uid()
  ) returning id into result;
  update public.mf_loans set interest_suspended=true,updated_at=now(),updated_by=auth.uid() where id=loan.id;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value,reason)
  values(loan.organization_id,auth.uid(),'interest_suspended','mf_loans',loan.id,jsonb_build_object('outstanding_interest',loan.outstanding_interest),p_reason);
  return result;
end $$;

create or replace function public.mf_resume_interest(p_loan_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare loan public.mf_loans%rowtype; result uuid;
begin
  select * into loan from public.mf_loans where id=p_loan_id for update;
  if loan.id is null or not public.mf_can_manage_sensitive(loan.organization_id) then raise exception 'Access denied'; end if;
  if not loan.interest_suspended then raise exception 'Interest is not suspended'; end if;
  insert into public.mf_interest_suspensions(
    organization_id,loan_id,action,interest_outstanding,reason,approved_by
  ) values(loan.organization_id,loan.id,'resume',loan.outstanding_interest,p_reason,auth.uid())
  returning id into result;
  update public.mf_loans set interest_suspended=false,updated_at=now(),updated_by=auth.uid() where id=loan.id;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,reason)
  values(loan.organization_id,auth.uid(),'interest_resumed','mf_loans',loan.id,p_reason);
  return result;
end $$;

create or replace function public.mf_apply_waiver(
  p_loan_id uuid, p_component text, p_amount numeric, p_reason text, p_source_record_id uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare loan public.mf_loans%rowtype; available numeric; result uuid;
begin
  select * into loan from public.mf_loans where id=p_loan_id for update;
  if loan.id is null or not public.mf_can_manage_sensitive(loan.organization_id) then raise exception 'Access denied'; end if;
  if p_amount<=0 then raise exception 'Waiver amount must be positive'; end if;
  available:=case p_component when 'penalty' then loan.outstanding_penalties when 'fee' then loan.outstanding_fees when 'interest' then loan.outstanding_interest else null end;
  if available is null or p_amount>available then raise exception 'Waiver exceeds outstanding component'; end if;
  insert into public.mf_waivers(organization_id,loan_id,component,source_record_id,amount,reason,status,requested_by,approved_by,approved_at)
  values(loan.organization_id,loan.id,p_component,p_source_record_id,p_amount,p_reason,'approved',auth.uid(),auth.uid(),now())
  returning id into result;
  update public.mf_loans set
    outstanding_penalties=case when p_component='penalty' then outstanding_penalties-p_amount else outstanding_penalties end,
    outstanding_fees=case when p_component='fee' then outstanding_fees-p_amount else outstanding_fees end,
    outstanding_interest=case when p_component='interest' then outstanding_interest-p_amount else outstanding_interest end,
    updated_at=now(),updated_by=auth.uid()
  where id=loan.id;
  if p_component='penalty' and p_source_record_id is not null then
    update public.mf_penalties set amount_waived=amount_waived+p_amount,
      status=case when amount_paid+amount_waived+p_amount>=amount then 'waived' else status end
    where id=p_source_record_id and loan_id=loan.id;
  end if;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value,reason)
  values(loan.organization_id,auth.uid(),'waiver_approved','mf_waivers',result,jsonb_build_object('component',p_component,'amount',p_amount),p_reason);
  return result;
end $$;

create or replace function public.mf_calculate_provisions(p_organization_id uuid, p_calculation_date date default current_date)
returns integer language plpgsql security definer set search_path=public as $$
declare affected integer;
begin
  if not public.mf_can_manage_sensitive(p_organization_id) then raise exception 'Access denied'; end if;
  insert into public.mf_provisions(
    organization_id,loan_id,calculation_date,classification,outstanding_principal,
    provision_rate,required_provision,existing_provision,shortfall_or_excess,created_by
  )
  select l.organization_id,l.id,p_calculation_date,coalesce(rule.name,'Current'),l.outstanding_principal,
    coalesce(rule.provision_rate,0),round(l.outstanding_principal*coalesce(rule.provision_rate,0)/100,2),
    coalesce(previous.required_provision,0),
    round(l.outstanding_principal*coalesce(rule.provision_rate,0)/100,2)-coalesce(previous.required_provision,0),auth.uid()
  from public.mf_loans l
  left join lateral (
    select r.* from public.mf_classification_rules r
    where r.organization_id=l.organization_id and r.is_active
      and l.days_past_due>=r.min_days_past_due
      and (r.max_days_past_due is null or l.days_past_due<=r.max_days_past_due)
    order by r.min_days_past_due desc limit 1
  ) rule on true
  left join lateral (
    select p.required_provision from public.mf_provisions p
    where p.loan_id=l.id and p.calculation_date<p_calculation_date and p.status<>'reversed'
    order by p.calculation_date desc limit 1
  ) previous on true
  where l.organization_id=p_organization_id and l.status not in ('closed','written_off')
  on conflict(loan_id,calculation_date) do update set
    classification=excluded.classification,outstanding_principal=excluded.outstanding_principal,
    provision_rate=excluded.provision_rate,required_provision=excluded.required_provision,
    existing_provision=excluded.existing_provision,shortfall_or_excess=excluded.shortfall_or_excess;
  get diagnostics affected=row_count;

  update public.mf_loans l set classification=p.classification,updated_at=now()
  from public.mf_provisions p where p.loan_id=l.id and p.calculation_date=mf_calculate_provisions.p_calculation_date
    and p.organization_id=p_organization_id;
  return affected;
end $$;

create or replace function public.mf_restructure_loan(
  p_loan_id uuid, p_type text, p_reason text, p_new_terms jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare loan public.mf_loans%rowtype; current_version integer; result uuid;
begin
  select * into loan from public.mf_loans where id=p_loan_id for update;
  if loan.id is null or not public.mf_can_manage_sensitive(loan.organization_id) then raise exception 'Access denied'; end if;
  if loan.status in ('closed','written_off') then raise exception 'Loan cannot be restructured'; end if;
  select coalesce(max(schedule_version),1) into current_version from public.mf_repayment_schedules where loan_id=loan.id;
  insert into public.mf_restructures(
    organization_id,loan_id,restructure_type,reason,outstanding_principal,outstanding_interest,
    original_terms,new_terms,old_schedule_version,status,approved_by,approved_at,created_by
  ) values(
    loan.organization_id,loan.id,p_type,p_reason,loan.outstanding_principal,loan.outstanding_interest,
    jsonb_build_object('term',loan.term,'frequency',loan.repayment_frequency,'rate',loan.interest_rate,'first_repayment_date',loan.first_repayment_date),
    p_new_terms,current_version,'approved',auth.uid(),now(),auth.uid()
  ) returning id into result;
  update public.mf_loans set status='restructured',
    term=coalesce((p_new_terms->>'term')::integer,term),
    repayment_frequency=coalesce(p_new_terms->>'frequency',repayment_frequency),
    interest_rate=coalesce((p_new_terms->>'rate')::numeric,interest_rate),
    first_repayment_date=coalesce((p_new_terms->>'first_repayment_date')::date,first_repayment_date),
    updated_at=now(),updated_by=auth.uid()
  where id=loan.id;
  update public.mf_repayment_schedules set is_current=false where loan_id=loan.id and is_current=true;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,previous_value,new_value,reason)
  values(loan.organization_id,auth.uid(),'loan_restructured','mf_loans',loan.id,to_jsonb(loan),p_new_terms,p_reason);
  return result;
end $$;

create or replace function public.mf_writeoff_loan(p_loan_id uuid, p_writeoff_date date, p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare loan public.mf_loans%rowtype; result uuid;
begin
  select * into loan from public.mf_loans where id=p_loan_id for update;
  if loan.id is null or not public.mf_can_manage_sensitive(loan.organization_id) then raise exception 'Access denied'; end if;
  if loan.status in ('closed','written_off') then raise exception 'Loan cannot be written off'; end if;
  insert into public.mf_writeoffs(
    organization_id,loan_id,writeoff_date,principal_written_off,interest_written_off,
    fees_written_off,penalties_written_off,reason,status,approved_by,approved_at,created_by
  ) values(
    loan.organization_id,loan.id,p_writeoff_date,loan.outstanding_principal,loan.outstanding_interest,
    loan.outstanding_fees,loan.outstanding_penalties,p_reason,'approved',auth.uid(),now(),auth.uid()
  ) returning id into result;
  update public.mf_loans set status='written_off',updated_at=now(),updated_by=auth.uid() where id=loan.id;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value,reason)
  values(loan.organization_id,auth.uid(),'loan_written_off','mf_loans',loan.id,
    jsonb_build_object('principal',loan.outstanding_principal,'interest',loan.outstanding_interest),p_reason);
  return result;
end $$;

create or replace function public.mf_record_recovery(
  p_writeoff_id uuid,p_amount numeric,p_recovery_date date,p_payment_method text,p_external_reference text
) returns uuid language plpgsql security definer set search_path=public as $$
declare wo public.mf_writeoffs%rowtype; recovered numeric; result uuid;
begin
  select * into wo from public.mf_writeoffs where id=p_writeoff_id for update;
  if wo.id is null or not public.mf_can_manage_sensitive(wo.organization_id) then raise exception 'Access denied'; end if;
  select coalesce(sum(amount),0) into recovered from public.mf_recoveries where writeoff_id=wo.id;
  if p_amount<=0 or recovered+p_amount>wo.principal_written_off+wo.interest_written_off+wo.fees_written_off+wo.penalties_written_off
    then raise exception 'Invalid recovery amount'; end if;
  insert into public.mf_recoveries(organization_id,writeoff_id,loan_id,recovery_date,amount,payment_method,external_reference,received_by,created_by)
  values(wo.organization_id,wo.id,wo.loan_id,p_recovery_date,p_amount,p_payment_method,p_external_reference,auth.uid(),auth.uid())
  returning id into result;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,record_id,new_value)
  values(wo.organization_id,auth.uid(),'writeoff_recovery_recorded','mf_recoveries',result,jsonb_build_object('amount',p_amount));
  return result;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'mf_collection_followups','mf_penalties','mf_waivers','mf_interest_suspensions',
    'mf_classification_rules','mf_provisions','mf_restructures','mf_writeoffs','mf_recoveries'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists mf_org_select on public.%I',t);
    execute format('create policy mf_org_select on public.%I for select using (public.mf_is_org_user(organization_id))',t);
    execute format('drop policy if exists mf_org_insert on public.%I',t);
    execute format('create policy mf_org_insert on public.%I for insert with check (public.mf_is_org_user(organization_id))',t);
    execute format('drop policy if exists mf_org_update on public.%I',t);
    execute format('create policy mf_org_update on public.%I for update using (public.mf_is_org_user(organization_id)) with check (public.mf_is_org_user(organization_id))',t);
  end loop;
end $$;

grant select,insert,update on public.mf_collection_followups,public.mf_penalties,public.mf_waivers,
  public.mf_interest_suspensions,public.mf_classification_rules,public.mf_provisions,
  public.mf_restructures,public.mf_writeoffs,public.mf_recoveries to authenticated;
grant execute on function public.mf_refresh_arrears(uuid,date),public.mf_suspend_interest(uuid,text,boolean),
  public.mf_resume_interest(uuid,text),public.mf_apply_waiver(uuid,text,numeric,text,uuid),
  public.mf_calculate_provisions(uuid,date),public.mf_restructure_loan(uuid,text,text,jsonb),
  public.mf_writeoff_loan(uuid,date,text),public.mf_record_recovery(uuid,numeric,date,text,text) to authenticated;
