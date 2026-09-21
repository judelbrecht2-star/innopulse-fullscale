
create table if not exists fs_finding_reviews (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references fs_campaigns(id) on delete cascade,
  rule_id text not null,
  reviewed_by uuid,
  reviewed_at timestamptz not null default now(),
  unique (campaign_id, rule_id)
);
alter table fs_finding_reviews enable row level security;
create policy fs_frev_select on fs_finding_reviews for select to authenticated
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_is_member(c.org_id)));
create policy fs_frev_write on fs_finding_reviews for all to authenticated
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager','analyst'])))
  with check (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager','analyst'])));
;
