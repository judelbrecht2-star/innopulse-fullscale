
create table if not exists fs_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references fs_campaigns(id) on delete cascade,
  title text not null,
  rtype text not null check (rtype in ('executive','findings_csv','results_csv','questions_csv','roadmap_csv')),
  status text not null default 'ready',
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table fs_reports enable row level security;
create policy fs_reports_select on fs_reports for select to authenticated
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_is_member(c.org_id)));
create policy fs_reports_write on fs_reports for all to authenticated
  using (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager','analyst'])))
  with check (exists (select 1 from fs_campaigns c where c.id = campaign_id and fs_role_in(c.org_id, array['owner','manager','analyst'])));
;
