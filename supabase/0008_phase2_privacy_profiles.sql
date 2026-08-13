-- 0008 — Settings architecture, Phase 2: confidentiality profiles (applied 2026-08-13)
--
--   20260813085954  privacy_profiles
--   20260813090142  reconcile_duplicate_governance_constraints
--
-- Complementary suppression itself lives in code, not SQL: app/lib/suppression.js
-- is the definition, fs-results v12 carries the port, and
-- tests/suppression.test.js is the shared specification.

-- =============================================================================
-- 1. Reconcile duplicate CHECK constraints
-- =============================================================================
-- fs_campaign_governance had two parallel sets of CHECK constraints: the
-- originals created with the table, and the ones Phase 1 added under different
-- names. Postgres ANDs them, so the effective rule was the intersection — and
-- the intersection was wrong in three places:
--
--   privacy_profile    originals allowed 'high', Phase 1 'high_sensitivity'.
--                      Neither could ever be stored. This is why applying the
--                      high-sensitivity profile failed the first time it ran.
--   distribution_mode  originals 'unique_invitation', Phase 1 'individual_invite'.
--                      Same defect, latent until someone used it.
--   max_filter_dims    originals capped at 3, Phase 1 at 8.
--
-- Keeping the Phase 1 vocabulary because it matches fs_privacy_profiles().

alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_privacy_profile_check,
  drop constraint if exists fs_campaign_governance_distribution_mode_check,
  drop constraint if exists fs_campaign_governance_max_filter_dimensions_check,
  drop constraint if exists fs_campaign_governance_score_threshold_check,
  drop constraint if exists fs_campaign_governance_comment_threshold_check,
  drop constraint if exists fs_campaign_governance_suppression_mode_check,
  drop constraint if exists fs_campaign_governance_raw_export_policy_check;

alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_comment_floor,
  add constraint fs_campaign_governance_comment_floor check (comment_threshold >= 4);

-- =============================================================================
-- 2. The three profiles
-- =============================================================================
-- Three named starting points instead of six numbers a campaign manager has to
-- reason about individually. The floor of 4 applies to every profile, including
-- the small-population exception — that exception is the only one that reaches
-- the floor, and it carries approval and disclosure obligations with it.

create or replace function public.fs_privacy_profiles()
returns jsonb language sql immutable set search_path to 'public' as $$
  select jsonb_build_object(
    'standard', jsonb_build_object(
      'label', 'Standard protected',
      'description', 'The default. Suitable for most organisation-wide campaigns.',
      'score_threshold', 5, 'comment_threshold', 10,
      'suppression_mode', 'basic', 'max_filter_dimensions', 2,
      'raw_export_policy', 'aggregate_only',
      'requires_owner_approval', false, 'requires_respondent_disclosure', false),
    'high_sensitivity', jsonb_build_object(
      'label', 'High sensitivity',
      'description', 'For campaigns where a disclosure would cause real harm — grievances, restructuring, regulated settings.',
      'score_threshold', 7, 'comment_threshold', 12,
      'suppression_mode', 'strong', 'max_filter_dimensions', 1,
      'raw_export_policy', 'approval_required',
      'requires_owner_approval', false, 'requires_respondent_disclosure', false),
    'small_population', jsonb_build_object(
      'label', 'Small population exception',
      'description', 'For organisations too small to reach the standard thresholds. Reaches the hard floor of 4 and cannot go lower. Requires owner approval, a privacy review, and telling respondents plainly that their group is small.',
      'score_threshold', 4, 'comment_threshold', 8,
      'suppression_mode', 'strong', 'max_filter_dimensions', 1,
      'raw_export_policy', 'approval_required',
      'requires_owner_approval', true, 'requires_respondent_disclosure', true)
  );
$$;

