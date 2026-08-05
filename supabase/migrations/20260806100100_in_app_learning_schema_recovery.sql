-- Schema-only recovery for the BOAT in-app learning module.
-- Run this before 20260806100500_in_app_learning_seed_recovery.sql when the
-- original foundation migration rolled back before creating its tables.

CREATE TABLE IF NOT EXISTS public.help_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  module_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  short_description text NOT NULL,
  instructions jsonb NOT NULL DEFAULT '[]'::jsonb,
  common_mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_guidance jsonb NOT NULL DEFAULT '[]'::jsonb,
  troubleshooting jsonb NOT NULL DEFAULT '[]'::jsonb,
  media_url text,
  media_type text CHECK (media_type IS NULL OR media_type IN ('gif', 'mp4', 'web')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (organization_id, page_key, version)
);

CREATE TABLE IF NOT EXISTS public.help_tooltips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  field_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  term text NOT NULL,
  explanation text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id, page_key, field_key)
);

CREATE TABLE IF NOT EXISTS public.guided_tours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id, page_key, version)
);

CREATE TABLE IF NOT EXISTS public.guided_tour_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id uuid NOT NULL REFERENCES public.guided_tours(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  target_selector text,
  title text NOT NULL,
  body text NOT NULL,
  placement text NOT NULL DEFAULT 'auto'
    CHECK (placement IN ('auto', 'top', 'right', 'bottom', 'left')),
  UNIQUE (tour_id, step_order)
);

CREATE TABLE IF NOT EXISTS public.training_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  page_key text NOT NULL,
  role_keys text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  instructions text NOT NULL,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  task_order integer NOT NULL DEFAULT 1,
  points integer NOT NULL DEFAULT 10 CHECK (points >= 0),
  is_active boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (organization_id, module_key, page_key, title)
);

CREATE TABLE IF NOT EXISTS public.user_training_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_type text NOT NULL
    CHECK (content_type IN ('introduction', 'tour', 'task', 'article')),
  content_key text NOT NULL,
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'completed', 'dismissed')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, content_type, content_key)
);

CREATE INDEX IF NOT EXISTS help_articles_lookup_idx
  ON public.help_articles(module_key, page_key, is_active);
CREATE INDEX IF NOT EXISTS help_tooltips_lookup_idx
  ON public.help_tooltips(page_key, field_key, is_active);
CREATE INDEX IF NOT EXISTS training_progress_user_idx
  ON public.user_training_progress(user_id, organization_id, status);

