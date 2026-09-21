
-- Step 4: optional respondent segments (department/site), threshold-protected.
alter table fs_campaigns add column if not exists segments text[];
alter table fs_responses add column if not exists segment text;
;
