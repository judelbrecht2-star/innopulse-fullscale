-- Trigger functions have no business being reachable as PostgREST RPCs. They
-- are SECURITY DEFINER because they must write the mirrored column regardless
-- of the caller's RLS, not because anyone should call them directly.
revoke all on function public.fs_governance_clamp() from public, anon, authenticated;
revoke all on function public.fs_governance_mirror_to_campaign() from public, anon, authenticated;
revoke all on function public.fs_campaign_threshold_guard() from public, anon, authenticated;
revoke all on function public.fs_campaign_threshold_mirror() from public, anon, authenticated;
revoke all on function public.fs_org_settings_touch() from public, anon, authenticated;

-- Read helpers: signed-in members only. anon has no legitimate use for either.
revoke all on function public.fs_effective_thresholds(uuid) from public, anon;
grant execute on function public.fs_effective_thresholds(uuid) to authenticated, service_role;

revoke all on function public.fs_org_settings_ensure(uuid) from public, anon;
grant execute on function public.fs_org_settings_ensure(uuid) to authenticated, service_role;;
