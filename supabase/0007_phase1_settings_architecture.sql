-- 0007 — Settings architecture, Phase 1 (applied 2026-08-13)
--
-- Applied to project jydbinexjckfzjqgsmjf as six migrations, consolidated here
-- in dependency order. Each block is idempotent (create or replace / if not
-- exists / drop-then-create), so re-running the file is safe.
--
--   20260813083222  audit_spine_and_aal
--   20260813083311  settings_constraints_and_user_preferences
--   20260813083431  campaign_assignments_and_config_fields
--   20260813083512  campaign_snapshot_and_readiness
--   20260813083818  campaign_lifecycle_rpcs_and_locking
--   20260813083841  backfill_migrated_launch_snapshots
--   20260813083925  lock_guard_must_run_first
--
-- What this establishes:
--   * fs_audit records what changed, why, and at what authentication strength,
--     and can no longer be edited or deleted by anyone, including service_role.
--   * The anonymity floor of 4 is a CHECK constraint, not only a trigger clamp.
--   * Opening a campaign is one transaction that validates readiness, freezes an
--     immutable launch snapshot, locks governance and writes an audit record.
--   * Privacy-critical campaign settings are refused after launch, with an error
--     that tells the user to create a revised draft instead.
--   * Personal preferences live in fs_user_preferences, never in org settings.
--
-- NOT done in Phase 1, deliberately: complementary suppression (Phase 2),
-- hard AAL2 (Phase 3), notification outbox (Phase 4), report approvals and
-- retention execution (Phase 5).

-- =============================================================================
-- 1. Audit spine
-- =============================================================================

alter table public.fs_audit add column if not exists campaign_id uuid;
alter table public.fs_audit add column if not exists before_value jsonb;
alter table public.fs_audit add column if not exists after_value jsonb;
alter table public.fs_audit add column if not exists reason text;
alter table public.fs_audit add column if not exists correlation_id uuid;
alter table public.fs_audit add column if not exists actor_aal text;

create index if not exists fs_audit_org_at_idx on public.fs_audit (org_id, at desc);
create index if not exists fs_audit_campaign_idx on public.fs_audit (campaign_id) where campaign_id is not null;

comment on column public.fs_audit.before_value is
  'Redacted prior value. Never contains credentials, tokens, answers or comment bodies — fs_audit_redact() strips them.';
comment on column public.fs_audit.actor_aal is
  'Authenticator assurance level of the session that performed the action (aal1 / aal2), captured at write time.';

create or replace function public.fs_current_aal()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1');
$$;

-- Warn-mode AAL2. Hard-fails once the organisation has any verified TOTP factor,
-- or once fs_org_settings.session_policy->>'enforce_aal2' is 'true'. Until then
-- the action proceeds and the bypass is recorded, so the enforcement gap is
-- countable rather than silent. Hard-failing on day one would lock a sole owner
-- with no authenticator out of their own tenant.
create or replace function public.fs_require_aal2(p_org uuid, p_action text)
returns void language plpgsql security definer set search_path to 'public', 'auth' as $$
declare v_aal text; v_enforce boolean; v_has_factor boolean;
begin
  v_aal := fs_current_aal();
  if v_aal = 'aal2' then return; end if;

  select coalesce((session_policy ->> 'enforce_aal2')::boolean, false) into v_enforce
    from fs_org_settings where org_id = p_org;

  select exists (
    select 1 from auth.mfa_factors f
     join fs_memberships m on m.user_id = f.user_id
    where m.org_id = p_org and f.status = 'verified'
  ) into v_has_factor;

  if coalesce(v_enforce, false) or coalesce(v_has_factor, false) then
    raise exception 'This action requires two-factor authentication. Sign in again with your authenticator app, then retry.'
      using errcode = '42501';
  end if;

  insert into fs_audit (org_id, actor, action, entity, entity_id, actor_aal, reason)
  values (p_org, auth.uid(), 'security.aal2_bypassed:' || p_action, 'fs_org_settings', p_org::text, v_aal,
          'No verified authenticator exists in this organisation yet; AAL2 is in warn-mode.');
