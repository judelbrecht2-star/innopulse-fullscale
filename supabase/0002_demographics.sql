-- 0002 — Demographics system (applied 2026-07-18 as migrations
-- `fullscale_demographics` and `fullscale_create_campaign_demographics`).
--
-- Campaigns store which demographic dimensions to record (jsonb array of
-- {id, label, question, options[]}); responses store the respondent's
-- optional answers as {dimId: option}. Every cut is threshold-protected
-- server-side in fs-results (v8), exactly like stakeholder groups.

alter table fs_campaigns add column if not exists demographics jsonb;
alter table fs_responses  add column if not exists demo jsonb;

-- fs_create_campaign gains p_demographics (validated: <=8 dims, each with
-- id, label and >=2 options). Old 6-argument calls still resolve via the
-- default. The signature is now:
--
--   fs_create_campaign(p_org uuid, p_name text, p_qv uuid,
--     p_threshold integer, p_days integer, p_groups jsonb,
--     p_demographics jsonb default null) returns uuid
--     security definer, search_path = public
--
-- Edge functions updated alongside this migration:
--   fs-respond v7  — GET returns campaign.demographics; POST validates and
--                    stores body.demo against the configured options
--                    (values capped at 80 chars; unknown options dropped).
--                    Legacy single `segment` still accepted.
--   fs-results v8  — emits `demographics` (per-dimension, per-option cuts:
--                    n, pillar means, weighted index; suppressed below
--                    max(threshold, ANON_FLOOR=4); plus not_declared) and
--                    keeps the legacy `segments` output in sync by treating
--                    classic segments as a department pseudo-dimension.
