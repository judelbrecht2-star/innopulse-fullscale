-- InnoPulse Full-Scale — consolidated backend baseline (exported 2026-07-17)
-- Source of truth for the fs_* schema, RLS policies and helper functions that
-- currently run in Supabase project jydbinexjckfzjqgsmjf. Exported for version
-- control per the 2026-07-17 product audit (Release Gate 0). This file
-- documents deployed state; future changes must be made as new migration
-- files, never by editing this baseline.

-- ============ helper functions (tenant + role checks) ============
create or replace function public.fs_is_member(p_org uuid)
returns boolean language sql security definer set search_path = public as
$$ select exists (select 1 from fs_memberships m where m.org_id = p_org and m.user_id = auth.uid()); $$;

create or replace function public.fs_role_in(p_org uuid, p_roles text[])
returns boolean language sql security definer set search_path = public as
$$ select exists (select 1 from fs_memberships m where m.org_id = p_org and m.user_id = auth.uid() and m.role = any(p_roles)); $$;

revoke execute on function public.fs_is_member(uuid) from anon;
revoke execute on function public.fs_role_in(uuid, text[]) from anon;

-- atomic link claim (audit F13): increments used_count only while capacity remains
create or replace function public.fs_use_link(p_link uuid)
returns boolean language sql security definer set search_path = public as
$$ with upd as (
     update fs_links set used_count = used_count + 1
      where id = p_link and active = true
        and (max_uses is null or used_count < max_uses)
     returning id)
   select exists(select 1 from upd); $$;
create or replace function public.fs_release_link(p_link uuid)
returns void language sql security definer set search_path = public as
$$ update fs_links set used_count = greatest(0, used_count - 1) where id = p_link; $$;
revoke execute on function public.fs_use_link(uuid) from public, anon, authenticated;
revoke execute on function public.fs_release_link(uuid) from public, anon, authenticated;

-- ============ tables (fs_ prefix; RLS on every table) ============
-- fs_orgs(id, name, created_at)
-- fs_memberships(id, org_id->fs_orgs cascade, user_id, role check in
--   ('owner','manager','analyst','viewer','action_owner'), created_at,
--   unique(org_id, user_id))
-- fs_questionnaire_versions(id, version, label, definition jsonb, created_at)
--   definition = { scale:[{code,label,value,not_scored?}],
--                  pillars:[{id,short,name,weight,desc,commentPrompt,
--                            questions:[{key,text,groups?[]}] }] }
-- fs_campaigns(id, org_id not null, name, status default 'draft',
--   questionnaire_version_id not null, opens_at, closes_at,
--   anonymity_threshold int not null default 5, created_by, created_at,
--   thankyou_message, closed_message,
--   constraint fs_campaigns_threshold_floor check (anonymity_threshold >= 4))
-- fs_groups(id, campaign_id cascade, type, label, target_n)
-- fs_links(id, campaign_id cascade, group_id cascade, token unique,
--   mode check in ('group','unique') default 'group', max_uses, used_count
--   default 0, expires_at, active default true, created_at)
-- fs_responses(id, campaign_id cascade, group_id, link_id,
--   questionnaire_version_id, submitted_at default now(), valid default true,
--   meta jsonb default '{}' (only {ref} device token; user-agent removed per
--   audit F4), flag check in ('review','test'))
-- fs_answers(response_id, question_key, choice, value, not_scored)
-- fs_comments(response_id, pillar, body)
-- fs_consents(response_id, consented, policy_version)
-- fs_progress(id, campaign_id cascade, group_id cascade, link_id cascade,
--   client_ref, answered, total, started_at, last_seen,
--   unique(link_id, client_ref))
-- fs_interventions(library: trigger_type 'gap'|'band', pillar, band, gap_min,
--   summary, actions[], owner_suggestion, horizon, effort, impact, kpi,
--   iso_map, services[])
-- fs_actions(campaign_id, pillar, intervention_id, action_index, title,
--   status, owner, is_milestone, created_by, created_at, updated_at)
-- fs_audit(id, org_id, actor, action, entity, entity_id, at)
-- fs_finding_reviews(id, campaign_id cascade, rule_id, reviewed_by,
--   reviewed_at, unique(campaign_id, rule_id))
-- fs_reports(id, campaign_id cascade, title, rtype check in ('executive',
--   'findings_csv','results_csv','questions_csv','roadmap_csv'),
--   status default 'ready', created_by, created_at)

-- ============ RLS policies (as deployed) ============
-- All policies are TO authenticated; the anon key can read nothing.
-- fs_orgs:      select fs_is_member(id); update owner.
-- fs_memberships: select fs_is_member(org_id); ALL owner.
-- fs_campaigns: select member; insert/update owner,manager; delete owner.
-- fs_groups:    select member (via campaign); ALL owner,manager.
-- fs_links:     select member; ALL owner,manager.
-- fs_responses: select owner,manager,analyst; update owner,manager.
-- fs_answers:   select owner,manager,analyst (via response->campaign).
-- fs_comments:  select owner,manager,analyst.
-- fs_consents:  select owner,manager.
-- fs_progress:  select member.
-- fs_questionnaire_versions: select true (authenticated).
-- fs_interventions: select true (authenticated).
-- fs_actions:   select member; ALL owner,manager,analyst.
-- fs_audit:     insert member (org not null); select owner,manager.
-- fs_finding_reviews: select member; ALL owner,manager,analyst.
-- fs_reports:   select member; ALL owner,manager,analyst.

-- NOTE (Release Gate 1, open): raw fs_answers/fs_comments are still readable
-- by owner/manager/analyst below the anonymity threshold; move enforcement
-- into a server endpoint and restrict direct selects before first paid client.
