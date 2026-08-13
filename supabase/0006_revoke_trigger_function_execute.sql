-- 0006 — close the RPC surface opened by 0004/0005
--        (applied 2026-08-12 as migration `revoke_execute_on_trigger_functions`)
--
-- Supabase exposes every function in `public` as a PostgREST RPC. A SECURITY
-- DEFINER trigger function left with the default PUBLIC execute grant is
-- therefore callable by anyone with the anon key. These five are SECURITY
-- DEFINER because they must write a mirrored column regardless of the caller's
-- RLS — not because anyone should invoke them directly. Revoking EXECUTE does
-- not affect trigger firing: Postgres does not check EXECUTE privilege when a
-- trigger runs. Verified after apply by updating governance and watching the
-- mirror still move.
--
-- Reported by the Supabase database linter as
-- 0028_anon_security_definer_function_executable and
-- 0029_authenticated_security_definer_function_executable.

revoke all on function public.fs_governance_clamp() from public, anon, authenticated;
revoke all on function public.fs_governance_mirror_to_campaign() from public, anon, authenticated;
revoke all on function public.fs_campaign_threshold_guard() from public, anon, authenticated;
revoke all on function public.fs_campaign_threshold_mirror() from public, anon, authenticated;
revoke all on function public.fs_org_settings_touch() from public, anon, authenticated;

-- Read helpers: signed-in members only, membership re-checked inside each one.
revoke all on function public.fs_effective_thresholds(uuid) from public, anon;
grant execute on function public.fs_effective_thresholds(uuid) to authenticated, service_role;

revoke all on function public.fs_org_settings_ensure(uuid) from public, anon;
grant execute on function public.fs_org_settings_ensure(uuid) to authenticated, service_role;

-- Still outstanding on this project, pre-existing and not introduced here:
--   fs_is_member, fs_role_in, fs_create_campaign, fs_open_campaign,
--   fs_rotate_link, handle_new_user, is_admin, tg_attio_sync
-- all remain executable by anon and/or authenticated. Each re-checks
-- authorisation internally, so none is an open door, but the anon grants on
-- fs_is_member / fs_role_in / handle_new_user / tg_attio_sync are worth
-- revoking in a follow-up.
