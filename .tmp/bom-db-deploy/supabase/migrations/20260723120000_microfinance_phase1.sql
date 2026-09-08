-- BOAT Microfinance Phase 1. Deliberately separate from SACCO tables.
create extension if not exists pgcrypto;

alter table public.organizations drop constraint if exists organizations_business_type_check;
-- Business types are centrally managed in public.business_types. Do not replace
-- that extensible catalogue with a hard-coded CHECK: existing/custom BOAT
-- organization types must remain valid.

create or replace function public.mf_is_org_user(target_org uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.staff s
    where s.id = auth.uid() and s.organization_id = target_org
  ) or exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.organization_id = target_org
  );
$$;

create table if not exists public.mf_borrowers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  borrower_number text,
  borrower_type text not null check (borrower_type in ('individual','group','business','payroll')),
  full_name text not null,
  gender text, date_of_birth date, national_id text, registration_number text,
  phone text not null, alternative_phone text, email text, physical_address text,
  occupation text, employer text, business_activity text, estimated_income numeric(18,2) not null default 0,
  loan_officer_id uuid references public.staff(id), branch text, group_or_centre text,
  next_of_kin jsonb not null default '{}'::jsonb, photo_url text, risk_rating text,
  status text not null default 'prospect' check (status in ('prospect','active','inactive','blacklisted','deceased')),
  notes text, external_reference text, record_version integer not null default 1,
  sync_status text not null default 'local', source_system text not null default 'boat',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  unique (organization_id, borrower_number),
  unique (organization_id, external_reference)
);
create unique index if not exists mf_borrowers_nin_unique on public.mf_borrowers(organization_id, lower(national_id)) where national_id is not null and national_id <> '';
create index if not exists mf_borrowers_phone_idx on public.mf_borrowers(organization_id, phone);

create table if not exists public.mf_groups (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  group_number text, name text not null, centre text, loan_officer_id uuid references public.staff(id), status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  unique(organization_id, group_number)
);
create table if not exists public.mf_group_members (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  group_id uuid not null references public.mf_groups(id) on delete restrict, borrower_id uuid not null references public.mf_borrowers(id) on delete restrict,
  joined_at date not null default current_date, left_at date, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  unique(group_id, borrower_id)
);
create table if not exists public.mf_guarantors (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  borrower_id uuid references public.mf_borrowers(id) on delete restrict, full_name text not null, national_id text, phone text not null,
  address text, relationship text, estimated_income numeric(18,2), consented_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table if not exists public.mf_collateral (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  borrower_id uuid not null references public.mf_borrowers(id) on delete restrict, collateral_type text not null, description text not null,
  estimated_value numeric(18,2) not null default 0, ownership_details text, document_url text, status text not null default 'proposed',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);

create table if not exists public.mf_loan_products (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null, name text not null, description text, min_principal numeric(18,2) not null check(min_principal >= 0),
  max_principal numeric(18,2) not null check(max_principal >= min_principal), min_term integer not null check(min_term > 0),
  max_term integer not null check(max_term >= min_term), term_unit text not null default 'months',
  repayment_frequency text not null check(repayment_frequency in ('daily','weekly','fortnightly','monthly','quarterly','custom')),
  interest_method text not null check(interest_method in ('flat','declining')), interest_rate numeric(12,6) not null check(interest_rate >= 0),
  rate_basis text not null check(rate_basis in ('annual','monthly','weekly','per_term')),
  installment_method text not null default 'equal_total' check(installment_method in ('equal_total','equal_principal')),
  grace_period integer not null default 0, interest_suspension_days integer,
  penalty_policy jsonb not null default '{}'::jsonb, provisioning_policy jsonb not null default '{}'::jsonb,
  appraisal_thresholds jsonb not null default '{}'::jsonb, allocation_order jsonb not null default '["penalties","fees","overdue_interest","current_interest","principal"]'::jsonb,
  required_guarantors integer not null default 0, collateral_required boolean not null default false,
  approval_limits jsonb not null default '{}'::jsonb, gl_mappings jsonb not null default '{}'::jsonb, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  unique(organization_id, code)
);
create table if not exists public.mf_product_charges (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_product_id uuid not null references public.mf_loan_products(id) on delete restrict, name text not null,
  charge_type text not null check(charge_type in ('fixed','percentage')), amount numeric(18,4) not null check(amount >= 0),
  treatment text not null check(treatment in ('paid_separately','deducted','financed')), gl_account_id uuid references public.gl_accounts(id),
  is_active boolean not null default true, created_at timestamptz not null default now(), created_by uuid references auth.users(id)
);

create table if not exists public.mf_loan_applications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  application_number text, borrower_id uuid not null references public.mf_borrowers(id) on delete restrict,
  loan_product_id uuid not null references public.mf_loan_products(id) on delete restrict,
  amount_requested numeric(18,2) not null check(amount_requested > 0), proposed_term integer not null check(proposed_term > 0),
  repayment_frequency text not null, purpose text not null, proposed_first_repayment_date date not null,
  monthly_income numeric(18,2) default 0, monthly_expenses numeric(18,2) default 0, existing_debt numeric(18,2) default 0,
  loan_officer_id uuid references public.staff(id), application_date date not null default current_date, documents jsonb not null default '[]'::jsonb,
  declaration_accepted boolean not null default false, notes text, indicative_installment numeric(18,2), indicative_interest numeric(18,2),
  indicative_fees numeric(18,2) not null default 0, indicative_net_disbursement numeric(18,2),
  status text not null default 'draft' check(status in ('draft','submitted','under_appraisal','recommended','approved','rejected','ready_for_disbursement','disbursed')),
  submitted_by uuid references auth.users(id), submitted_at timestamptz, external_reference text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  unique(organization_id, application_number), unique(organization_id, external_reference)
);
create table if not exists public.mf_loan_appraisals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  application_id uuid not null references public.mf_loan_applications(id) on delete restrict,
  income numeric(18,2) not null default 0, business_expenses numeric(18,2) not null default 0, household_expenses numeric(18,2) not null default 0,
  existing_obligations numeric(18,2) not null default 0, disposable_income numeric(18,2) not null default 0,
  proposed_installment numeric(18,2) not null default 0, debt_service_ratio numeric(12,4), collateral_value numeric(18,2),
  loan_to_value_ratio numeric(12,4), guarantor_coverage numeric(18,2), credit_history text, repayment_capacity text,
  risk_score numeric(12,4), amount_recommended numeric(18,2), term_recommended integer, conclusion text,
  override_reason text, appraising_officer uuid references public.staff(id), appraisal_date date not null default current_date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id)
);
create table if not exists public.mf_loan_approvals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  application_id uuid not null references public.mf_loan_applications(id) on delete restrict, decision text not null check(decision in ('approved','rejected')),
  amount_approved numeric(18,2), approved_rate numeric(12,6), approved_term integer, approval_conditions text, remarks text, rejection_reason text,
  approved_by uuid not null references auth.users(id), approval_date timestamptz not null default now(), created_at timestamptz not null default now(),
  check ((decision='approved' and amount_approved > 0) or decision='rejected')
);

