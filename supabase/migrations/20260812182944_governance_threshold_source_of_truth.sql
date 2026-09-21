-- InnoPulse Full-Scale — fs_campaign_governance becomes the source of truth for
-- anonymity thresholds. fs_campaigns.anonymity_threshold is retained as a
-- deprecated mirror so any un-migrated read path stays correct.
--
-- Recursion between the two mirror triggers is prevented with pg_trigger_depth():
-- each side only propagates when it is the outermost trigger.

comment on column public.fs_campaigns.anonymity_threshold is
  'DEPRECATED — mirror of fs_campaign_governance.score_threshold, maintained by trigger fs_campaign_threshold_mirror_aiu. Write to fs_campaign_governance instead. Retained only so pre-governance read paths stay correct.';

comment on column public.fs_campaign_governance.score_threshold is
  'Minimum valid responses before a group, demographic cut or overall score is released. Hard floor 4, clamped by trigger. Source of truth for suppression of scores.';

comment on column public.fs_campaign_governance.comment_threshold is
  'Minimum valid responses in a group before any individual-level content from it is released: verbatims, theme coding, comment curation and the single-response detail view. Never below score_threshold.';

-- 1. Clamp governance values to the hard floor and keep comment >= score. -------
create or replace function public.fs_governance_clamp()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.score_threshold   := greatest(coalesce(new.score_threshold, 5), 4);
  new.comment_threshold := greatest(coalesce(new.comment_threshold, new.score_threshold), new.score_threshold);
  new.max_filter_dimensions := least(greatest(coalesce(new.max_filter_dimensions, 2), 1), 8);
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists fs_governance_clamp_biu on public.fs_campaign_governance;
create trigger fs_governance_clamp_biu
  before insert or update on public.fs_campaign_governance
  for each row execute function public.fs_governance_clamp();

-- 2. governance -> fs_campaigns (the deprecated mirror). -----------------------
create or replace function public.fs_governance_mirror_to_campaign()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update fs_campaigns
     set anonymity_threshold = new.score_threshold
   where id = new.campaign_id
     and anonymity_threshold is distinct from new.score_threshold;
  return null;
end $$;

drop trigger if exists fs_governance_mirror_aiu on public.fs_campaign_governance;
create trigger fs_governance_mirror_aiu
  after insert or update of score_threshold on public.fs_campaign_governance
  for each row execute function public.fs_governance_mirror_to_campaign();

-- 3. Legacy writes to fs_campaigns.anonymity_threshold write through to
--    governance, unless governance is locked, in which case they are ignored.
create or replace function public.fs_campaign_threshold_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_locked timestamptz; v_score int; v_found boolean;
begin
  if new.anonymity_threshold is not distinct from old.anonymity_threshold then return new; end if;
  select locked_at, score_threshold, true into v_locked, v_score, v_found
    from fs_campaign_governance where campaign_id = new.id;
  if coalesce(v_found, false) and v_locked is not null then
    new.anonymity_threshold := v_score;   -- governance is locked: legacy write ignored
  else
    new.anonymity_threshold := greatest(coalesce(new.anonymity_threshold, 5), 4);
  end if;
  return new;
end $$;

drop trigger if exists fs_campaign_threshold_guard_bu on public.fs_campaigns;
create trigger fs_campaign_threshold_guard_bu
  before update of anonymity_threshold on public.fs_campaigns
  for each row execute function public.fs_campaign_threshold_guard();

create or replace function public.fs_campaign_threshold_mirror()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update fs_campaign_governance
     set score_threshold   = new.anonymity_threshold,
         comment_threshold = greatest(comment_threshold, new.anonymity_threshold),
         privacy_profile   = case when privacy_profile = 'standard' then 'custom' else privacy_profile end,
         updated_at        = now()
   where campaign_id = new.id
     and locked_at is null
     and score_threshold is distinct from new.anonymity_threshold;
  return null;
end $$;

drop trigger if exists fs_campaign_threshold_mirror_aiu on public.fs_campaigns;
create trigger fs_campaign_threshold_mirror_aiu
  after update of anonymity_threshold on public.fs_campaigns
  for each row execute function public.fs_campaign_threshold_mirror();

-- 4. Every campaign must have a governance row; backfill any that predate it. --
insert into fs_campaign_governance (campaign_id, privacy_profile, score_threshold, comment_threshold, created_at)
select c.id, 'migrated', greatest(coalesce(c.anonymity_threshold, 5), 4),
       greatest(coalesce(c.anonymity_threshold, 5), 4), now()
  from fs_campaigns c
  left join fs_campaign_governance g on g.campaign_id = c.id
 where g.campaign_id is null
on conflict (campaign_id) do nothing;

-- 5. Effective thresholds, one definition, usable from SQL and PostgREST. ------
create or replace function public.fs_effective_thresholds(p_campaign uuid)
returns table (score_threshold int, comment_threshold int)
language sql stable security definer set search_path to 'public' as $$
  select greatest(coalesce(g.score_threshold, c.anonymity_threshold, 5), 4) as score_threshold,
         greatest(coalesce(g.comment_threshold, g.score_threshold, c.anonymity_threshold, 5),
                  coalesce(g.score_threshold, c.anonymity_threshold, 5), 4) as comment_threshold
    from fs_campaigns c
    left join fs_campaign_governance g on g.campaign_id = c.id
   where c.id = p_campaign
     and fs_is_member(c.org_id);
$$;

revoke all on function public.fs_effective_thresholds(uuid) from public;
grant execute on function public.fs_effective_thresholds(uuid) to authenticated, service_role;;
