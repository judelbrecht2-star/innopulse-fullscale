create table if not exists public.fs_interventions (
  id uuid primary key default gen_random_uuid(),
  pillar text not null,                 -- sii/iem/oic/ipm/roi
  trigger_type text not null check (trigger_type in ('band','gap')),
  band text check (band in ('low','medium','high')),
  gap_min numeric,                      -- minimum exec-vs-employee gap to trigger
  risk text,                            -- likely organisational risk (barrier)
  summary text not null,                -- one-line finding wording
  actions jsonb not null default '[]'::jsonb,
  services jsonb not null default '[]'::jsonb,
  owner_suggestion text,
  horizon text,                         -- 30 / 90 / 365-day framing
  effort text, impact text,
  kpi text,
  evidence text,
  iso_map text,
  created_at timestamptz not null default now()
);
alter table public.fs_interventions enable row level security;
create policy fs_interventions_select on public.fs_interventions
  for select to authenticated using (true);;
