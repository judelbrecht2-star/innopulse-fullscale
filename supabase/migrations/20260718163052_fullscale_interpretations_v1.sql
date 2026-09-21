
create table if not exists fs_interpretations (
  id uuid primary key default gen_random_uuid(),
  scope text not null,           -- 'overall' | 'sii' | 'iem' | 'oic' | 'ipm' | 'roi'
  band text not null check (band in ('low','med','high')),
  body text not null,
  version int not null default 1,
  unique (scope, band, version)
);
alter table fs_interpretations enable row level security;
create policy fs_interp_select on fs_interpretations for select to authenticated using (true);
;
