-- 0005 — support for the /settings/* routes
--        (applied 2026-08-12 as migration `org_settings_ensure_rpc`)
--
-- fs_org_settings deliberately has no INSERT policy: a client should not be
-- able to conjure a settings row for an arbitrary org. But the settings screens
-- need a row to edit, and orgs created before fs_org_settings existed have
-- none. fs_org_settings_ensure() creates it on first read, for members only,
-- and re-checks membership itself rather than trusting the caller.
--
-- The touch trigger keeps updated_at/updated_by honest and applies the same
-- hard floor to the org-level defaults that fs_campaign_governance applies to a
-- campaign — otherwise an org default of 2 would silently be clamped only at
-- campaign-creation time, and the settings screen would show a number the
-- platform would never actually honour.

create or replace function public.fs_org_settings_ensure(p_org uuid)
returns public.fs_org_settings
language plpgsql security definer set search_path to 'public' as $$
declare v public.fs_org_settings;
begin
  if not fs_is_member(p_org) then
    raise exception 'Not a member of this organisation';
  end if;
  select * into v from fs_org_settings where org_id = p_org;
  if not found then
    insert into fs_org_settings (org_id) values (p_org)
    on conflict (org_id) do nothing;
    select * into v from fs_org_settings where org_id = p_org;
  end if;
  return v;
end $$;

revoke all on function public.fs_org_settings_ensure(uuid) from public;
grant execute on function public.fs_org_settings_ensure(uuid) to authenticated, service_role;

create or replace function public.fs_org_settings_touch()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.default_score_threshold   := greatest(coalesce(new.default_score_threshold, 5), 4);
  new.default_comment_threshold := greatest(coalesce(new.default_comment_threshold, new.default_score_threshold), new.default_score_threshold);
  new.default_max_filter_dimensions := least(greatest(coalesce(new.default_max_filter_dimensions, 2), 1), 8);
  new.default_campaign_duration_days := least(greatest(coalesce(new.default_campaign_duration_days, 30), 1), 365);
  return new;
end $$;

drop trigger if exists fs_org_settings_touch_bu on public.fs_org_settings;
create trigger fs_org_settings_touch_bu
  before update on public.fs_org_settings
  for each row execute function public.fs_org_settings_touch();

insert into fs_org_settings (org_id)
select o.id from fs_orgs o
  left join fs_org_settings s on s.org_id = o.id
 where s.org_id is null
on conflict (org_id) do nothing;
