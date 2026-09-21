-- Phase 1 — every lifecycle transition is a single audited server transaction,
-- and privacy-critical configuration becomes immutable the moment a campaign opens.
-- fs_open_campaign changed return type (void -> jsonb) and was dropped first.

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

drop trigger if exists fs_campaigns_lock_guard_bu on public.fs_campaigns;
create trigger fs_campaigns_lock_guard_bu before update on public.fs_campaigns
  for each row execute function public.fs_campaigns_lock_guard();

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
grant execute on function public.fs_create_revised_campaign(uuid, text) to authenticated, service_role;;
