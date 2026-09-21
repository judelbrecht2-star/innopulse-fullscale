-- ===========================================================================
-- Settings architecture, Phase 1 — three scopes, three tables.
--   fs_user_preferences     personal, per user
--   fs_org_settings         organisation defaults + governance policy
--   fs_campaign_governance  per-campaign values COPIED from org defaults
-- Existing campaigns are backfilled from their own current values so nothing
-- visible changes today. Launched campaigns are marked locked.
-- ===========================================================================

-- 1. PERSONAL -------------------------------------------------------------
create table if not exists fs_user_preferences (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  default_org_id       uuid references fs_orgs(id) on delete set null,
  display_name         text,
  timezone             text not null default 'Africa/Johannesburg',
  locale               text not null default 'en-ZA',
  date_format          text not null default 'yyyy-mm-dd',
  table_density        text not null default 'comfortable' check (table_density in ('comfortable','compact')),
  reduced_motion       boolean not null default false,
  default_landing_page text not null default '/dashboard',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter table fs_user_preferences enable row level security;
drop policy if exists fs_user_preferences_self on fs_user_preferences;
create policy fs_user_preferences_self on fs_user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 2. ORGANISATION ---------------------------------------------------------
create table if not exists fs_org_settings (
  org_id                          uuid primary key references fs_orgs(id) on delete cascade,
  short_name                      text,
  industry                        text,
  country                         text default 'ZA',
  timezone                        text not null default 'Africa/Johannesburg',
  locale                          text not null default 'en-ZA',
  support_email                   text,
  privacy_contact_email           text,
  programme_owner_user_id         uuid references auth.users(id) on delete set null,
  default_campaign_duration_days  int  not null default 30 check (default_campaign_duration_days between 1 and 365),
  -- Privacy defaults. Floor of 4 is a hard product rule (Judy's decision);
  -- the recommended default for new campaigns is 5.
  default_score_threshold         int  not null default 5  check (default_score_threshold >= 4),
  default_comment_threshold       int  not null default 10 check (default_comment_threshold >= 4),
  default_suppression_mode        text not null default 'basic' check (default_suppression_mode in ('basic','strong')),
  default_max_filter_dimensions   int  not null default 2 check (default_max_filter_dimensions between 1 and 3),
  default_questionnaire_version_id uuid references fs_questionnaire_versions(id),
  default_report_template         text,
  allow_raw_exports               boolean not null default false,
  require_launch_approval         boolean not null default true,
  require_report_approval         boolean not null default true,
  require_mfa_roles               text[]  not null default array['owner','manager','analyst'],
  session_policy                  jsonb   not null default '{}'::jsonb,
  retention_policy                jsonb   not null default jsonb_build_object(
                                    'invitation_contacts_days', 90,
                                    'incomplete_responses_days', 30,
                                    'completed_responses_months', 24,
                                    'enabled', false),
  branding                        jsonb   not null default '{}'::jsonb,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  updated_by                      uuid references auth.users(id)
);
alter table fs_org_settings enable row level security;
drop policy if exists fs_org_settings_read on fs_org_settings;
create policy fs_org_settings_read on fs_org_settings
  for select using (fs_is_member(org_id));
drop policy if exists fs_org_settings_write on fs_org_settings;
create policy fs_org_settings_write on fs_org_settings
  for update using (fs_role_in(org_id, array['owner'])) with check (fs_role_in(org_id, array['owner']));

-- 3. CAMPAIGN -------------------------------------------------------------
create table if not exists fs_campaign_governance (
  campaign_id              uuid primary key references fs_campaigns(id) on delete cascade,
  privacy_profile          text not null default 'standard'
                             check (privacy_profile in ('standard','high','small_population','custom','migrated')),
  score_threshold          int  not null check (score_threshold >= 4),
  comment_threshold        int  not null check (comment_threshold >= 4),
  suppression_mode         text not null default 'basic' check (suppression_mode in ('basic','strong')),
  max_filter_dimensions    int  not null default 2 check (max_filter_dimensions between 1 and 3),
  raw_export_policy        text not null default 'aggregate_only'
                             check (raw_export_policy in ('aggregate_only','approval_required','allowed')),
  distribution_mode        text not null default 'anonymous_group'
                             check (distribution_mode in ('anonymous_group','unique_invitation','invitation_only')),
  resume_window_days       int  not null default 14 check (resume_window_days between 0 and 90),
  launch_approval_required boolean not null default true,
  report_approval_required boolean not null default true,
  locked_at                timestamptz,
  locked_by                uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id)
);
alter table fs_campaign_governance enable row level security;
drop policy if exists fs_campaign_governance_read on fs_campaign_governance;
create policy fs_campaign_governance_read on fs_campaign_governance
  for select using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_is_member(c.org_id)));
-- Writes only while unlocked, and only for owner/manager. Locking is enforced
-- by the database, not by hiding controls in React.
drop policy if exists fs_campaign_governance_write on fs_campaign_governance;
create policy fs_campaign_governance_write on fs_campaign_governance
  for update using (
    locked_at is null
    and exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager']))
  ) with check (locked_at is null);

-- 4. CONFIG SNAPSHOTS -----------------------------------------------------
create table if not exists fs_campaign_config_snapshots (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references fs_campaigns(id) on delete cascade,
  version       int  not null,
  snapshot_type text not null check (snapshot_type in ('launch','report','manual','migrated')),
  config        jsonb not null,
  config_hash   text  not null,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  unique (campaign_id, version)
);
alter table fs_campaign_config_snapshots enable row level security;
drop policy if exists fs_campaign_snapshots_read on fs_campaign_config_snapshots;
create policy fs_campaign_snapshots_read on fs_campaign_config_snapshots
  for select using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_is_member(c.org_id)));
-- Append-only: no update or delete policy exists, so neither is permitted.

-- 5. BACKFILL -------------------------------------------------------------
insert into fs_org_settings (org_id)
select id from fs_orgs
on conflict (org_id) do nothing;

-- Existing campaigns keep exactly the behaviour they have today: the score
-- threshold is their current anonymity_threshold and the comment threshold
-- matches it (rather than the new default of 10, which would retroactively
-- hide comments that are visible now). Profile is labelled 'migrated' — we do
-- not claim historical certainty for values that were never stored.
insert into fs_campaign_governance (
  campaign_id, privacy_profile, score_threshold, comment_threshold,
  suppression_mode, max_filter_dimensions, locked_at)
select c.id,
       'migrated',
       greatest(coalesce(c.anonymity_threshold, 5), 4),
       greatest(coalesce(c.anonymity_threshold, 5), 4),
       'basic',
       2,
       case when c.status in ('open','closed','archived')
            then coalesce(c.opens_at, c.created_at) else null end
from fs_campaigns c
on conflict (campaign_id) do nothing;

comment on table fs_campaign_governance is
  'Per-campaign governance COPIED from fs_org_settings at creation. Never merged live against org settings afterwards — historical results must stay reproducible.';;
