-- Postgres fires BEFORE-row triggers in alphabetical order by trigger name.
-- `fs_campaign_threshold_guard_bu` sorted ahead of `fs_campaigns_lock_guard_bu`
-- and normalised anonymity_threshold back to the governance value before the
-- lock guard ever saw a change — so an edit to a locked campaign was silently
-- swallowed instead of refused. Silence is the wrong answer here: the caller
-- must be told the setting is locked. The numeric prefix pins the ordering.

drop trigger if exists fs_campaigns_lock_guard_bu on public.fs_campaigns;
drop trigger if exists fs_00_campaigns_lock_guard_bu on public.fs_campaigns;
create trigger fs_00_campaigns_lock_guard_bu before update on public.fs_campaigns
  for each row execute function public.fs_campaigns_lock_guard();

comment on function public.fs_campaigns_lock_guard() is
  'Refuses edits to the frozen analytical contract of a campaign that has opened. Installed as fs_00_… so it runs before fs_campaign_threshold_guard_bu, which would otherwise normalise the value and mask the violation.';;