create or replace function public.fs_apply_privacy_profile(p_camp uuid, p_profile text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c fs_campaigns%rowtype; g fs_campaign_governance%rowtype; v_p jsonb; v_before jsonb;
begin
  select * into c from fs_campaigns where id = p_camp;
  if not found then raise exception 'Campaign not found'; end if;
  if not fs_role_in(c.org_id, array['owner','manager']) then raise exception 'Not authorised'; end if;

  select * into g from fs_campaign_governance where campaign_id = p_camp for update;
  if not found then raise exception 'This campaign has no governance record.'; end if;
  if g.locked_at is not null then
    raise exception 'Privacy settings are locked: this campaign has opened. Create a revised campaign draft instead.'
      using errcode = '42501';
  end if;

  v_p := fs_privacy_profiles() -> p_profile;
  if v_p is null then raise exception 'Unknown privacy profile: %', p_profile; end if;

  -- The small-population exception is a deliberate reduction in protection, so
  -- it is an owner decision and it has to be justified in writing.
  if coalesce((v_p ->> 'requires_owner_approval')::boolean, false) then
    if not fs_role_in(c.org_id, array['owner']) then
      raise exception 'Only an organisation owner can apply the small population exception.';
    end if;
    if coalesce(length(trim(p_reason)), 0) < 20 then
      raise exception 'The small population exception needs a written justification of at least 20 characters. It will be stored in the audit log.';
    end if;
    perform fs_require_aal2(c.org_id, 'privacy.small_population_exception');
  end if;

  v_before := jsonb_build_object(
    'privacy_profile', g.privacy_profile, 'score_threshold', g.score_threshold,
    'comment_threshold', g.comment_threshold, 'suppression_mode', g.suppression_mode,
    'max_filter_dimensions', g.max_filter_dimensions, 'raw_export_policy', g.raw_export_policy);

  update fs_campaign_governance set
    privacy_profile       = p_profile,
    score_threshold       = (v_p ->> 'score_threshold')::int,
    comment_threshold     = (v_p ->> 'comment_threshold')::int,
    suppression_mode      = v_p ->> 'suppression_mode',
    max_filter_dimensions = (v_p ->> 'max_filter_dimensions')::int,
    raw_export_policy     = v_p ->> 'raw_export_policy',
    updated_by            = auth.uid()
  where campaign_id = p_camp;

  perform fs_audit_log(c.org_id, 'campaign.privacy_profile:' || p_profile,
    'fs_campaign_governance', p_camp::text, p_camp, v_before,
    v_p - 'label' - 'description', p_reason);

  return jsonb_build_object('ok', true, 'profile', p_profile,
    'requires_respondent_disclosure', coalesce((v_p ->> 'requires_respondent_disclosure')::boolean, false));
end $$;

-- =============================================================================
-- 3. Profile drift
-- =============================================================================
-- Any hand edit that moves a governed value away from its profile makes the
-- profile label a lie. Rather than let the badge drift, the row relabels itself
-- to 'custom'. Named fs_zz_… so it runs after fs_governance_clamp_biu and
-- therefore judges the final, clamped values.

create or replace function public.fs_governance_profile_drift()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_p jsonb;
begin
  if new.privacy_profile is distinct from old.privacy_profile then return new; end if;
  v_p := fs_privacy_profiles() -> new.privacy_profile;
  if v_p is null then return new; end if;   -- 'custom' and 'migrated' cannot drift
  if new.score_threshold          is distinct from (v_p ->> 'score_threshold')::int
     or new.comment_threshold     is distinct from (v_p ->> 'comment_threshold')::int
     or new.suppression_mode      is distinct from (v_p ->> 'suppression_mode')
     or new.max_filter_dimensions is distinct from (v_p ->> 'max_filter_dimensions')::int
     or new.raw_export_policy     is distinct from (v_p ->> 'raw_export_policy') then
    new.privacy_profile := 'custom';
  end if;
  return new;
end $$;

drop trigger if exists fs_governance_profile_drift_bu on public.fs_campaign_governance;
drop trigger if exists fs_zz_governance_profile_drift_bu on public.fs_campaign_governance;
create trigger fs_zz_governance_profile_drift_bu before update on public.fs_campaign_governance
  for each row execute function public.fs_governance_profile_drift();

revoke all on function public.fs_governance_profile_drift() from public, anon, authenticated;
revoke all on function public.fs_privacy_profiles() from public, anon;
grant execute on function public.fs_privacy_profiles() to authenticated, service_role;
revoke all on function public.fs_apply_privacy_profile(uuid, text, text) from public, anon;
grant execute on function public.fs_apply_privacy_profile(uuid, text, text) to authenticated, service_role;

-- =============================================================================
-- Verified against the live database after apply, on a throwaway draft
-- =============================================================================
--   created as standard            standard / 5 / 10 / basic / 2 dims
--   hand-edit score to 6           relabels to custom, value kept
--   high_sensitivity applied       high_sensitivity / 7 / 12 / strong / 1 dim
--   widen filters to 3             relabels to custom
--   probe campaign deleted afterwards
