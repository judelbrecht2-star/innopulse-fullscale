
-- Release Gate 1: reports become immutable snapshots, not labels over live data.
alter table fs_reports add column if not exists snapshot jsonb;
alter table fs_reports add column if not exists version int not null default 1;
alter table fs_reports add column if not exists checksum text;
alter table fs_reports add column if not exists questionnaire_version text;
;
