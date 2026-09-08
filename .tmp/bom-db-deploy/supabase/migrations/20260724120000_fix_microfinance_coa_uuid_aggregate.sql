-- Compatibility repair for an already-deployed seed function that used
-- max(uuid), which PostgreSQL does not provide by default.
create or replace function public.mf_uuid_max(state uuid, value uuid)
returns uuid
language sql
immutable
as $$
  select case
    when state is null then value
    when value is null then state
    when state::text >= value::text then state
    else value
  end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'max'
      and p.prokind = 'a'
      and pg_get_function_identity_arguments(p.oid) = 'uuid'
  ) then
    create aggregate public.max(uuid) (
      sfunc = public.mf_uuid_max,
      stype = uuid
    );
  end if;
end $$;
