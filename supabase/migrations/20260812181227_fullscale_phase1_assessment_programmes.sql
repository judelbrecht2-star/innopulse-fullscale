-- ===========================================================================
-- Phase 1 — the Assessment Programme becomes the long-lived unit.
-- A campaign is one measurement event inside a programme.
-- Existing campaigns are backfilled into a clearly-labelled migrated
-- programme per organisation; we do NOT fabricate historical framing.
-- ===========================================================================

create table if not exists fs_programmes (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references fs_orgs(id) on delete cascade,
  name                      text not null,
  description               text,
  status                    text not null default 'draft'
                              check (status in ('draft','active','paused','completed','archived')),
  programme_type            text,
  executive_sponsor_user_id uuid references auth.users(id) on delete set null,
  programme_owner_user_id   uuid references auth.users(id) on delete set null,
  assigned_analyst_user_id  uuid references auth.users(id) on delete set null,
  start_date                date,
  target_end_date           date,
  review_cadence            text check (review_cadence in ('monthly','quarterly','biannual','annual')),
  next_review_at            timestamptz,
  needs_owner_review        boolean not null default false, -- set on migrated rows
  created_at                timestamptz not null default now(),
  created_by                uuid references auth.users(id),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users(id)
);
create index if not exists fs_programmes_org on fs_programmes(org_id);
alter table fs_programmes enable row level security;
drop policy if exists fs_programmes_read on fs_programmes;
create policy fs_programmes_read on fs_programmes for select using (fs_is_member(org_id));
drop policy if exists fs_programmes_write on fs_programmes;
create policy fs_programmes_write on fs_programmes for all
  using (fs_role_in(org_id, array['owner','manager']))
  with check (fs_role_in(org_id, array['owner','manager']));

create table if not exists fs_strategic_objectives (
  id                 uuid primary key default gen_random_uuid(),
  programme_id       uuid not null references fs_programmes(id) on delete cascade,
  title              text not null,
  description        text,
  success_definition text,
  priority           int check (priority between 1 and 5),
  status             text not null default 'active'
                       check (status in ('active','achieved','deferred','dropped')),
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id)
);
create index if not exists fs_strategic_objectives_prog on fs_strategic_objectives(programme_id);
alter table fs_strategic_objectives enable row level security;
drop policy if exists fs_strategic_objectives_rw on fs_strategic_objectives;
create policy fs_strategic_objectives_rw on fs_strategic_objectives for all
  using (exists (select 1 from fs_programmes p where p.id = programme_id and fs_is_member(p.org_id)))
  with check (exists (select 1 from fs_programmes p where p.id = programme_id and fs_role_in(p.org_id, array['owner','manager'])));

create table if not exists fs_interested_parties (
  id                  uuid primary key default gen_random_uuid(),
  programme_id        uuid not null references fs_programmes(id) on delete cascade,
  name                text not null,
  party_type          text,
  interest            text,
  influence           text check (influence in ('low','medium','high')),
  engagement_approach text,
  owner_user_id       uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);
create index if not exists fs_interested_parties_prog on fs_interested_parties(programme_id);
alter table fs_interested_parties enable row level security;
drop policy if exists fs_interested_parties_rw on fs_interested_parties;
create policy fs_interested_parties_rw on fs_interested_parties for all
  using (exists (select 1 from fs_programmes p where p.id = programme_id and fs_is_member(p.org_id)))
  with check (exists (select 1 from fs_programmes p where p.id = programme_id and fs_role_in(p.org_id, array['owner','manager'])));

-- Direct FK on the campaign (nullable) — safer than a link table, and no
-- existing behaviour depends on it.
alter table fs_campaigns add column if not exists programme_id uuid references fs_programmes(id) on delete set null;
create index if not exists fs_campaigns_programme on fs_campaigns(programme_id);

-- BACKFILL: one migrated programme per organisation that already has campaigns.
insert into fs_programmes (org_id, name, description, status, needs_owner_review, created_at)
select o.id,
       'Innovation assessment programme (migrated)',
       'Created automatically when programmes were introduced. It groups campaigns that existed beforehand. Purpose, objectives, sponsor and review cadence were never recorded for these cycles — an owner should review and complete them.',
       'active', true, now()
from fs_orgs o
where exists (select 1 from fs_campaigns c where c.org_id = o.id)
  and not exists (select 1 from fs_programmes p where p.org_id = o.id and p.needs_owner_review);

update fs_campaigns c
   set programme_id = p.id
  from fs_programmes p
 where p.org_id = c.org_id
   and p.needs_owner_review
   and c.programme_id is null;

comment on column fs_campaigns.programme_id is
  'The assessment programme this measurement event belongs to. Nullable for now: existing campaigns were backfilled into a migrated programme flagged needs_owner_review.';;
