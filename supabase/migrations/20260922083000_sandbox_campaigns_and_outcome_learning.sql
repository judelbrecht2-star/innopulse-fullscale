-- InnoPulse Full-Scale — safe sandbox campaigns and intervention outcome learning.

alter table public.fs_campaigns
  add column if not exists is_sandbox boolean not null default false;

create index if not exists fs_campaigns_sandbox_idx
  on public.fs_campaigns (org_id, is_sandbox, created_at desc);

comment on column public.fs_campaigns.is_sandbox is
  'Test-only assessment cycle. Responses remain usable inside the campaign but immutable official reports are blocked.';

-- Keep the stable campaign creation RPC for older clients and give the current
-- client one explicit sandbox-aware entry point.
create or replace function public.fs_create_campaign_v2(
  p_org uuid, p_name text, p_qv uuid, p_threshold integer, p_days integer,
  p_groups jsonb, p_demographics jsonb default null, p_is_sandbox boolean default false)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_camp uuid;
begin
  v_camp := public.fs_create_campaign(
    p_org, p_name, p_qv, p_threshold, p_days, p_groups, p_demographics
  );
  update public.fs_campaigns set is_sandbox = coalesce(p_is_sandbox, false) where id = v_camp;
  if coalesce(p_is_sandbox, false) then
    perform public.fs_audit_log(
      p_org, 'campaign.sandbox:create', 'fs_campaigns', v_camp::text, v_camp,
      null, jsonb_build_object('is_sandbox', true),
      'Created as a test-only sandbox; official report generation is blocked.'
    );
  end if;
  return v_camp;
end $$;

revoke all on function public.fs_create_campaign_v2(uuid,text,uuid,integer,integer,jsonb,jsonb,boolean) from public, anon;
grant execute on function public.fs_create_campaign_v2(uuid,text,uuid,integer,integer,jsonb,jsonb,boolean) to authenticated;

-- A duplicated cycle retains the source campaign's sandbox boundary.
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
    engagement_objective, segments, prior_campaign_id, demographics, programme_id,
    confidentiality_notice, is_sandbox)
  values (c.org_id, coalesce(nullif(trim(p_name), ''), c.name || ' (revised)'), 'draft', c.questionnaire_version_id,
    now() + make_interval(days => greatest(1, coalesce(s.default_campaign_duration_days, 30))),
    greatest(coalesce(s.default_score_threshold, 5), 4), auth.uid(), c.thankyou_message, c.closed_message,
    c.client_context, c.engagement_objective, c.segments, c.id, c.demographics, c.programme_id,
    c.confidentiality_notice, c.is_sandbox)
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
    jsonb_build_object('revised_from', p_camp),
    jsonb_build_object('new_campaign', v_new, 'is_sandbox', c.is_sandbox), null);
  return v_new;
end $$;

-- Defence in depth: a sandbox can exercise scoring, findings and AI services,
-- but it can never create an immutable report that looks official.
create or replace function public.fs_block_sandbox_report()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if exists (select 1 from fs_campaigns where id = new.campaign_id and is_sandbox) then
    raise exception 'Official reports cannot be generated from a sandbox campaign';
  end if;
  return new;
end $$;

drop trigger if exists fs_reports_block_sandbox on public.fs_reports;
create trigger fs_reports_block_sandbox
before insert on public.fs_reports
for each row execute function public.fs_block_sandbox_report();

revoke all on function public.fs_block_sandbox_report() from public, anon, authenticated;

create table if not exists public.fs_intervention_outcomes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  intervention_id uuid not null references public.fs_interventions(id),
  pillar text not null,
  kpi text,
  baseline_score numeric check (baseline_score between 0 and 100),
  target_score numeric check (target_score between 0 and 100),
  observed_score numeric check (observed_score between 0 and 100),
  review_due_at date,
  observed_at timestamptz,
  status text not null default 'planned'
    check (status in ('planned','on_track','at_risk','achieved','not_achieved','inconclusive')),
  learning_note text check (char_length(learning_note) <= 2000),
  follow_up_campaign_id uuid references public.fs_campaigns(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, intervention_id)
);

create index if not exists fs_intervention_outcomes_campaign_idx
  on public.fs_intervention_outcomes (campaign_id, status, review_due_at);

alter table public.fs_intervention_outcomes enable row level security;
create policy fs_intervention_outcomes_select on public.fs_intervention_outcomes
  for select to authenticated
  using (exists (
    select 1 from public.fs_campaigns c
    where c.id = campaign_id and public.fs_is_member(c.org_id)
  ));
create policy fs_intervention_outcomes_write on public.fs_intervention_outcomes
  for all to authenticated
  using (exists (
    select 1 from public.fs_campaigns c
    where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])
  ))
  with check (exists (
    select 1 from public.fs_campaigns c
    where c.id = campaign_id and public.fs_role_in(c.org_id, array['owner','manager','analyst'])
  ));

comment on table public.fs_intervention_outcomes is
  'Human-reviewed baseline, target and observed results for approved interventions.';
