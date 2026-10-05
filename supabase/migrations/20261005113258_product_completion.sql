-- Complete assessment workflows without changing existing snapshots or memberships.
create schema if not exists fs_private;
revoke all on schema fs_private from public, anon, authenticated;

alter table public.fs_actions add column assigned_to uuid references auth.users(id) on delete set null,
  add column due_on date, add column notes text;
alter table public.fs_finding_reviews add column decision text not null default 'accepted'
  check (decision in ('accepted','edited','rejected')),
  add column edited_title text, add column edited_text text, add column decision_reason text;
alter table public.fs_reports add column approval_state text not null default 'legacy'
  check (approval_state in ('legacy','draft','pending','changes_requested','approved','issued')),
  add column approved_by uuid, add column approved_at timestamptz, add column issued_at timestamptz,
  add column decision_note text;
alter table public.fs_reports alter column approval_state set default 'draft';

create table public.fs_notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.fs_orgs(id) on delete cascade,
  actions boolean not null default true, reports boolean not null default true,
  closing boolean not null default true, results boolean not null default true,
  weekly boolean not null default true, primary key(user_id,org_id)
);
alter table public.fs_notification_preferences enable row level security;
revoke all on public.fs_notification_preferences from public,anon,authenticated;
grant select,insert,update on public.fs_notification_preferences to authenticated;
create policy notification_preferences_self on public.fs_notification_preferences for all to authenticated
 using (user_id=(select auth.uid()) and public.fs_is_member(org_id))
 with check (user_id=(select auth.uid()) and public.fs_is_member(org_id));

create table public.fs_notifications (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.fs_orgs(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, kind text not null,
 title text not null, body text not null, href text not null check(href like '/%' and href not like '//%'),
 dedupe_key text not null, created_at timestamptz not null default now(), read_at timestamptz,
 unique(user_id,org_id,dedupe_key)
);
create index fs_notifications_inbox on public.fs_notifications(user_id,org_id,created_at desc);
create index fs_actions_assignee on public.fs_actions(assigned_to,campaign_id) where assigned_to is not null;
create index fs_actions_due on public.fs_actions(due_on) where status <> 'done';
alter table public.fs_notifications enable row level security;
revoke all on public.fs_notifications from public,anon,authenticated;
grant select on public.fs_notifications to authenticated;
grant update(read_at) on public.fs_notifications to authenticated;
create policy notifications_self_read on public.fs_notifications for select to authenticated
 using (user_id=(select auth.uid()) and public.fs_is_member(org_id));
create policy notifications_self_update on public.fs_notifications for update to authenticated
 using (user_id=(select auth.uid()) and public.fs_is_member(org_id))
 with check (user_id=(select auth.uid()) and public.fs_is_member(org_id));

create table public.fs_report_events (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references public.fs_reports(id) on delete cascade,
 org_id uuid not null references public.fs_orgs(id) on delete cascade,
 actor uuid not null, from_state text, to_state text not null, note text, created_at timestamptz not null default now()
);
create index fs_report_events_report on public.fs_report_events(report_id,created_at);
alter table public.fs_report_events enable row level security;
revoke all on public.fs_report_events from public,anon,authenticated;
grant select on public.fs_report_events to authenticated;
create policy report_events_members on public.fs_report_events for select to authenticated
 using (public.fs_role_in(org_id,array['owner','manager','analyst']));

create or replace function public.fs_create_campaign_v3(p_org uuid,p_name text,p_objective text,p_qv uuid,p_threshold integer,p_days integer,p_groups jsonb,p_demographics jsonb default null,p_is_sandbox boolean default false)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 if length(trim(coalesce(p_objective,''))) not between 1 and 2000 or length(trim(p_name)) not between 1 and 160
    or p_days not between 1 and 365 or p_threshold not between 4 and 1000 then raise exception 'Check the assessment objective, collection window and privacy threshold.'; end if;
 v_id:=public.fs_create_campaign_v2(p_org,p_name,p_qv,p_threshold,p_days,p_groups,p_demographics,p_is_sandbox);
 update public.fs_campaigns set engagement_objective=trim(p_objective) where id=v_id;
 if not found then raise exception 'Could not save the assessment objective.'; end if;
 return v_id;
end $$;
revoke all on function public.fs_create_campaign_v3(uuid,text,text,uuid,integer,integer,jsonb,jsonb,boolean) from public,anon;
grant execute on function public.fs_create_campaign_v3(uuid,text,text,uuid,integer,integer,jsonb,jsonb,boolean) to authenticated;

-- Private lookup reads display labels only; authorization uses current memberships.
create function fs_private.team_directory(p_org uuid) returns table(user_id uuid,label text,role text)
 language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.fs_is_member(p_org) then raise exception 'Workspace access required.'; end if;
 return query select m.user_id,coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'full_name',''),split_part(u.email,'@',1),'Team member'),m.role
 from public.fs_memberships m join auth.users u on u.id=m.user_id left join public.fs_user_preferences p on p.user_id=m.user_id
 where m.org_id=p_org order by 2;