create table if not exists public.mf_loans (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_number text, application_id uuid not null unique references public.mf_loan_applications(id) on delete restrict,
  borrower_id uuid not null references public.mf_borrowers(id) on delete restrict, loan_product_id uuid not null references public.mf_loan_products(id) on delete restrict,
  principal numeric(18,2) not null check(principal > 0), financed_charges numeric(18,2) not null default 0, gross_balance numeric(18,2) not null,
  outstanding_principal numeric(18,2) not null check(outstanding_principal >= 0), outstanding_interest numeric(18,2) not null default 0,
  outstanding_fees numeric(18,2) not null default 0, outstanding_penalties numeric(18,2) not null default 0,
  interest_method text not null, interest_rate numeric(12,6) not null, rate_basis text not null, installment_method text not null,
  term integer not null, repayment_frequency text not null, first_repayment_date date not null, disbursement_date date,
  status text not null default 'approved' check(status in ('approved','ready_for_disbursement','disbursed','active','in_arrears','non_performing','restructured','closed','written_off')),
  days_past_due integer not null default 0, classification text not null default 'current', interest_suspended boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references auth.users(id), updated_by uuid references auth.users(id),
  unique(organization_id, loan_number)
);
create table if not exists public.mf_disbursements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict, disbursement_reference text not null,
  amount numeric(18,2) not null check(amount > 0), charges_deducted numeric(18,2) not null default 0, charges_paid_separately numeric(18,2) not null default 0,
  charges_financed numeric(18,2) not null default 0, net_amount numeric(18,2) not null, method text not null check(method in ('cash','bank','mobile_money','cheque','transfer')),
  transaction_reference text, disbursed_at timestamptz not null default now(), disbursed_by uuid not null references auth.users(id),
  journal_entry_id uuid references public.journal_entries(id), created_at timestamptz not null default now(),
  unique(organization_id, disbursement_reference)
);
create table if not exists public.mf_repayment_schedules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict, schedule_version integer not null default 1,
  installment_number integer not null, due_date date not null, opening_principal numeric(18,2) not null,
  scheduled_principal numeric(18,2) not null, scheduled_interest numeric(18,2) not null, scheduled_fees numeric(18,2) not null default 0,
  insurance numeric(18,2) not null default 0, total_installment numeric(18,2) not null, amount_paid numeric(18,2) not null default 0,
  principal_paid numeric(18,2) not null default 0, interest_paid numeric(18,2) not null default 0, charges_paid numeric(18,2) not null default 0,
  penalties_paid numeric(18,2) not null default 0, outstanding_amount numeric(18,2) not null, days_past_due integer not null default 0,
  status text not null default 'pending', is_current boolean not null default true, created_at timestamptz not null default now(),
  unique(loan_id, schedule_version, installment_number)
);
create table if not exists public.mf_repayments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  loan_id uuid not null references public.mf_loans(id) on delete restrict, receipt_number text, external_reference text not null,
  amount numeric(18,2) not null check(amount > 0), payment_date date not null, payment_method text not null check(payment_method in ('cash','bank','mobile_money','cheque','transfer')),
  status text not null default 'pending_posting' check(status in ('pending_posting','posted','reversed')),
  reversal_of uuid references public.mf_repayments(id), reversal_reason text, journal_entry_id uuid references public.journal_entries(id),
  posted_by uuid references auth.users(id), posted_at timestamptz, created_at timestamptz not null default now(), created_by uuid references auth.users(id),
  unique(organization_id, receipt_number), unique(organization_id, external_reference)
);
create table if not exists public.mf_repayment_allocations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  repayment_id uuid not null references public.mf_repayments(id) on delete restrict, schedule_id uuid references public.mf_repayment_schedules(id) on delete restrict,
  component text not null check(component in ('penalty','fee','interest','principal','overpayment')), amount numeric(18,2) not null check(amount > 0),
  created_at timestamptz not null default now(), created_by uuid references auth.users(id)
);

