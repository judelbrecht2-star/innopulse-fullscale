create table if not exists public.fs_actions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  pillar text not null,
  intervention_id uuid references public.fs_interventions(id),
  action_index int,
  title text not null,
  status text not null default 'not_started' check (status in ('not_started','in_progress','done')),
  owner text,
  is_milestone boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fs_actions_unique_src
  on public.fs_actions (campaign_id, intervention_id, action_index)
  where intervention_id is not null and action_index is not null;
create index if not exists fs_actions_campaign_idx on public.fs_actions(campaign_id);

alter table public.fs_actions enable row level security;
create policy fs_actions_select on public.fs_actions for select to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_is_member(c.org_id)));
create policy fs_actions_write on public.fs_actions for all to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])))
  with check (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])));;
