-- Phase 1 — make the privacy floor a constraint, not a convention.
-- Until now the floor of 4 was applied by a trigger that silently clamped.
-- Clamping is right for a legacy write; a CHECK is right for the shape of the
-- data. Both now hold: the trigger corrects, the constraint guarantees.

alter table public.fs_org_settings
  drop constraint if exists fs_org_settings_score_floor,
  add constraint fs_org_settings_score_floor check (default_score_threshold >= 4);
alter table public.fs_org_settings
  drop constraint if exists fs_org_settings_comment_gte_score,
  add constraint fs_org_settings_comment_gte_score check (default_comment_threshold >= default_score_threshold);
alter table public.fs_org_settings
  drop constraint if exists fs_org_settings_filter_dims,
  add constraint fs_org_settings_filter_dims check (default_max_filter_dimensions between 1 and 8);
alter table public.fs_org_settings
  drop constraint if exists fs_org_settings_duration,
  add constraint fs_org_settings_duration check (default_campaign_duration_days between 1 and 365);
alter table public.fs_org_settings
  drop constraint if exists fs_org_settings_suppression_mode,
  add constraint fs_org_settings_suppression_mode check (default_suppression_mode in ('basic','strong'));

alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_score_floor,
  add constraint fs_campaign_governance_score_floor check (score_threshold >= 4);
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_comment_gte_score,
  add constraint fs_campaign_governance_comment_gte_score check (comment_threshold >= score_threshold);
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_filter_dims,
  add constraint fs_campaign_governance_filter_dims check (max_filter_dimensions between 1 and 8);
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_suppression_mode,
  add constraint fs_campaign_governance_suppression_mode check (suppression_mode in ('basic','strong'));
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_privacy_profile,
  add constraint fs_campaign_governance_privacy_profile
  check (privacy_profile in ('standard','high_sensitivity','small_population','custom','migrated'));
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_raw_export,
  add constraint fs_campaign_governance_raw_export check (raw_export_policy in ('aggregate_only','approval_required','allowed'));
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_distribution,
  add constraint fs_campaign_governance_distribution check (distribution_mode in ('anonymous_group','individual_invite','invitation_only'));

alter table public.fs_campaign_config_snapshots
  drop constraint if exists fs_campaign_config_snapshots_type,
  add constraint fs_campaign_config_snapshots_type check (snapshot_type in ('launch','report','manual'));

-- Personal preferences ---------------------------------------------------------
-- The table already existed but nothing created rows or kept updated_at honest.
create or replace function public.fs_user_preferences_ensure()
returns public.fs_user_preferences
language plpgsql security definer set search_path to 'public' as $$
declare v public.fs_user_preferences; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select * into v from fs_user_preferences where user_id = v_uid;
  if not found then
    insert into fs_user_preferences (user_id) values (v_uid) on conflict (user_id) do nothing;
    select * into v from fs_user_preferences where user_id = v_uid;
  end if;
  return v;
end $$;

revoke all on function public.fs_user_preferences_ensure() from public, anon;
grant execute on function public.fs_user_preferences_ensure() to authenticated, service_role;

create or replace function public.fs_user_preferences_touch()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.updated_at := now();
  new.user_id := old.user_id;  -- a preference row can never change owner
  -- default_org_id must be an org the user actually belongs to.
  if new.default_org_id is not null
     and not exists (select 1 from fs_memberships m where m.user_id = new.user_id and m.org_id = new.default_org_id) then
    raise exception 'You are not a member of that organisation';
  end if;
  if new.table_density is not null and new.table_density not in ('comfortable','compact') then
    raise exception 'table_density must be comfortable or compact';
  end if;
  return new;
end $$;

drop trigger if exists fs_user_preferences_touch_bu on public.fs_user_preferences;
create trigger fs_user_preferences_touch_bu before update on public.fs_user_preferences
  for each row execute function public.fs_user_preferences_touch();

revoke all on function public.fs_user_preferences_touch() from public, anon, authenticated;

comment on table public.fs_user_preferences is
  'Personal, cross-organisation preferences for one user. Never organisation policy — that lives in fs_org_settings. RLS: a user can only see and change their own row.';;