end $$;

-- A denylist applied to every audit write, whatever the caller passes.
create or replace function public.fs_audit_redact(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare k text; out_j jsonb; banned text[] := array[
  'password','new_password','current_password','secret','totp','totp_secret','mfa_secret',
  'token','tokens','access_token','refresh_token','api_key','apikey','authorization',
  'answers','answer','value','choice','comment','comments','body','verbatim','verbatims',
  'email_body','recovery_codes'
];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return p; end if;
  out_j := p;
  for k in select jsonb_object_keys(p) loop
    if lower(k) = any (banned) then
      out_j := jsonb_set(out_j, array[k], '"[redacted]"'::jsonb);
    elsif jsonb_typeof(p -> k) = 'object' then
      out_j := jsonb_set(out_j, array[k], fs_audit_redact(p -> k));
    end if;
  end loop;
  return out_j;
end $$;

create or replace function public.fs_audit_log(
  p_org uuid, p_action text, p_entity text, p_entity_id text,
  p_campaign uuid default null, p_before jsonb default null, p_after jsonb default null,
  p_reason text default null, p_correlation uuid default null
) returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  insert into fs_audit (org_id, actor, action, entity, entity_id, campaign_id,
                        before_value, after_value, reason, correlation_id, actor_aal)
  values (p_org, auth.uid(), p_action, p_entity, p_entity_id, p_campaign,
          fs_audit_redact(p_before), fs_audit_redact(p_after), nullif(trim(coalesce(p_reason,'')),''),
          coalesce(p_correlation, gen_random_uuid()), fs_current_aal())
  returning id into v_id;
  return v_id;
end $$;

-- Append-only. RLS grants no UPDATE/DELETE to client roles, but service_role and
-- SECURITY DEFINER functions bypass RLS. A trigger does not care who you are.
create or replace function public.fs_audit_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'fs_audit is append-only: % is not permitted on an audit record', tg_op
    using errcode = '42501';
end $$;

drop trigger if exists fs_audit_no_update on public.fs_audit;
create trigger fs_audit_no_update before update on public.fs_audit
  for each row execute function public.fs_audit_append_only();

drop trigger if exists fs_audit_no_delete on public.fs_audit;
create trigger fs_audit_no_delete before delete on public.fs_audit
  for each row execute function public.fs_audit_append_only();

create or replace function public.fs_audit_redact_on_insert()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.before_value := fs_audit_redact(new.before_value);
  new.after_value  := fs_audit_redact(new.after_value);
  new.actor_aal    := coalesce(new.actor_aal, fs_current_aal());
  new.correlation_id := coalesce(new.correlation_id, gen_random_uuid());
  return new;
end $$;

drop trigger if exists fs_audit_redact_bi on public.fs_audit;
create trigger fs_audit_redact_bi before insert on public.fs_audit
  for each row execute function public.fs_audit_redact_on_insert();

revoke all on function public.fs_audit_append_only() from public, anon, authenticated;
revoke all on function public.fs_audit_redact_on_insert() from public, anon, authenticated;
revoke all on function public.fs_audit_redact(jsonb) from public, anon, authenticated;
revoke all on function public.fs_audit_log(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid) from public, anon;
grant execute on function public.fs_audit_log(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid) to authenticated, service_role;
revoke all on function public.fs_current_aal() from public, anon;
grant execute on function public.fs_current_aal() to authenticated, service_role;
revoke all on function public.fs_require_aal2(uuid, text) from public, anon, authenticated;

-- =============================================================================
-- 2. Constraints and personal preferences
-- =============================================================================

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
  'Personal, cross-organisation preferences for one user. Never organisation policy — that lives in fs_org_settings. RLS: a user can only see and change their own row.';

-- =============================================================================
-- 3. Fields and tables the launch snapshot must be able to record
-- =============================================================================

alter table public.fs_campaigns add column if not exists confidentiality_notice text;
comment on column public.fs_campaigns.confidentiality_notice is
  'The exact confidentiality wording shown to respondents. Frozen into the launch snapshot and immutable once the campaign opens.';

alter table public.fs_campaign_governance add column if not exists scoring_rulebook text not null default 'fs-findings-v1';

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
       and exists (select 1 from fs_memberships m where m.org_id = c.org_id and m.user_id = fs_campaign_assignments.user_id)
  ));

