-- Phase 1 — the audit spine.
-- fs_audit recorded who did what, but not what changed, why, or under what
-- authentication strength. It was also mutable. Both are fixed here.

alter table public.fs_audit add column if not exists campaign_id uuid;
alter table public.fs_audit add column if not exists before_value jsonb;
alter table public.fs_audit add column if not exists after_value jsonb;
alter table public.fs_audit add column if not exists reason text;
alter table public.fs_audit add column if not exists correlation_id uuid;
alter table public.fs_audit add column if not exists actor_aal text;

create index if not exists fs_audit_org_at_idx on public.fs_audit (org_id, at desc);
create index if not exists fs_audit_campaign_idx on public.fs_audit (campaign_id) where campaign_id is not null;

comment on column public.fs_audit.before_value is 'Redacted prior value. Never contains credentials, tokens, answers or comment bodies — fs_audit_redact() strips them.';
comment on column public.fs_audit.actor_aal is 'Authenticator assurance level of the session that performed the action (aal1 / aal2), captured at write time.';

-- 1. Authentication strength ---------------------------------------------------
create or replace function public.fs_current_aal()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1');
$$;

-- Warn-mode AAL2 gate. Hard-fails once an org has at least one verified TOTP
-- factor, or once fs_org_settings.session_policy->>'enforce_aal2' is 'true'.
-- Rationale: hard-failing on day one would lock a sole owner with no
-- authenticator out of their own tenant. Every bypass is audited, so the gap is
-- visible rather than silent.
create or replace function public.fs_require_aal2(p_org uuid, p_action text)
returns void language plpgsql security definer set search_path to 'public', 'auth' as $$
declare v_aal text; v_enforce boolean; v_has_factor boolean;
begin
  v_aal := fs_current_aal();
  if v_aal = 'aal2' then return; end if;

  select coalesce((session_policy ->> 'enforce_aal2')::boolean, false) into v_enforce
    from fs_org_settings where org_id = p_org;

  select exists (
    select 1 from auth.mfa_factors f
     join fs_memberships m on m.user_id = f.user_id
    where m.org_id = p_org and f.status = 'verified'
  ) into v_has_factor;

  if coalesce(v_enforce, false) or coalesce(v_has_factor, false) then
    raise exception 'This action requires two-factor authentication. Sign in again with your authenticator app, then retry.'
      using errcode = '42501';
  end if;

  -- Allowed, but recorded: this is the enforcement gap, made countable.
  insert into fs_audit (org_id, actor, action, entity, entity_id, actor_aal, reason)
  values (p_org, auth.uid(), 'security.aal2_bypassed:' || p_action, 'fs_org_settings', p_org::text, v_aal,
          'No verified authenticator exists in this organisation yet; AAL2 is in warn-mode.');
end $$;

-- 2. Redaction -----------------------------------------------------------------
-- A denylist of keys that must never reach the audit log, whatever a caller
-- passes. Applied to both before and after values.
create or replace function public.fs_audit_redact(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare k text; out_j jsonb; banned text[] := array[
  'password','new_password','current_password','secret','totp','totp_secret','mfa_secret',
  'token','tokens','access_token','refresh_token','api_key','apikey','authorization',
  'answers','answer','value','choice','comment','comments','body','verbatim','verbatims',
  'email_body','recovery_codes'
];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return p; end if;
  out_j := p;
  for k in select jsonb_object_keys(p) loop
    if lower(k) = any (banned) then
      out_j := jsonb_set(out_j, array[k], '"[redacted]"'::jsonb);
    elsif jsonb_typeof(p -> k) = 'object' then
      out_j := jsonb_set(out_j, array[k], fs_audit_redact(p -> k));
    end if;
  end loop;
  return out_j;
end $$;

-- 3. The one way to write an audit record --------------------------------------
create or replace function public.fs_audit_log(
  p_org uuid, p_action text, p_entity text, p_entity_id text,
  p_campaign uuid default null, p_before jsonb default null, p_after jsonb default null,
  p_reason text default null, p_correlation uuid default null
) returns bigint language plpgsql security definer set search_path to 'public' as $$
declare v_id bigint;
begin
  insert into fs_audit (org_id, actor, action, entity, entity_id, campaign_id,
                        before_value, after_value, reason, correlation_id, actor_aal)
  values (p_org, auth.uid(), p_action, p_entity, p_entity_id, p_campaign,
          fs_audit_redact(p_before), fs_audit_redact(p_after), nullif(trim(coalesce(p_reason,'')),''),
          coalesce(p_correlation, gen_random_uuid()), fs_current_aal())
  returning id into v_id;
  return v_id;
end $$;

-- 4. Append-only ---------------------------------------------------------------
-- RLS already grants no UPDATE or DELETE to any client role, but service_role
-- and the definer functions bypass RLS. A trigger does not care who you are.
create or replace function public.fs_audit_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'fs_audit is append-only: % is not permitted on an audit record', tg_op
    using errcode = '42501';
end $$;

drop trigger if exists fs_audit_no_update on public.fs_audit;
create trigger fs_audit_no_update before update on public.fs_audit
  for each row execute function public.fs_audit_append_only();

drop trigger if exists fs_audit_no_delete on public.fs_audit;
create trigger fs_audit_no_delete before delete on public.fs_audit
  for each row execute function public.fs_audit_append_only();

-- Redact anything a client inserts directly, too — the app still writes some
-- audit rows through PostgREST, and they must obey the same denylist.
create or replace function public.fs_audit_redact_on_insert()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.before_value := fs_audit_redact(new.before_value);
  new.after_value  := fs_audit_redact(new.after_value);
  new.actor_aal    := coalesce(new.actor_aal, fs_current_aal());
  new.correlation_id := coalesce(new.correlation_id, gen_random_uuid());
  return new;
end $$;

drop trigger if exists fs_audit_redact_bi on public.fs_audit;
create trigger fs_audit_redact_bi before insert on public.fs_audit
  for each row execute function public.fs_audit_redact_on_insert();

revoke all on function public.fs_audit_append_only() from public, anon, authenticated;
revoke all on function public.fs_audit_redact_on_insert() from public, anon, authenticated;
revoke all on function public.fs_audit_redact(jsonb) from public, anon, authenticated;
revoke all on function public.fs_audit_log(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid) from public, anon;
grant execute on function public.fs_audit_log(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid) to authenticated, service_role;
revoke all on function public.fs_current_aal() from public, anon;
grant execute on function public.fs_current_aal() to authenticated, service_role;
revoke all on function public.fs_require_aal2(uuid, text) from public, anon, authenticated;;