end $$;
revoke all on function fs_private.team_directory(uuid) from public,anon;
grant usage on schema fs_private to authenticated;
grant execute on function fs_private.team_directory(uuid) to authenticated;
create function public.fs_team_directory(p_org uuid) returns table(user_id uuid,label text,role text) language sql security invoker set search_path='' as $$select * from fs_private.team_directory(p_org)$$;
revoke all on function public.fs_team_directory(uuid) from public,anon;
grant execute on function public.fs_team_directory(uuid) to authenticated;

create function fs_private.validate_action() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
 select org_id into v_org from public.fs_campaigns where id=new.campaign_id;
 if auth.uid() is null or not public.fs_role_in(v_org,array['owner','manager','analyst']) then raise exception 'Action editing requires an assessment team role.'; end if;
 if new.assigned_to is not null and not exists(select 1 from public.fs_memberships where org_id=v_org and user_id=new.assigned_to and role in ('owner','manager','analyst')) then raise exception 'Assign an action to an assessment team member in this workspace.'; end if;
 if length(coalesce(new.notes,''))>4000 or length(coalesce(new.title,''))>2000 then raise exception 'Action text is too long.'; end if;
 new.updated_at:=now();
 return new;
end $$;
revoke all on function fs_private.validate_action() from public,anon,authenticated;
create trigger fs_actions_validate_completion before insert or update on public.fs_actions for each row execute function fs_private.validate_action();

create function fs_private.validate_finding_decision() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
 select org_id into v_org from public.fs_campaigns where id=new.campaign_id;
 if auth.uid() is null or not public.fs_role_in(v_org,array['owner','manager','analyst']) then raise exception 'Analyst review access required.';end if;
 if new.decision='rejected' and length(trim(coalesce(new.decision_reason,'')))=0 then raise exception 'A rejection reason is required.';end if;
 if new.decision='edited' and (length(trim(coalesce(new.edited_title,'')))=0 or length(trim(coalesce(new.edited_text,'')))=0) then raise exception 'An edited title and conclusion are required.';end if;
 if length(coalesce(new.edited_title,''))>300 or length(coalesce(new.edited_text,''))>4000 or length(coalesce(new.decision_reason,''))>2000 then raise exception 'Review text is too long.';end if;
 new.reviewed_by:=auth.uid();new.reviewed_at:=now();return new;
end $$;
revoke all on function fs_private.validate_finding_decision() from public,anon,authenticated;
create trigger fs_finding_reviews_validate_completion before insert or update on public.fs_finding_reviews for each row execute function fs_private.validate_finding_decision();

-- Serialize version allocation and freeze every report snapshot, including after approval.
create function fs_private.guard_report() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_name text; v_sandbox boolean;
begin
 select org_id,name,is_sandbox into v_org,v_name,v_sandbox from public.fs_campaigns where id=coalesce(new.campaign_id,old.campaign_id);
 if auth.uid() is null or not public.fs_role_in(v_org,array['owner','manager','analyst']) then raise exception 'Report editing requires an assessment team role.'; end if;
 if tg_op='DELETE' then
   if old.approval_state in ('approved','issued') then raise exception 'Approved reports are retained. Create a new version instead.'; end if;
   return old;
 end if;
 if tg_op='INSERT' then
   if v_sandbox then raise exception 'Sandbox campaigns cannot generate official reports.'; end if;
   if new.snapshot is null or jsonb_typeof(new.snapshot)<>'object' or new.snapshot->'campaign'->>'id' is distinct from new.campaign_id::text then raise exception 'A matching report snapshot is required.'; end if;
   if jsonb_typeof(new.snapshot->'findings') is distinct from 'array' then raise exception 'A reviewed findings array is required.';end if;
   if exists(select 1 from jsonb_array_elements(new.snapshot->'findings') f where not exists(select 1 from public.fs_finding_reviews r where r.campaign_id=new.campaign_id and r.rule_id=f->>'id' and r.decision in ('accepted','edited'))) then raise exception 'Every included finding must have an accepted analyst decision.';end if;
   perform pg_advisory_xact_lock(hashtextextended(new.campaign_id::text||':'||new.rtype,0));
   select coalesce(max(r.version),0)+1 into new.version from public.fs_reports r where r.campaign_id=new.campaign_id and r.rtype=new.rtype;
   new.title:=v_name||' — '||replace(new.rtype,'_',' ')||' report v'||new.version;
   new.checksum:=encode(sha256(convert_to(new.snapshot::text,'UTF8')),'hex');
   new.created_by:=auth.uid();new.created_at:=now();new.approval_state:='draft';new.approved_by:=null;new.approved_at:=null;new.issued_at:=null;new.decision_note:=null;
 else
   if (to_jsonb(new)-array['approval_state','approved_by','approved_at','issued_at','decision_note']) is distinct from (to_jsonb(old)-array['approval_state','approved_by','approved_at','issued_at','decision_note']) then raise exception 'Saved report versions are immutable. Generate a new version.'; end if;
   if new.approval_state=old.approval_state then raise exception 'Choose a report workflow decision.'; end if;
   if old.approval_state in ('draft','changes_requested') and new.approval_state='pending' then null;
   elsif old.approval_state='pending' and new.approval_state in ('approved','changes_requested') and public.fs_role_in(v_org,array['owner','manager']) then
     if new.approval_state='changes_requested' and length(trim(coalesce(new.decision_note,'')))=0 then raise exception 'Explain the changes needed.'; end if;
   elsif old.approval_state='approved' and new.approval_state='issued' and public.fs_role_in(v_org,array['owner','manager']) then null;
   else raise exception 'This report decision is not permitted for your role or the current state.'; end if;
   new.approved_by:=old.approved_by;new.approved_at:=old.approved_at;new.issued_at:=old.issued_at;
   if new.approval_state='approved' then
     perform public.fs_require_aal2(v_org,'report.approve');
     new.approved_by:=auth.uid();new.approved_at:=now();
   elsif new.approval_state='issued' then new.issued_at:=now(); end if;
 end if;
 return new;
