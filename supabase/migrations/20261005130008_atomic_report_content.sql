-- Analyst-authored fields and five pillar notes save together, or not at all.
create function fs_private.save_report_content(p_campaign uuid,p_context text,p_objective text,p_notes jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid;v_pillar text;
begin
 select org_id into v_org from public.fs_campaigns where id=p_campaign;
 if auth.uid() is null or not public.fs_role_in(v_org,array['owner','manager','analyst']) then raise exception 'Report authoring access required.';end if;
 if length(coalesce(p_context,''))>10000 or length(coalesce(p_objective,''))>4000 or jsonb_typeof(p_notes) is distinct from 'object' then raise exception 'Check the report content.';end if;
 if exists(select 1 from jsonb_each(p_notes) n where n.key not in ('sii','iem','oic','ipm','roi') or jsonb_typeof(n.value) not in ('string','null') or length(n.value#>>'{}')>10000) then raise exception 'Check the pillar notes.';end if;
 update public.fs_campaigns set client_context=nullif(trim(p_context),''),engagement_objective=nullif(trim(p_objective),'') where id=p_campaign;
 foreach v_pillar in array array['sii','iem','oic','ipm','roi'] loop
   insert into public.fs_pillar_notes(campaign_id,pillar,body,updated_at) values(p_campaign,v_pillar,trim(coalesce(p_notes->>v_pillar,'')),now())
   on conflict(campaign_id,pillar) do update set body=excluded.body,updated_at=excluded.updated_at;
 end loop;
 perform public.fs_audit_log(v_org,'report.content_saved','fs_campaigns',p_campaign::text,p_campaign,null,jsonb_build_object('pillar_notes',5));
end $$;
revoke all on function fs_private.save_report_content(uuid,text,text,jsonb) from public,anon;
grant execute on function fs_private.save_report_content(uuid,text,text,jsonb) to authenticated;
create function public.fs_save_report_content(p_campaign uuid,p_context text,p_objective text,p_notes jsonb) returns void language sql security invoker set search_path='' as $$select fs_private.save_report_content(p_campaign,p_context,p_objective,p_notes)$$;
revoke all on function public.fs_save_report_content(uuid,text,text,jsonb) from public,anon;
grant execute on function public.fs_save_report_content(uuid,text,text,jsonb) to authenticated;
