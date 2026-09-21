-- Phase 1 — the immutable analytical contract.
--
-- A campaign's results must be reproducible years later. That is only true if
-- the configuration it ran under is stored, not recomputed. fs_build_campaign_config
-- assembles that configuration; fs_campaign_config_hash fingerprints it; the
-- launch snapshot freezes it. Nothing downstream should ever merge live
-- organisation settings into a campaign that has already opened.

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

-- Deterministic fingerprint. jsonb key order is canonical in Postgres, so the
-- same configuration always produces the same hash on any server.
create or replace function public.fs_campaign_config_hash(p_config jsonb)
returns text language sql immutable set search_path to 'public', 'extensions' as $$
  select encode(extensions.digest(convert_to(p_config::text, 'UTF8'), 'sha256'), 'hex');
$$;

-- Readiness ---------------------------------------------------------------------
-- Returns one row per check so the UI can render blocking failures, warnings and
-- passes without duplicating any of the rules in JavaScript.
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
         case when c.questionnaire_version_id is not null
              then 'Questionnaire version selected.'
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
         case when v_responses = 0 then 'passed' else 'failed' end,
         case when v_responses = 0 then 'No responses recorded yet.'
              else v_responses || ' response(s) already exist against this draft. Clear them before opening.' end
  -- warnings ---------------------------------------------------------------
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

revoke all on function public.fs_build_campaign_config(uuid) from public, anon;
grant execute on function public.fs_build_campaign_config(uuid) to authenticated, service_role;
revoke all on function public.fs_campaign_config_hash(jsonb) from public, anon;
grant execute on function public.fs_campaign_config_hash(jsonb) to authenticated, service_role;
revoke all on function public.fs_validate_campaign_readiness(uuid) from public, anon;
grant execute on function public.fs_validate_campaign_readiness(uuid) to authenticated, service_role;;
