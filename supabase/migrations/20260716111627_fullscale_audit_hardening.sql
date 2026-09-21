
-- F13: atomic link claim (single-statement increment + max_uses check)
create or replace function public.fs_use_link(p_link uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with upd as (
    update fs_links
       set used_count = used_count + 1
     where id = p_link
       and active = true
       and (max_uses is null or used_count < max_uses)
    returning id
  )
  select exists(select 1 from upd);
$$;
-- only the service role (edge functions) should call this
revoke execute on function public.fs_use_link(uuid) from public, anon, authenticated;

-- release a claimed slot if the response insert fails afterwards
create or replace function public.fs_release_link(p_link uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update fs_links set used_count = greatest(0, used_count - 1) where id = p_link;
$$;
revoke execute on function public.fs_release_link(uuid) from public, anon, authenticated;

-- F14: fs helpers are only referenced by policies restricted TO authenticated,
-- so anon never needs EXECUTE on them.
revoke execute on function public.fs_is_member(uuid) from anon;
revoke execute on function public.fs_role_in(uuid, text[]) from anon;

-- F14: pin mutable search_paths flagged by the advisor (no behaviour change)
alter function public.is_admin() set search_path = public;
alter function public.handle_new_user() set search_path = public;

-- F1: server-side floor — no campaign may report below 4, regardless of settings
alter table fs_campaigns add constraint fs_campaigns_threshold_floor check (anonymity_threshold >= 4) not valid;
;
