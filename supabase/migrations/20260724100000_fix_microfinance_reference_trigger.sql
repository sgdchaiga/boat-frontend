-- A trigger RECORD only exposes columns present on its source table. Referencing
-- NEW.borrower_number in a compound condition for mf_loan_applications raises:
-- record "new" has no field "borrower_number".
create or replace function public.mf_assign_reference()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  prefix text;
  seq bigint;
begin
  if tg_table_name = 'mf_borrowers' then
    if new.borrower_number is not null then return new; end if;
    prefix := 'BRW';
  elsif tg_table_name = 'mf_loan_applications' then
    if new.application_number is not null then return new; end if;
    prefix := 'APP';
  elsif tg_table_name = 'mf_loans' then
    if new.loan_number is not null then return new; end if;
    prefix := 'LN';
  else
    return new;
  end if;

  -- Serialize numbering per organization/table/year to avoid duplicate numbers
  -- when two records are created at the same time.
  perform pg_advisory_xact_lock(
    hashtextextended(
      new.organization_id::text || ':' || tg_table_name || ':' ||
      extract(year from current_date)::text,
      0
    )
  );

  select count(*) + 1
    into seq
    from public.mf_audit_log
   where organization_id = new.organization_id
     and record_type = tg_table_name;

  if tg_table_name = 'mf_borrowers' then
    new.borrower_number := 'BRW-' || to_char(current_date, 'YYYY') || '-' || lpad(seq::text, 6, '0');
  elsif tg_table_name = 'mf_loan_applications' then
    new.application_number := 'APP-' || to_char(current_date, 'YYYY') || '-' || lpad(seq::text, 6, '0');
  elsif tg_table_name = 'mf_loans' then
    new.loan_number := 'LN-' || to_char(current_date, 'YYYY') || '-' || lpad(seq::text, 6, '0');
  end if;

  insert into public.mf_audit_log(
    organization_id, user_id, action, record_type, new_value
  )
  values (
    new.organization_id, auth.uid(), 'reference_assigned', tg_table_name, to_jsonb(new)
  );

  return new;
end
$$;
