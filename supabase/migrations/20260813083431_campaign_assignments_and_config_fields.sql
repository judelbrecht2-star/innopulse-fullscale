-- Phase 1 — the pieces a launch snapshot has to be able to record.

-- 1. Respondent confidentiality notice is campaign content and must be frozen
--    at launch: respondents were shown these exact words.
alter table public.fs_campaigns add column if not exists confidentiality_notice text;
comment on column public.fs_campaigns.confidentiality_notice is
  'The exact confidentiality wording shown to respondents. Frozen into the launch snapshot and immutable once the campaign opens.';

-- 2. The scoring rulebook a campaign was analysed under. Findings change over
--    time; a report must say which rulebook produced it.
alter table public.fs_campaign_governance add column if not exists scoring_rulebook text not null default 'fs-findings-v1';

-- 3. Campaign assignments — narrow, campaign-scoped capability. These do NOT
--    change anyone's organisation role; they name who is responsible for what
--    on one campaign, and the launch snapshot records them.
create table if not exists public.fs_campaign_assignments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  user_id uuid not null,
  assignment text not null check (assignment in
    ('executive_sponsor','campaign_owner','assigned_analyst','report_approver','intervention_owner')),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (campaign_id, user_id, assignment)
);

comment on table public.fs_campaign_assignments is
  'Campaign-scoped responsibility. Grants only the narrow capability needed for that campaign and never elevates an organisation role.';

create index if not exists fs_campaign_assignments_campaign_idx on public.fs_campaign_assignments (campaign_id);
create index if not exists fs_campaign_assignments_user_idx on public.fs_campaign_assignments (user_id);

alter table public.fs_campaign_assignments enable row level security;

drop policy if exists fs_campaign_assignments_read on public.fs_campaign_assignments;
create policy fs_campaign_assignments_read on public.fs_campaign_assignments for select
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_is_member(c.org_id)));

drop policy if exists fs_campaign_assignments_write on public.fs_campaign_assignments;
create policy fs_campaign_assignments_write on public.fs_campaign_assignments for all
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager'])))
  with check (exists (
    select 1 from fs_campaigns c
     where c.id = campaign_id
       and fs_role_in(c.org_id, array['owner','manager'])
       -- an assignee must already be a member of the owning organisation
       and exists (select 1 from fs_memberships m where m.org_id = c.org_id and m.user_id = fs_campaign_assignments.user_id)
  ));

-- An assignment may not be added to a campaign that has already launched:
-- the launch snapshot recorded who was responsible.
create or replace function public.fs_campaign_assignments_guard()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_status text;
begin
  select status into v_status from fs_campaigns
   where id = coalesce(new.campaign_id, old.campaign_id);
  if v_status is distinct from 'draft' and coalesce(current_setting('fs.lifecycle', true), '') <> 'on' then
    raise exception 'Campaign assignments are frozen once a campaign opens. Use a revised campaign draft to change them.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists fs_campaign_assignments_guard_biud on public.fs_campaign_assignments;
create trigger fs_campaign_assignments_guard_biud
  before insert or update or delete on public.fs_campaign_assignments
  for each row execute function public.fs_campaign_assignments_guard();

revoke all on function public.fs_campaign_assignments_guard() from public, anon, authenticated;;
