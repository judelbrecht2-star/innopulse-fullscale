-- fs_campaign_governance had accumulated two parallel sets of CHECK
-- constraints: the originals created with the table, and the ones Phase 1 added
-- under different names. Postgres ANDs them, so the effective rule was the
-- intersection — and the intersection was wrong in three places:
--
--   privacy_profile   originals allowed 'high', Phase 1 'high_sensitivity'.
--                     Neither could ever be stored: the intersection excluded
--                     both. This is why applying the high-sensitivity profile
--                     failed.
--   distribution_mode originals 'unique_invitation', Phase 1 'individual_invite'.
--                     Same problem, latent until someone tried to use it.
--   max_filter_dims   originals capped at 3, Phase 1 at 8.
--
-- Keeping the Phase 1 vocabulary because it matches the settings specification
-- and the profile definitions in fs_privacy_profiles(). Dropping the originals
-- rather than the new ones, so there is exactly one rule per column.

alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_privacy_profile_check,
  drop constraint if exists fs_campaign_governance_distribution_mode_check,
  drop constraint if exists fs_campaign_governance_max_filter_dimensions_check,
  drop constraint if exists fs_campaign_governance_score_threshold_check,
  drop constraint if exists fs_campaign_governance_comment_threshold_check,
  drop constraint if exists fs_campaign_governance_suppression_mode_check,
  drop constraint if exists fs_campaign_governance_raw_export_policy_check;

-- comment_threshold >= 4 was only implied by comment >= score >= 4; keep it
-- explicit so the column stands on its own.
alter table public.fs_campaign_governance
  drop constraint if exists fs_campaign_governance_comment_floor,
  add constraint fs_campaign_governance_comment_floor check (comment_threshold >= 4);;
