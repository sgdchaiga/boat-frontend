-- Outbound/inbound messaging audit for boat-server (Prisma model: NotificationMessage).

CREATE TABLE IF NOT EXISTS public.notification_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  "to" text NOT NULL,
  provider text NOT NULL,
  provider_message_id text NOT NULL UNIQUE,
  status text NOT NULL,
  template_id text,
  text text,
  variables jsonb,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  updated_at timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_messages_organization_id_created_at_idx
  ON public.notification_messages (organization_id, created_at);

CREATE INDEX IF NOT EXISTS notification_messages_provider_provider_message_id_idx
  ON public.notification_messages (provider, provider_message_id);