create or replace function public.fs_campaign_assignments_guard()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_status text;
begin
  select status into v_status from fs_campaigns where id = coalesce(new.campaign_id, old.campaign_id);
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

revoke all on function public.fs_campaign_assignments_guard() from public, anon, authenticated;

-- =============================================================================
-- 4. The immutable analytical contract
-- =============================================================================

create or replace function public.fs_build_campaign_config(p_camp uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'schema_version', 1,
    'campaign', jsonb_build_object(
      'id', c.id, 'name', c.name, 'org_id', c.org_id,
      'opens_at', c.opens_at, 'closes_at', c.closes_at,
      'prior_campaign_id', c.prior_campaign_id, 'programme_id', c.programme_id,
      'client_context', c.client_context, 'engagement_objective', c.engagement_objective
    ),
    'questionnaire', jsonb_build_object(
      'version_id', c.questionnaire_version_id,
      'version', (select qv.version from fs_questionnaire_versions qv where qv.id = c.questionnaire_version_id),
      'label', (select qv.label from fs_questionnaire_versions qv where qv.id = c.questionnaire_version_id)
    ),
    'scoring', jsonb_build_object('rulebook', g.scoring_rulebook),
    'privacy', jsonb_build_object(
      'privacy_profile', g.privacy_profile,
      'score_threshold', g.score_threshold,
      'comment_threshold', g.comment_threshold,
      'suppression_mode', g.suppression_mode,
      'max_filter_dimensions', g.max_filter_dimensions,
      'raw_export_policy', g.raw_export_policy
    ),
    'distribution', jsonb_build_object(
      'distribution_mode', g.distribution_mode,
      'resume_window_days', g.resume_window_days
    ),
    'approvals', jsonb_build_object(
      'launch_approval_required', g.launch_approval_required,
      'report_approval_required', g.report_approval_required
    ),
    'respondent', jsonb_build_object(
      'confidentiality_notice', c.confidentiality_notice,
      'thankyou_message', c.thankyou_message,
      'closed_message', c.closed_message
    ),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', gr.id, 'type', gr.type, 'label', gr.label, 'target_n', gr.target_n)
             order by gr.id)
      from fs_groups gr where gr.campaign_id = c.id), '[]'::jsonb),
    'demographics', coalesce(c.demographics, '[]'::jsonb),
    'segments', coalesce(to_jsonb(c.segments), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'assignment', a.assignment)
             order by a.assignment, a.user_id)
      from fs_campaign_assignments a where a.campaign_id = c.id), '[]'::jsonb)
  ))
  from fs_campaigns c
  join fs_campaign_governance g on g.campaign_id = c.id
  where c.id = p_camp;
$$;

-- jsonb key order is canonical in Postgres, so the same configuration always
-- produces the same fingerprint on any server.
create or replace function public.fs_campaign_config_hash(p_config jsonb)
returns text language sql immutable set search_path to 'public', 'extensions' as $$
  select encode(extensions.digest(convert_to(p_config::text, 'UTF8'), 'sha256'), 'hex');
$$;

alter table public.fs_campaigns
  drop constraint if exists fs_campaigns_status_check,
  add constraint fs_campaigns_status_check check (status in ('draft','open','closed','archived'));

create or replace function public.fs_validate_campaign_readiness(p_camp uuid)
returns table (code text, severity text, status text, detail text)
language plpgsql stable security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype; g fs_campaign_governance%rowtype;
        v_groups int; v_targets int; v_no_target int; v_responses int; v_settings fs_org_settings%rowtype;
