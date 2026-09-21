
-- Verbatim theme-coding: analyst-applied tags on written responses.
alter table fs_comments add column if not exists themes text[];
;
