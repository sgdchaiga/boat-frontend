-- Platform toggle for Agent Hub visibility per organization.
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS enable_agent boolean NOT NULL DEFAULT true;