begin
  select * into c from fs_campaigns where id = p_camp;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_is_member(c.org_id) then raise exception 'Not authorised'; end if;
  select * into g from fs_campaign_governance where campaign_id = p_camp;
  select * into v_settings from fs_org_settings where org_id = c.org_id;

  select count(*), coalesce(sum(target_n), 0), count(*) filter (where coalesce(target_n,0) = 0)
    into v_groups, v_targets, v_no_target from fs_groups where campaign_id = p_camp;
  select count(*) into v_responses from fs_responses where campaign_id = p_camp;

  return query
  select 'questionnaire', 'blocking',
         case when c.questionnaire_version_id is not null then 'passed' else 'failed' end,
         case when c.questionnaire_version_id is not null then 'Questionnaire version selected.'
              else 'Select an approved questionnaire version before opening.' end
  union all select 'governance', 'blocking',
         case when g.campaign_id is not null then 'passed' else 'failed' end,
         case when g.campaign_id is not null then 'Governance record present.'
              else 'This campaign has no governance record — it cannot be opened safely.' end
  union all select 'scoring', 'blocking',
         case when coalesce(g.scoring_rulebook,'') <> '' then 'passed' else 'failed' end,
         coalesce('Scoring rulebook ' || g.scoring_rulebook, 'No scoring rulebook recorded.')
  union all select 'groups', 'blocking',
         case when v_groups > 0 then 'passed' else 'failed' end,
         v_groups || ' stakeholder group(s) configured.'
  union all select 'privacy_floor', 'blocking',
         case when coalesce(g.score_threshold, 0) >= 4 and coalesce(g.comment_threshold,0) >= coalesce(g.score_threshold,0)
              then 'passed' else 'failed' end,
         'Score threshold ' || coalesce(g.score_threshold::text,'—') ||
         ', comment threshold ' || coalesce(g.comment_threshold::text,'—') || '. The floor is 4.'
  union all select 'close_date', 'blocking',
         case when c.closes_at is not null and c.closes_at > now() then 'passed' else 'failed' end,
         case when c.closes_at is null then 'No closing date set.'
              when c.closes_at <= now() then 'The closing date is in the past.'
              else 'Closes ' || to_char(c.closes_at, 'DD Mon YYYY') || '.' end
  union all select 'confidentiality_notice', 'blocking',
         case when coalesce(trim(c.confidentiality_notice), '') <> '' then 'passed' else 'failed' end,
         case when coalesce(trim(c.confidentiality_notice), '') <> ''
              then 'Respondents will see a confidentiality notice, frozen at launch.'
              else 'Respondents must be told how their answers are protected. Write the confidentiality notice.' end
  union all select 'no_test_responses', 'blocking',
         case when c.status <> 'draft' or v_responses = 0 then 'passed' else 'failed' end,
         case when c.status <> 'draft' then v_responses || ' response(s) collected.'
              when v_responses = 0 then 'No responses recorded yet.'
              else v_responses || ' response(s) already exist against this draft. Clear them before opening.' end
  union all select 'targets', 'warning',
         case when v_no_target = 0 and v_targets > 0 then 'passed' else 'failed' end,
         case when v_targets = 0 then 'No participation targets set — coverage and confidence cannot be reported.'
              when v_no_target > 0 then v_no_target || ' group(s) have no target.'
              else 'Targets set for every group (' || v_targets || ' people).' end
  union all select 'campaign_owner', 'warning',
         case when exists (select 1 from fs_campaign_assignments a where a.campaign_id = p_camp and a.assignment = 'campaign_owner')
              then 'passed' else 'failed' end,
         'A named campaign owner makes accountability explicit.'
  union all select 'report_approver', 'warning',
         case when not coalesce(g.report_approval_required, true)
                or exists (select 1 from fs_campaign_assignments a where a.campaign_id = p_camp and a.assignment = 'report_approver')
              then 'passed' else 'failed' end,
         'Report approval is required for this campaign but no approver is assigned.'
  union all select 'support_contact', 'warning',
         case when coalesce(trim(v_settings.support_email), '') <> '' then 'passed' else 'failed' end,
         'Respondents need somewhere to write if a link fails. Set the support email under Settings → Organisation.'
  union all select 'links', 'warning',
         case when exists (select 1 from fs_links l where l.campaign_id = p_camp and l.active) then 'passed' else 'failed' end,
         'No active respondent link yet — opening the campaign will create one per group.'
  union all select 'thankyou', 'warning',
         case when coalesce(trim(c.thankyou_message), '') <> '' then 'passed' else 'failed' end,
         'A thank-you message is the last thing a respondent sees.';
