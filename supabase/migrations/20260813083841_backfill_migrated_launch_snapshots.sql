-- Phase 1 — give campaigns that opened before snapshots existed a launch record.
--
-- These snapshots are reconstructed from today's values, not from what was
-- actually in force on the day each campaign opened. The provenance block says
-- so explicitly and lists the fields that genuinely cannot be recovered. Do not
-- treat a migrated snapshot as evidence of the original configuration; treat it
-- as the best available reconstruction, clearly labelled.

do $$
declare r record; v_config jsonb; v_hash text; v_unknown jsonb;
begin
  for r in
    select c.id, c.org_id, c.status, c.opens_at
      from fs_campaigns c
      left join fs_campaign_config_snapshots s
             on s.campaign_id = c.id and s.snapshot_type = 'launch'
     where c.status <> 'draft' and s.id is null
  loop
    v_unknown := jsonb_build_array();
    if (select confidentiality_notice is null from fs_campaigns where id = r.id) then
      v_unknown := v_unknown || to_jsonb('respondent.confidentiality_notice — no such field existed at launch'::text);
    end if;
    if not exists (select 1 from fs_campaign_assignments a where a.campaign_id = r.id) then
      v_unknown := v_unknown || to_jsonb('assignments — campaign assignments did not exist at launch'::text);
    end if;
    v_unknown := v_unknown || to_jsonb('privacy.comment_threshold — a single anonymity_threshold was in force; score and comment were not separable'::text);
    v_unknown := v_unknown || to_jsonb('scoring.rulebook — recorded as the current rulebook, not verified against the one that ran'::text);

    v_config := fs_build_campaign_config(r.id) || jsonb_build_object(
      'provenance', jsonb_build_object(
        'source', 'migrated',
        'captured_at', now(),
        'captured_by', null,
        'note', 'Reconstructed from current values during the Phase 1 settings migration. The campaign opened before configuration snapshots existed.',
        'campaign_status_at_migration', r.status,
        'opened_at', r.opens_at,
        'not_recoverable', v_unknown
      ));
    v_hash := fs_campaign_config_hash(v_config);

    insert into fs_campaign_config_snapshots (campaign_id, version, snapshot_type, config, config_hash, created_by)
    values (r.id,
            (select coalesce(max(version), 0) + 1 from fs_campaign_config_snapshots where campaign_id = r.id),
            'launch', v_config, v_hash, null);

    -- A campaign that has collected responses must not have its analytical
    -- contract edited, whether or not it was opened through the new RPC.
    update fs_campaign_governance
       set locked_at = coalesce(locked_at, coalesce(r.opens_at, now()))
     where campaign_id = r.id;

    insert into fs_audit (org_id, action, entity, entity_id, campaign_id, after_value, reason)
    values (r.org_id, 'campaign.snapshot:migrated', 'fs_campaign_config_snapshots', r.id::text, r.id,
            jsonb_build_object('config_hash', v_hash, 'snapshot_type', 'launch', 'provenance', 'migrated'),
            'Phase 1 backfill: reconstructed launch snapshot for a campaign that opened before snapshots existed.');
  end loop;
end $$;;
