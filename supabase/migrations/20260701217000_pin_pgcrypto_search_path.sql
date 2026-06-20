-- Supabase installs pgcrypto functions in the `extensions` schema. PIN RPCs
-- use a restricted SECURITY DEFINER search path, so include that schema
-- explicitly for gen_salt() and crypt().

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER FUNCTION public.set_staff_pin_credential(uuid, uuid, text, text, boolean)
  SET search_path = public, extensions;

ALTER FUNCTION public.consume_staff_pin_login(text, text)
  SET search_path = public, extensions;

ALTER FUNCTION public.verify_manager_pin(text, uuid)
  SET search_path = public, extensions;

ALTER FUNCTION public.set_my_manager_pin(text, uuid)
  SET search_path = public, extensions;