end $$;
revoke all on function fs_private.guard_report() from public,anon,authenticated;
create trigger fs_reports_guard_completion before insert or update or delete on public.fs_reports for each row execute function fs_private.guard_report();
drop policy fs_reports_select on public.fs_reports;
create policy fs_reports_select on public.fs_reports for select to authenticated using(exists(select 1 from public.fs_campaigns c where c.id=campaign_id and public.fs_is_member(c.org_id) and (public.fs_role_in(c.org_id,array['owner','manager','analyst']) or approval_state in ('approved','issued'))));

create function fs_private.record_report_event() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
 select org_id into v_org from public.fs_campaigns where id=new.campaign_id;
 insert into public.fs_report_events(report_id,org_id,actor,from_state,to_state,note) values(new.id,v_org,auth.uid(),case when tg_op='UPDATE' then old.approval_state end,new.approval_state,new.decision_note);
 perform public.fs_audit_log(v_org,'report.'||new.approval_state,'fs_reports',new.id::text,new.campaign_id,null,jsonb_build_object('version',new.version,'checksum',new.checksum),new.decision_note);
 insert into public.fs_notifications(org_id,user_id,kind,title,body,href,dedupe_key)
 select v_org,m.user_id,'reports','Report '||replace(new.approval_state,'_',' '),new.title,'/reports?campaign='||new.campaign_id,'report:'||new.id||':'||new.approval_state||':'||extract(epoch from now())
 from public.fs_memberships m left join public.fs_notification_preferences p on p.user_id=m.user_id and p.org_id=m.org_id
 where m.org_id=v_org and coalesce(p.reports,true) and (m.role in ('owner','manager','analyst') or new.approval_state in ('approved','issued'))
 on conflict(user_id,org_id,dedupe_key) do nothing;
 return new;
end $$;
revoke all on function fs_private.record_report_event() from public,anon,authenticated;
create trigger fs_reports_event_completion after insert or update on public.fs_reports for each row execute function fs_private.record_report_event();

create function fs_private.notify_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare v_org uuid;
begin
 if new.assigned_to is not null and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then
   select org_id into v_org from public.fs_campaigns where id=new.campaign_id;
   if coalesce((select actions from public.fs_notification_preferences where org_id=v_org and user_id=new.assigned_to),true) then
     insert into public.fs_notifications(org_id,user_id,kind,title,body,href,dedupe_key)
     values(v_org,new.assigned_to,'actions','An action is assigned to you',new.title,'/actions','assignment:'||new.id||':'||extract(epoch from now()))
     on conflict(user_id,org_id,dedupe_key) do nothing;
   end if;
 end if;
 return new;
end $$;
revoke all on function fs_private.notify_assignment() from public,anon,authenticated;
create trigger fs_actions_assignment_completion after insert or update on public.fs_actions for each row execute function fs_private.notify_assignment();

