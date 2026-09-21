
-- Release Gate 1: campaign creation is one server-side transaction that
-- validates everything and creates the campaign as a DRAFT (explicit launch
-- happens on the campaign page). A failure at any step creates nothing.
create or replace function public.fs_create_campaign(
  p_org uuid, p_name text, p_qv uuid, p_threshold int, p_days int, p_groups jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_camp uuid; v_g jsonb; v_gid uuid; v_n int := 0; v_type text; v_label text; v_target int;
begin
  if not fs_role_in(p_org, array['owner','manager']) then
    raise exception 'Only owners and managers can create campaigns';
  end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Campaign name is required'; end if;
  if coalesce(p_threshold,0) < 4 then raise exception 'Anonymity threshold must be at least 4'; end if;
  if not exists (select 1 from fs_questionnaire_versions where id = p_qv) then
    raise exception 'Questionnaire version not found';
  end if;
  if p_groups is null or jsonb_array_length(p_groups) = 0 then
    raise exception 'Choose at least one stakeholder group';
  end if;

  insert into fs_campaigns (org_id, name, status, questionnaire_version_id,
    opens_at, closes_at, anonymity_threshold, created_by)
  values (p_org, trim(p_name), 'draft', p_qv,
    null, now() + make_interval(days => greatest(1, coalesce(p_days,30))),
    p_threshold, auth.uid())
  returning id into v_camp;

  for v_g in select * from jsonb_array_elements(p_groups) loop
    v_type := v_g->>'type'; v_label := coalesce(nullif(trim(v_g->>'label'),''), v_type);
    v_target := greatest(0, coalesce((v_g->>'target')::int, 0));
    if v_type not in ('executive','employee','customer','partner','other') then
      raise exception 'Invalid stakeholder type %', v_type;
    end if;
    insert into fs_groups (campaign_id, type, label, target_n)
    values (v_camp, v_type, v_label, v_target) returning id into v_gid;
    insert into fs_links (campaign_id, group_id, token, mode)
    values (v_camp, v_gid, encode(gen_random_bytes(8),'hex'), 'group');
    v_n := v_n + 1;
  end loop;

  insert into fs_audit (org_id, actor, action, entity, entity_id)
  values (p_org, auth.uid(), 'campaign.create:draft:'||v_n||'groups', 'fs_campaigns', v_camp);
  return v_camp;
end $$;
revoke execute on function public.fs_create_campaign(uuid,text,uuid,int,int,jsonb) from public, anon;
grant execute on function public.fs_create_campaign(uuid,text,uuid,int,int,jsonb) to authenticated;

-- launching a draft stamps the open time
create or replace function public.fs_open_campaign(p_camp uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select org_id into v_org from fs_campaigns where id = p_camp;
  if v_org is null then raise exception 'Campaign not found'; end if;
  if not fs_role_in(v_org, array['owner','manager']) then raise exception 'Not authorised'; end if;
  update fs_campaigns set status = 'open', opens_at = coalesce(opens_at, now()) where id = p_camp;
  insert into fs_audit (org_id, actor, action, entity, entity_id)
  values (v_org, auth.uid(), 'campaign.open', 'fs_campaigns', p_camp);
end $$;
revoke execute on function public.fs_open_campaign(uuid) from public, anon;
grant execute on function public.fs_open_campaign(uuid) to authenticated;
;
