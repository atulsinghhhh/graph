-- ============================================================
-- AI Incident Investigation Platform — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- organizations
CREATE TABLE IF NOT EXISTS public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- org_members
CREATE TABLE IF NOT EXISTS public.org_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

-- integrations
CREATE TABLE IF NOT EXISTS public.integrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('github', 'jira', 'datadog')),
  access_token     text,
  refresh_token    text,
  token_expires_at timestamptz,
  extra_data       jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  last_synced_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

-- sync_jobs
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  items_synced  int NOT NULL DEFAULT 0,
  error_message text,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- chat_messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL,
  role         text NOT NULL CHECK (role IN ('user', 'assistant')),
  content      text NOT NULL,
  sources      jsonb NOT NULL DEFAULT '[]',
  cypher_query text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.organizations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages  ENABLE ROW LEVEL SECURITY;

-- Helper: return the calling user's org_id (used in RLS policies)
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() LIMIT 1;
$$;

-- organizations: members can view their org
CREATE POLICY "organizations_select" ON public.organizations
  FOR SELECT USING (id = public.current_user_org_id());

-- org_members: view own org; self-insert only
CREATE POLICY "org_members_select" ON public.org_members
  FOR SELECT USING (org_id = public.current_user_org_id());

CREATE POLICY "org_members_insert" ON public.org_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- integrations: org members can read and manage
CREATE POLICY "integrations_select" ON public.integrations
  FOR SELECT USING (org_id = public.current_user_org_id());

CREATE POLICY "integrations_insert" ON public.integrations
  FOR INSERT WITH CHECK (org_id = public.current_user_org_id());

CREATE POLICY "integrations_update" ON public.integrations
  FOR UPDATE USING (org_id = public.current_user_org_id());

-- sync_jobs: org members can view and create
CREATE POLICY "sync_jobs_select" ON public.sync_jobs
  FOR SELECT USING (org_id = public.current_user_org_id());

CREATE POLICY "sync_jobs_insert" ON public.sync_jobs
  FOR INSERT WITH CHECK (org_id = public.current_user_org_id());

-- chat_messages: org members see their org's chat
CREATE POLICY "chat_messages_select" ON public.chat_messages
  FOR SELECT USING (org_id = public.current_user_org_id());

CREATE POLICY "chat_messages_insert" ON public.chat_messages
  FOR INSERT WITH CHECK (
    org_id = public.current_user_org_id()
    AND user_id = auth.uid()
  );
