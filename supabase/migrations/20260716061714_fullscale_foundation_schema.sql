-- InnoPulse Full-Scale foundation (fs_ prefix keeps corporate tables isolated
-- from MeetBook/Prisma tables and the free-assessment tables in this shared DB)

create table if not exists public.fs_orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text, size text, region text,
  created_at timestamptz not null default now()
);

create table if not exists public.fs_memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.fs_orgs(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner','manager','analyst','viewer','action_owner')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists fs_memberships_user_idx on public.fs_memberships(user_id);

create table if not exists public.fs_questionnaire_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  label text,
  definition jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fs_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.fs_orgs(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','open','closed')),
  questionnaire_version_id uuid not null references public.fs_questionnaire_versions(id),
  opens_at timestamptz, closes_at timestamptz,
  anonymity_threshold int not null default 5,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists fs_campaigns_org_idx on public.fs_campaigns(org_id);

create table if not exists public.fs_groups (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  type text not null check (type in ('executive','employee','customer','partner')),
  label text not null,
  target_n int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists fs_groups_campaign_idx on public.fs_groups(campaign_id);

create table if not exists public.fs_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  group_id uuid not null references public.fs_groups(id) on delete cascade,
  token text not null unique,
  mode text not null default 'group' check (mode in ('group','unique')),
  max_uses int, used_count int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists fs_links_campaign_idx on public.fs_links(campaign_id);

create table if not exists public.fs_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  group_id uuid not null references public.fs_groups(id),
  link_id uuid references public.fs_links(id),
  questionnaire_version_id uuid not null references public.fs_questionnaire_versions(id),
  submitted_at timestamptz not null default now(),
  valid boolean not null default true,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists fs_responses_campaign_idx on public.fs_responses(campaign_id, group_id);

create table if not exists public.fs_answers (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.fs_responses(id) on delete cascade,
  question_key text not null,
  choice text not null,
  value numeric,
  not_scored boolean not null default false
);
create index if not exists fs_answers_response_idx on public.fs_answers(response_id);
create index if not exists fs_answers_qkey_idx on public.fs_answers(question_key);

create table if not exists public.fs_comments (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.fs_responses(id) on delete cascade,
  pillar text,
  body text not null
);

create table if not exists public.fs_consents (
  id bigint generated always as identity primary key,
  response_id uuid not null references public.fs_responses(id) on delete cascade,
  consented boolean not null,
  policy_version text,
  at timestamptz not null default now()
);

create table if not exists public.fs_audit (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor uuid,
  action text not null,
  entity text, entity_id text,
  at timestamptz not null default now()
);

-- ---- helpers (security definer bypasses RLS internally; safe, read-only checks)
create or replace function public.fs_is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fs_memberships m where m.org_id = p_org and m.user_id = auth.uid());
$$;

create or replace function public.fs_role_in(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fs_memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles));
$$;

-- ---- RLS
alter table public.fs_orgs enable row level security;
alter table public.fs_memberships enable row level security;
alter table public.fs_questionnaire_versions enable row level security;
alter table public.fs_campaigns enable row level security;
alter table public.fs_groups enable row level security;
alter table public.fs_links enable row level security;
alter table public.fs_responses enable row level security;
alter table public.fs_answers enable row level security;
alter table public.fs_comments enable row level security;
alter table public.fs_consents enable row level security;
alter table public.fs_audit enable row level security;

create policy fs_orgs_select on public.fs_orgs for select to authenticated
  using (public.fs_is_member(id));
create policy fs_orgs_update on public.fs_orgs for update to authenticated
  using (public.fs_role_in(id, array['owner'])) with check (public.fs_role_in(id, array['owner']));

create policy fs_memberships_select on public.fs_memberships for select to authenticated
  using (public.fs_is_member(org_id));
create policy fs_memberships_write on public.fs_memberships for all to authenticated
  using (public.fs_role_in(org_id, array['owner']))
  with check (public.fs_role_in(org_id, array['owner']));

create policy fs_qv_select on public.fs_questionnaire_versions for select to authenticated using (true);

create policy fs_campaigns_select on public.fs_campaigns for select to authenticated
  using (public.fs_is_member(org_id));
create policy fs_campaigns_insert on public.fs_campaigns for insert to authenticated
  with check (public.fs_role_in(org_id, array['owner','manager']));
create policy fs_campaigns_update on public.fs_campaigns for update to authenticated
  using (public.fs_role_in(org_id, array['owner','manager']))
  with check (public.fs_role_in(org_id, array['owner','manager']));
create policy fs_campaigns_delete on public.fs_campaigns for delete to authenticated
  using (public.fs_role_in(org_id, array['owner']));

create policy fs_groups_select on public.fs_groups for select to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_is_member(c.org_id)));
create policy fs_groups_write on public.fs_groups for all to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager'])))
  with check (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager'])));

create policy fs_links_select on public.fs_links for select to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_is_member(c.org_id)));
create policy fs_links_write on public.fs_links for all to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager'])))
  with check (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager'])));

-- Raw responses/answers: restricted to owner/manager/analyst; no client writes (service role only)
create policy fs_responses_select on public.fs_responses for select to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])));
create policy fs_responses_update on public.fs_responses for update to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager'])))
  with check (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager'])));

create policy fs_answers_select on public.fs_answers for select to authenticated
  using (exists (select 1 from public.fs_responses r join public.fs_campaigns c on c.id = r.campaign_id
                 where r.id = response_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])));

create policy fs_comments_select on public.fs_comments for select to authenticated
  using (exists (select 1 from public.fs_responses r join public.fs_campaigns c on c.id = r.campaign_id
                 where r.id = response_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])));

create policy fs_consents_select on public.fs_consents for select to authenticated
  using (exists (select 1 from public.fs_responses r join public.fs_campaigns c on c.id = r.campaign_id
                 where r.id = response_id and public.fs_role_in(c.org_id, array['owner','manager'])));

create policy fs_audit_select on public.fs_audit for select to authenticated
  using (org_id is not null and public.fs_role_in(org_id, array['owner','manager']));
create policy fs_audit_insert on public.fs_audit for insert to authenticated
  with check (org_id is not null and public.fs_is_member(org_id));;
