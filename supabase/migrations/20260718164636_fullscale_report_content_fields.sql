
-- Step 3: authored report content + curated verbatims
alter table fs_campaigns add column if not exists client_context text;
alter table fs_campaigns add column if not exists engagement_objective text;
alter table fs_comments add column if not exists in_report boolean not null default false;

create table if not exists fs_pillar_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references fs_campaigns(id) on delete cascade,
  pillar text not null,
  body text not null default '',
  updated_at timestamptz not null default now(),
  unique (campaign_id, pillar)
);
alter table fs_pillar_notes enable row level security;
create policy fs_pn_select on fs_pillar_notes for select to authenticated
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_is_member(c.org_id)));
create policy fs_pn_write on fs_pillar_notes for all to authenticated
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager','analyst'])))
  with check (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager','analyst'])));
;