create table if not exists public.mf_audit_log (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid references auth.users(id), action text not null, record_type text not null, record_id uuid,
  previous_value jsonb, new_value jsonb, reason text, session_info jsonb, created_at timestamptz not null default now()
);

create or replace function public.mf_assign_reference()
returns trigger language plpgsql security definer set search_path=public as $$
declare prefix text; seq bigint;
begin
  if tg_table_name='mf_borrowers' then
    if new.borrower_number is not null then return new; end if;
    prefix := 'BRW';
  elsif tg_table_name='mf_loan_applications' then
    if new.application_number is not null then return new; end if;
    prefix := 'APP';
  elsif tg_table_name='mf_loans' then
    if new.loan_number is not null then return new; end if;
    prefix := 'LN';
  else
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text||':'||tg_table_name||':'||extract(year from current_date)::text, 0));
  select count(*)+1 into seq from public.mf_audit_log where organization_id=new.organization_id and record_type=tg_table_name;
  if tg_table_name='mf_borrowers' then new.borrower_number := prefix||'-'||to_char(current_date,'YYYY')||'-'||lpad(seq::text,6,'0'); end if;
  if tg_table_name='mf_loan_applications' then new.application_number := prefix||'-'||to_char(current_date,'YYYY')||'-'||lpad(seq::text,6,'0'); end if;
  if tg_table_name='mf_loans' then new.loan_number := prefix||'-'||to_char(current_date,'YYYY')||'-'||lpad(seq::text,6,'0'); end if;
  insert into public.mf_audit_log(organization_id,user_id,action,record_type,new_value) values(new.organization_id,auth.uid(),'reference_assigned',tg_table_name,to_jsonb(new));
  return new;
end $$;
drop trigger if exists mf_borrower_reference on public.mf_borrowers;
create trigger mf_borrower_reference before insert on public.mf_borrowers for each row execute function public.mf_assign_reference();
drop trigger if exists mf_application_reference on public.mf_loan_applications;
create trigger mf_application_reference before insert on public.mf_loan_applications for each row execute function public.mf_assign_reference();
drop trigger if exists mf_loan_reference on public.mf_loans;
create trigger mf_loan_reference before insert on public.mf_loans for each row execute function public.mf_assign_reference();

create or replace function public.mf_prevent_posted_repayment_changes()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status='posted' then raise exception 'Posted repayments are immutable; create an authorized reversal.'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists mf_repayment_immutable on public.mf_repayments;
create trigger mf_repayment_immutable before update or delete on public.mf_repayments for each row execute function public.mf_prevent_posted_repayment_changes();

do $$
declare t text;
begin
  foreach t in array array[
    'mf_borrowers','mf_groups','mf_group_members','mf_guarantors','mf_collateral','mf_loan_products',
    'mf_product_charges','mf_loan_applications','mf_loan_appraisals','mf_loan_approvals','mf_loans',
    'mf_disbursements','mf_repayment_schedules','mf_repayments','mf_repayment_allocations','mf_audit_log'
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

grant select,insert,update on public.mf_borrowers,public.mf_groups,public.mf_group_members,public.mf_guarantors,public.mf_collateral,
  public.mf_loan_products,public.mf_product_charges,public.mf_loan_applications,public.mf_loan_appraisals,public.mf_loan_approvals,
  public.mf_loans,public.mf_disbursements,public.mf_repayment_schedules,public.mf_repayments,public.mf_repayment_allocations to authenticated;
grant select on public.mf_audit_log to authenticated;
