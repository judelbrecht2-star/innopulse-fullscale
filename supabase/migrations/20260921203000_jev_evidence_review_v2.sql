-- InnoPulse Full-Scale — customer-facing AI evidence review verdicts.
-- The finding itself remains deterministic and analyst approval remains the
-- only path into a report.

alter table public.fs_finding_corroboration_shadow
  drop constraint if exists fs_finding_corroboration_shadow_verdict_check;

alter table public.fs_finding_corroboration_shadow
  add column if not exists context_count integer not null default 0
  check (context_count >= 0);

alter table public.fs_finding_corroboration_shadow
  add constraint fs_finding_corroboration_shadow_verdict_check
  check (verdict in (
    'corroborated', 'leaning_support', 'mixed',
    'leaning_contradiction', 'contradicted', 'insufficient'
  ));

comment on column public.fs_finding_corroboration_shadow.verdict is
  'Advisory AI evidence state. Never changes or approves the deterministic finding.';
