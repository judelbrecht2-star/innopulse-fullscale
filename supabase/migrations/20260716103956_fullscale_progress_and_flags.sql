-- live in-progress tracking (anonymous: keyed by a random client ref, no identity)
create table if not exists public.fs_progress (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  group_id uuid not null references public.fs_groups(id) on delete cascade,
  link_id uuid not null references public.fs_links(id) on delete cascade,
  client_ref text not null,
  answered int not null default 0,
  total int not null default 0,
  started_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (link_id, client_ref)
);
create index if not exists fs_progress_campaign_idx on public.fs_progress(campaign_id);
alter table public.fs_progress enable row level security;
create policy fs_progress_select on public.fs_progress for select to authenticated
  using (exists (select 1 from public.fs_campaigns c where c.id = campaign_id and public.fs_is_member(c.org_id)));
-- writes are service-role only (the respond edge function)

-- data-quality / lifecycle flag on responses
alter table public.fs_responses add column if not exists flag text
  check (flag in ('review','test'));;
