-- fs_org_settings has no INSERT policy by design: a settings row is not
-- something a client should be able to conjure for an arbitrary org. But the
-- /settings/* screens need a row to exist before they can edit one, and orgs
-- created before fs_org_settings existed have none. This SECURITY DEFINER
-- function creates the row on first read, for members of that org only.
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

-- Keep updated_at / updated_by honest on org settings, the same way governance
-- does, so the audit trail and the "last changed" line on screen agree.
create or replace function public.fs_org_settings_touch()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  -- Defaults are handed to new campaigns, so they carry the same hard floor.
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

-- Backfill a settings row for every existing org so the screens are never empty.
insert into fs_org_settings (org_id)
select o.id from fs_orgs o
  left join fs_org_settings s on s.org_id = o.id
 where s.org_id is null
on conflict (org_id) do nothing;;