end $$;

-- The lock. Fields that define what the numbers mean cannot move once
-- respondents have answered. Operational fields can, with a reason, via an RPC.
create or replace function public.fs_campaigns_lock_guard()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_lifecycle boolean := coalesce(current_setting('fs.lifecycle', true), '') = 'on';
begin
  if not v_lifecycle then
    if new.status is distinct from old.status then
      raise exception 'Campaign status can only be changed through the lifecycle functions (open / close / archive).'
        using errcode = '42501';
    end if;
    if old.status <> 'draft' and new.closes_at is distinct from old.closes_at then
      raise exception 'Use fs_extend_campaign to change the closing date of a campaign that has opened. A reason is required.'
        using errcode = '42501';
    end if;
  end if;

  if old.status <> 'draft' then
    if new.questionnaire_version_id is distinct from old.questionnaire_version_id
       or new.demographics          is distinct from old.demographics
       or new.segments              is distinct from old.segments
       or new.anonymity_threshold   is distinct from old.anonymity_threshold
       or new.confidentiality_notice is distinct from old.confidentiality_notice
       or new.opens_at              is distinct from old.opens_at then
      raise exception 'This setting is locked: the campaign opened on %, and respondents answered under the configuration frozen at launch. Create a revised campaign draft instead.',
        coalesce(to_char(old.opens_at, 'DD Mon YYYY'), 'launch') using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Postgres fires BEFORE-row triggers in alphabetical order. Without the numeric
-- prefix, fs_campaign_threshold_guard_bu ran first and normalised
-- anonymity_threshold back to the governance value, so an edit to a locked
-- campaign was silently swallowed instead of refused. Silence is the wrong
-- answer: the caller must be told the setting is locked.
drop trigger if exists fs_campaigns_lock_guard_bu on public.fs_campaigns;
drop trigger if exists fs_00_campaigns_lock_guard_bu on public.fs_campaigns;
create trigger fs_00_campaigns_lock_guard_bu before update on public.fs_campaigns
  for each row execute function public.fs_campaigns_lock_guard();

comment on function public.fs_campaigns_lock_guard() is
  'Refuses edits to the frozen analytical contract of a campaign that has opened. Installed as fs_00_… so it runs before fs_campaign_threshold_guard_bu, which would otherwise normalise the value and mask the violation.';

-- =============================================================================
-- 5. Lifecycle RPCs
-- =============================================================================
-- fs_open_campaign changed return type void -> jsonb, so it must be dropped
-- before it can be replaced.
drop function if exists public.fs_open_campaign(uuid);

