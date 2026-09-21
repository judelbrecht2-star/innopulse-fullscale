drop function if exists public.fs_create_campaign(uuid, text, uuid, integer, integer, jsonb);

create or replace function public.fs_create_campaign(
  p_org uuid, p_name text, p_qv uuid, p_threshold integer, p_days integer,
  p_groups jsonb, p_demographics jsonb default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_camp uuid; v_g jsonb; v_gid uuid; v_n int := 0; v_type text; v_label text; v_target int;
  v_d jsonb; v_demo jsonb := null;
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

  -- validate demographics config: array of {id, label, question, options[]}
  if p_demographics is not null and jsonb_typeof(p_demographics) = 'array' and jsonb_array_length(p_demographics) > 0 then
    if jsonb_array_length(p_demographics) > 8 then
      raise exception 'At most 8 demographic dimensions';
    end if;
    for v_d in select * from jsonb_array_elements(p_demographics) loop
      if coalesce(trim(v_d->>'id'),'') = '' or coalesce(trim(v_d->>'label'),'') = ''
         or jsonb_typeof(v_d->'options') <> 'array' or jsonb_array_length(v_d->'options') < 2 then
        raise exception 'Each demographic dimension needs an id, a label and at least 2 options';
      end if;
    end loop;
    v_demo := p_demographics;
  end if;

  insert into fs_campaigns (org_id, name, status, questionnaire_version_id,
    opens_at, closes_at, anonymity_threshold, created_by, demographics)
  values (p_org, trim(p_name), 'draft', p_qv,
    null, now() + make_interval(days => greatest(1, coalesce(p_days,30))),
    p_threshold, auth.uid(), v_demo)
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
end $function$;;
