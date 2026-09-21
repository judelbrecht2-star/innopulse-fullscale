-- InnoPulse Full-Scale — Jev finding corroboration shadow pilot.
--
-- This table stores only typed probabilities and aggregate counts. Raw comments
-- remain in fs_comments. Shadow results cannot alter findings, approvals or
-- report content; analysts remain the decision-makers.

create table if not exists public.fs_finding_corroboration_shadow (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  finding_id text not null,
  finding_signature text not null,
  comment_set_hash text not null,
  schema_version text not null,
  model text not null default 'jev-latest',
  finding_class text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'error')),
  verdict text check (verdict in ('corroborated', 'mixed', 'contradicted', 'insufficient')),
  eligible_comment_count integer not null default 0 check (eligible_comment_count >= 0),
  evaluated_comment_count integer not null default 0 check (evaluated_comment_count >= 0),
  relevant_count integer not null default 0 check (relevant_count >= 0),
  support_count integer not null default 0 check (support_count >= 0),
  contradiction_count integer not null default 0 check (contradiction_count >= 0),
  support_mean double precision check (support_mean between 0 and 1),
  contradiction_mean double precision check (contradiction_mean between 0 and 1),
  relevance_mean double precision check (relevance_mean between 0 and 2),
  answers jsonb,
  latency_ms integer check (latency_ms >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (campaign_id, finding_id, schema_version)
);

create index if not exists fs_finding_corroboration_shadow_campaign_idx
  on public.fs_finding_corroboration_shadow (campaign_id, status, updated_at desc);

alter table public.fs_finding_corroboration_shadow enable row level security;
revoke all on table public.fs_finding_corroboration_shadow from public, anon, authenticated;
grant all on table public.fs_finding_corroboration_shadow to service_role;

comment on table public.fs_finding_corroboration_shadow is
  'Service-only Jev evidence checks for deterministic findings. No raw comments; no automatic finding or report decisions.';
