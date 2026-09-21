
-- Step 5: cycle-over-cycle trends. A campaign may point at its predecessor;
-- "Duplicate for next cycle" sets this automatically.
alter table fs_campaigns add column if not exists prior_campaign_id uuid references fs_campaigns(id);
;
