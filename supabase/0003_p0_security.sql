-- 0003 — P0 security fixes (applied 2026-08-12)
--
-- P0-2  Anonymity threshold is absolute.
--       fs-responses-ops v5 removes the previous `role !== 'owner'` exemption
--       on individual response detail and on comment tagging. No role — owner
--       included — can read an individual response, or tag a comment, from a
--       group below max(campaign.anonymity_threshold, 4). Enforced in the edge
--       function; fs_answers / fs_comments already have no SELECT policy, so
--       the browser cannot reach the rows directly either.
--
-- P0-4  Atomic respondent-link rotation (below). Applied as migration
--       `fullscale_p0_atomic_link_rotation`.

alter table fs_links add column if not exists revoked_at timestamptz;
alter table fs_links add column if not exists revoked_by uuid;
alter table fs_links add column if not exists rotated_from uuid;

-- Data repair: the old non-atomic rotation had left 5 active links on one
-- demo group. Keep the link that had been used (else the oldest); revoke the rest.
with ranked as (
  select id, row_number() over (
      partition by campaign_id, group_id
      order by (coalesce(used_count,0) > 0) desc, created_at asc) as rn
  from fs_links where active and mode = 'group'
)
update fs_links l set active = false, revoked_at = now()
  from ranked r where l.id = r.id and r.rn > 1;

-- The database, not the application, now guarantees one active group link.
create unique index if not exists fs_links_one_active_group_link
  on fs_links (campaign_id, group_id) where active and mode = 'group';

create or replace function public.fs_rotate_link(p_campaign uuid, p_group uuid, p_mode text default 'group')
returns table (id uuid, token text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_org uuid; v_new_id uuid; v_new_token text; v_prev uuid; v_count int;
begin
  select org_id into v_org from fs_campaigns where fs_campaigns.id = p_campaign;
  if v_org is null then raise exception 'Campaign not found'; end if;
  if not fs_role_in(v_org, array['owner','manager']) then
    raise exception 'Only owners and managers can rotate respondent links'; end if;
  if p_mode not in ('group','unique') then raise exception 'Invalid link mode %', p_mode; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_campaign::text || coalesce(p_group::text,'') || p_mode, 0));
  with revoked as (
    update fs_links set active = false, revoked_at = now(), revoked_by = auth.uid()
     where campaign_id = p_campaign and mode = p_mode
       and (p_group is null or group_id = p_group) and active
    returning fs_links.id)
  select count(*), min(revoked.id) into v_count, v_prev from revoked;
  insert into fs_links (campaign_id, group_id, token, mode, active, rotated_from)
  values (p_campaign, p_group, encode(gen_random_bytes(16),'hex'), p_mode, true, v_prev)
  returning fs_links.id, fs_links.token into v_new_id, v_new_token;
  insert into fs_audit (org_id, actor, action, entity, entity_id)
  values (v_org, auth.uid(), 'link.rotate:revoked=' || v_count || ':mode=' || p_mode, 'fs_links', v_new_id);
  return query select v_new_id, v_new_token;
end $function$;

revoke all on function public.fs_rotate_link(uuid, uuid, text) from public, anon;
grant execute on function public.fs_rotate_link(uuid, uuid, text) to authenticated;

-- P0-5 (applied as edge function fs-results v9, no schema change):
--   Per-question group data is now keyed by fs_groups.id, not by group type.
--   Several custom groups can share the generic 'other' type, which silently
--   merged them in every comparison. A type alias is still emitted when a type
--   is unique among visible groups, so older frontends keep working.
--   Responses payloads carry schema:"id-keyed"; report snapshots written before
--   this are type-keyed and are read via the legacy fallback in app/lib/gaps.js.