create function public.fs_assign_intervention(p_campaign uuid,p_intervention uuid,p_assignee uuid) returns void language plpgsql security invoker set search_path='' as $$
declare v_org uuid;v_pillar text;v_actions jsonb;v_owner text;item text;i integer:=0;
begin
 select org_id into v_org from public.fs_campaigns where id=p_campaign;
 if auth.uid() is null or not public.fs_role_in(v_org,array['owner','manager','analyst']) then raise exception 'Assessment team access required.';end if;
 if p_assignee is not null then select label into v_owner from public.fs_team_directory(v_org) where user_id=p_assignee and role in ('owner','manager','analyst');if not found then raise exception 'Choose an assessment team member.';end if;end if;
 select pillar,to_jsonb(actions) into v_pillar,v_actions from public.fs_interventions where id=p_intervention;
 if not found then raise exception 'Intervention not found.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_campaign::text||':'||p_intervention::text,0));
 for item in select jsonb_array_elements_text(v_actions) loop
   update public.fs_actions set assigned_to=p_assignee,owner=v_owner where campaign_id=p_campaign and intervention_id=p_intervention and action_index=i;
   if not found then insert into public.fs_actions(campaign_id,intervention_id,pillar,action_index,title,created_by,assigned_to,owner) values(p_campaign,p_intervention,v_pillar,i,item,auth.uid(),p_assignee,v_owner);end if;
   i:=i+1;
 end loop;
end $$;
revoke all on function public.fs_assign_intervention(uuid,uuid,uuid) from public,anon;
grant execute on function public.fs_assign_intervention(uuid,uuid,uuid) to authenticated;

-- Refresh creates an inbox once per event, with no answer text or respondent identity.
create function fs_private.refresh_notifications(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_today date;v_zone text;v_p public.fs_notification_preferences;
begin
 if v_user is null or not public.fs_is_member(p_org) then raise exception 'Workspace access required.';end if;
 select timezone into v_zone from public.fs_org_settings where org_id=p_org;
 v_today:=(now() at time zone coalesce(v_zone,'Africa/Johannesburg'))::date;
 insert into public.fs_notification_preferences(user_id,org_id) values(v_user,p_org) on conflict do nothing;
 select * into v_p from public.fs_notification_preferences where user_id=v_user and org_id=p_org;
 if v_p.actions then
 insert into public.fs_notifications(org_id,user_id,kind,title,body,href,dedupe_key)
 select p_org,v_user,'actions',case when a.due_on<v_today then 'Action overdue' else 'Action due today' end,a.title,'/actions','due:'||a.id||':'||a.due_on
 from public.fs_actions a join public.fs_campaigns c on c.id=a.campaign_id where c.org_id=p_org and a.assigned_to=v_user and a.status<>'done' and a.due_on<=v_today
 on conflict(user_id,org_id,dedupe_key) do nothing;
 end if;
 if v_p.closing then
 insert into public.fs_notifications(org_id,user_id,kind,title,body,href,dedupe_key)
 select p_org,v_user,'closing','Collection closes soon',c.name,'/campaigns/'||c.id,'closing:'||c.id||':'||c.closes_at
 from public.fs_campaigns c where c.org_id=p_org and not c.is_sandbox and c.status='open' and c.closes_at between now() and now()+interval '3 days'
 on conflict(user_id,org_id,dedupe_key) do nothing;
 end if;
 if v_p.results and public.fs_role_in(p_org,array['owner','manager','analyst']) then
 insert into public.fs_notifications(org_id,user_id,kind,title,body,href,dedupe_key)
 select p_org,v_user,'results','Response milestone reached',c.name||' has reached its group privacy threshold. Review the available results; comparison cuts may still be protected.','/insights?campaign='||c.id,'results:'||c.id
 from public.fs_campaigns c where c.org_id=p_org and not c.is_sandbox and exists(select 1 from public.fs_groups g where g.campaign_id=c.id and (select count(*) from public.fs_responses r where r.group_id=g.id and r.valid)>=c.anonymity_threshold)
 on conflict(user_id,org_id,dedupe_key) do nothing;
 end if;
 if v_p.weekly then
 insert into public.fs_notifications(org_id,user_id,kind,title,body,href,dedupe_key)
 values(p_org,v_user,'weekly','Your weekly workspace review','Review campaign progress, assigned actions and approved reports.','/dashboard','weekly:'||date_trunc('week',v_today::timestamp)::date)
 on conflict(user_id,org_id,dedupe_key) do nothing;
 end if;
end $$;
revoke all on function fs_private.refresh_notifications(uuid) from public,anon;
grant execute on function fs_private.refresh_notifications(uuid) to authenticated;
create function public.fs_refresh_notifications(p_org uuid) returns void language sql security invoker set search_path='' as $$select fs_private.refresh_notifications(p_org)$$;
revoke all on function public.fs_refresh_notifications(uuid) from public,anon;
grant execute on function public.fs_refresh_notifications(uuid) to authenticated;
