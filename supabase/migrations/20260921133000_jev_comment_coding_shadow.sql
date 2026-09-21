-- InnoPulse Full-Scale — Jev comment coding shadow pilot.
--
-- Results are deliberately service-role-only. The pilot cannot change comment
-- tags, findings, reports or any user-visible state. Raw comment text remains in
-- fs_comments and is never copied into this table.

create table if not exists public.fs_comment_coding_shadow (
  id uuid primary key default gen_random_uuid(),
  comment_id bigint not null references public.fs_comments(id) on delete cascade,
  response_id uuid not null references public.fs_responses(id) on delete cascade,
  campaign_id uuid not null references public.fs_campaigns(id) on delete cascade,
  group_id uuid not null references public.fs_groups(id) on delete cascade,
  schema_version text not null,
  model text not null default 'jev-latest',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'error')),
  primary_pillar text,
  primary_pillar_confidence double precision
    check (primary_pillar_confidence between 0 and 1),
  actionability double precision check (actionability between 0 and 2),
  actionability_confidence double precision
    check (actionability_confidence between 0 and 1),
  identifying_detail_probability double precision
    check (identifying_detail_probability between 0 and 1),
  theme_probabilities jsonb not null default '{}'::jsonb,
  answers jsonb,
  latency_ms integer check (latency_ms >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (comment_id, schema_version)
);

create index if not exists fs_comment_coding_shadow_pending_idx
  on public.fs_comment_coding_shadow (campaign_id, group_id, status, created_at);

alter table public.fs_comment_coding_shadow enable row level security;
revoke all on table public.fs_comment_coding_shadow from public, anon, authenticated;
grant all on table public.fs_comment_coding_shadow to service_role;

comment on table public.fs_comment_coding_shadow is
  'Service-only Jev shadow evaluations. No raw comments and no product decisions. Results remain hidden until a separately reviewed release enables them.';