create or replace function public.fs_open_campaign(p_camp uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype; v_blockers text[]; v_config jsonb; v_hash text;
        v_version int; v_corr uuid := gen_random_uuid(); g record; v_links int := 0;
begin
  select * into c from fs_campaigns where id = p_camp for update;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_role_in(c.org_id, array['owner','manager']) then raise exception 'Not authorised'; end if;
  if c.status <> 'draft' then raise exception 'Only a draft campaign can be opened (this one is %).', c.status; end if;

  perform fs_require_aal2(c.org_id, 'campaign.open');

  select array_agg(code || ': ' || detail) into v_blockers
    from fs_validate_campaign_readiness(p_camp)
   where severity = 'blocking' and status = 'failed';
  if v_blockers is not null then
    raise exception 'This campaign is not ready to open. %', array_to_string(v_blockers, ' | ');
  end if;

  perform set_config('fs.lifecycle', 'on', true);

  for g in select id from fs_groups where campaign_id = p_camp loop
    if not exists (select 1 from fs_links l where l.campaign_id = p_camp and l.group_id = g.id and l.active and l.mode = 'group') then
      insert into fs_links (campaign_id, group_id, token, mode)
      values (p_camp, g.id, encode(gen_random_bytes(16), 'hex'), 'group');
      v_links := v_links + 1;
    end if;
  end loop;

  update fs_campaigns set status = 'open', opens_at = coalesce(opens_at, now()) where id = p_camp;

  v_config := fs_build_campaign_config(p_camp) || jsonb_build_object('provenance',
                jsonb_build_object('source', 'launch', 'captured_at', now(), 'captured_by', auth.uid()));
  v_hash := fs_campaign_config_hash(v_config);
  select coalesce(max(version), 0) + 1 into v_version from fs_campaign_config_snapshots where campaign_id = p_camp;
  insert into fs_campaign_config_snapshots (campaign_id, version, snapshot_type, config, config_hash, created_by)
  values (p_camp, v_version, 'launch', v_config, v_hash, auth.uid());

  update fs_campaign_governance set locked_at = now(), locked_by = auth.uid() where campaign_id = p_camp;

  perform fs_audit_log(c.org_id, 'campaign.open', 'fs_campaigns', p_camp::text, p_camp,
    jsonb_build_object('status', c.status),
    jsonb_build_object('status', 'open', 'snapshot_version', v_version, 'config_hash', v_hash, 'links_created', v_links),
    null, v_corr);

  return jsonb_build_object('ok', true, 'snapshot_version', v_version, 'config_hash', v_hash, 'links_created', v_links);
end $$;

create or replace function public.fs_extend_campaign(p_camp uuid, p_new_close timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype;
begin
  select * into c from fs_campaigns where id = p_camp for update;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_role_in(c.org_id, array['owner','manager']) then raise exception 'Not authorised'; end if;
  if c.status <> 'open' then raise exception 'Only an open campaign can be extended.'; end if;
  if coalesce(length(trim(p_reason)), 0) < 10 then
    raise exception 'Give a reason of at least 10 characters — post-launch changes are recorded.';
  end if;
  if p_new_close is null or p_new_close <= now() then raise exception 'The new closing date must be in the future.'; end if;
  if p_new_close <= c.closes_at then
    raise exception 'Extending means moving the closing date later than %.', to_char(c.closes_at, 'DD Mon YYYY');
  end if;

  perform set_config('fs.lifecycle', 'on', true);
  update fs_campaigns set closes_at = p_new_close where id = p_camp;
  perform fs_audit_log(c.org_id, 'campaign.extend', 'fs_campaigns', p_camp::text, p_camp,
    jsonb_build_object('closes_at', c.closes_at), jsonb_build_object('closes_at', p_new_close), p_reason);
  return jsonb_build_object('ok', true, 'closes_at', p_new_close);
end $$;

create or replace function public.fs_close_campaign(p_camp uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype; v_deactivated int;
begin
  select * into c from fs_campaigns where id = p_camp for update;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_role_in(c.org_id, array['owner','manager']) then raise exception 'Not authorised'; end if;
  if c.status <> 'open' then raise exception 'Only an open campaign can be closed (this one is %).', c.status; end if;

  perform set_config('fs.lifecycle', 'on', true);
  update fs_links set active = false, revoked_at = now(), revoked_by = auth.uid()
   where campaign_id = p_camp and active;
  get diagnostics v_deactivated = row_count;
  update fs_campaigns set status = 'closed', closes_at = least(closes_at, now()) where id = p_camp;

  perform fs_audit_log(c.org_id, 'campaign.close', 'fs_campaigns', p_camp::text, p_camp,
    jsonb_build_object('status', c.status),
    jsonb_build_object('status', 'closed', 'links_deactivated', v_deactivated), p_reason);
  return jsonb_build_object('ok', true, 'links_deactivated', v_deactivated);
end $$;

create or replace function public.fs_archive_campaign(p_camp uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype;
begin
  select * into c from fs_campaigns where id = p_camp for update;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_role_in(c.org_id, array['owner']) then raise exception 'Only an organisation owner can archive a campaign.'; end if;
  if c.status <> 'closed' then raise exception 'Close the campaign before archiving it.'; end if;

  perform set_config('fs.lifecycle', 'on', true);
  update fs_campaigns set status = 'archived' where id = p_camp;
  perform fs_audit_log(c.org_id, 'campaign.archive', 'fs_campaigns', p_camp::text, p_camp,
    jsonb_build_object('status', c.status), jsonb_build_object('status', 'archived'), p_reason);
  return jsonb_build_object('ok', true);
end $$;

-- The supported answer to "I need to change a locked setting".
create or replace function public.fs_create_revised_campaign(p_camp uuid, p_name text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype; s fs_org_settings%rowtype; v_new uuid; g record; v_gid uuid;
begin
  select * into c from fs_campaigns where id = p_camp;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_role_in(c.org_id, array['owner','manager']) then raise exception 'Not authorised'; end if;
  select * into s from fs_org_settings where org_id = c.org_id;

  insert into fs_campaigns (org_id, name, status, questionnaire_version_id, closes_at,
    anonymity_threshold, created_by, thankyou_message, closed_message, client_context,
    engagement_objective, segments, prior_campaign_id, demographics, programme_id, confidentiality_notice)
  values (c.org_id, coalesce(nullif(trim(p_name), ''), c.name || ' (revised)'), 'draft', c.questionnaire_version_id,
    now() + make_interval(days => greatest(1, coalesce(s.default_campaign_duration_days, 30))),
    greatest(coalesce(s.default_score_threshold, 5), 4), auth.uid(), c.thankyou_message, c.closed_message,
    c.client_context, c.engagement_objective, c.segments, c.id, c.demographics, c.programme_id, c.confidentiality_notice)
  returning id into v_new;

  -- Fresh governance from CURRENT organisation defaults — a revision is a new
  -- analytical contract, not a copy of the old one.
  insert into fs_campaign_governance (campaign_id, privacy_profile, score_threshold, comment_threshold,
    suppression_mode, max_filter_dimensions, raw_export_policy, launch_approval_required, report_approval_required, updated_by)
  values (v_new, 'standard', greatest(coalesce(s.default_score_threshold,5),4),
    greatest(coalesce(s.default_comment_threshold,10), greatest(coalesce(s.default_score_threshold,5),4)),
    coalesce(s.default_suppression_mode,'basic'), coalesce(s.default_max_filter_dimensions,2),
    case when coalesce(s.allow_raw_exports,false) then 'allowed' else 'aggregate_only' end,
    coalesce(s.require_launch_approval,true), coalesce(s.require_report_approval,true), auth.uid())
  on conflict (campaign_id) do nothing;

  for g in select type, label, target_n from fs_groups where campaign_id = p_camp order by id loop
    insert into fs_groups (campaign_id, type, label, target_n) values (v_new, g.type, g.label, g.target_n)
    returning id into v_gid;
    insert into fs_links (campaign_id, group_id, token, mode)
    values (v_new, v_gid, encode(gen_random_bytes(16), 'hex'), 'group');
  end loop;

  perform fs_audit_log(c.org_id, 'campaign.revise', 'fs_campaigns', v_new::text, v_new,
    jsonb_build_object('revised_from', p_camp), jsonb_build_object('new_campaign', v_new), null);
  return v_new;
end $$;

revoke all on function public.fs_build_campaign_config(uuid) from public, anon;
grant execute on function public.fs_build_campaign_config(uuid) to authenticated, service_role;
revoke all on function public.fs_campaign_config_hash(jsonb) from public, anon;
grant execute on function public.fs_campaign_config_hash(jsonb) to authenticated, service_role;
revoke all on function public.fs_validate_campaign_readiness(uuid) from public, anon;
grant execute on function public.fs_validate_campaign_readiness(uuid) to authenticated, service_role;
revoke all on function public.fs_campaigns_lock_guard() from public, anon, authenticated;
revoke all on function public.fs_open_campaign(uuid) from public, anon;
revoke all on function public.fs_extend_campaign(uuid, timestamptz, text) from public, anon;
revoke all on function public.fs_close_campaign(uuid, text) from public, anon;
revoke all on function public.fs_archive_campaign(uuid, text) from public, anon;
revoke all on function public.fs_create_revised_campaign(uuid, text) from public, anon;
grant execute on function public.fs_open_campaign(uuid) to authenticated, service_role;
grant execute on function public.fs_extend_campaign(uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.fs_close_campaign(uuid, text) to authenticated, service_role;
grant execute on function public.fs_archive_campaign(uuid, text) to authenticated, service_role;
grant execute on function public.fs_create_revised_campaign(uuid, text) to authenticated, service_role;

-- =============================================================================
-- 6. Backfill — launch snapshots for campaigns that opened before snapshots
-- =============================================================================
-- These are reconstructed from today's values, NOT from what was in force on the
-- day each campaign opened. The provenance block says so and lists the fields
-- that genuinely cannot be recovered. A migrated snapshot is the best available
-- reconstruction, clearly labelled — not evidence of the original configuration.

do $$
declare r record; v_config jsonb; v_hash text; v_unknown jsonb;
begin
  for r in
    select c.id, c.org_id, c.status, c.opens_at
      from fs_campaigns c
      left join fs_campaign_config_snapshots s
             on s.campaign_id = c.id and s.snapshot_type = 'launch'
     where c.status <> 'draft' and s.id is null
  loop
    v_unknown := jsonb_build_array();
    if (select confidentiality_notice is null from fs_campaigns where id = r.id) then
      v_unknown := v_unknown || to_jsonb('respondent.confidentiality_notice — no such field existed at launch'::text);
    end if;
    if not exists (select 1 from fs_campaign_assignments a where a.campaign_id = r.id) then
      v_unknown := v_unknown || to_jsonb('assignments — campaign assignments did not exist at launch'::text);
    end if;
    v_unknown := v_unknown || to_jsonb('privacy.comment_threshold — a single anonymity_threshold was in force; score and comment were not separable'::text);
    v_unknown := v_unknown || to_jsonb('scoring.rulebook — recorded as the current rulebook, not verified against the one that ran'::text);

    v_config := fs_build_campaign_config(r.id) || jsonb_build_object(
      'provenance', jsonb_build_object(
        'source', 'migrated', 'captured_at', now(), 'captured_by', null,
        'note', 'Reconstructed from current values during the Phase 1 settings migration. The campaign opened before configuration snapshots existed.',
        'campaign_status_at_migration', r.status, 'opened_at', r.opens_at,
        'not_recoverable', v_unknown
      ));
    v_hash := fs_campaign_config_hash(v_config);

    insert into fs_campaign_config_snapshots (campaign_id, version, snapshot_type, config, config_hash, created_by)
    values (r.id,
            (select coalesce(max(version), 0) + 1 from fs_campaign_config_snapshots where campaign_id = r.id),
            'launch', v_config, v_hash, null);

    update fs_campaign_governance
       set locked_at = coalesce(locked_at, coalesce(r.opens_at, now()))
     where campaign_id = r.id;

    insert into fs_audit (org_id, action, entity, entity_id, campaign_id, after_value, reason)
    values (r.org_id, 'campaign.snapshot:migrated', 'fs_campaign_config_snapshots', r.id::text, r.id,
            jsonb_build_object('config_hash', v_hash, 'snapshot_type', 'launch', 'provenance', 'migrated'),
            'Phase 1 backfill: reconstructed launch snapshot for a campaign that opened before snapshots existed.');
  end loop;
end $$;

-- =============================================================================
-- Verified against the live database after apply
-- =============================================================================
--   fs_audit_redact          nested password/token/comment keys → "[redacted]"
--   fs_audit UPDATE          refused (42501)
--   fs_audit DELETE          refused (42501)
--   config hash              identical across repeated builds of the same config
--   readiness                14 checks; 8 blocking / 6 advisory, correctly classified
--   locked anonymity_threshold on an open campaign   refused, value unchanged
--   locked confidentiality_notice on an open campaign refused
--   locked demographics / segments on an open campaign refused
--   direct status write                              refused
--   direct closes_at write on an open campaign       refused
--   operational thankyou_message on an open campaign allowed
--   draft campaign                                   fully editable
--   direct status write on a draft                   refused
--   backfill                                         2 migrated snapshots, both governance rows locked
