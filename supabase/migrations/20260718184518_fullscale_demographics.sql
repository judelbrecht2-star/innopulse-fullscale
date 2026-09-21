
-- Demographics: configurable per campaign, optional per respondent.
alter table fs_campaigns add column if not exists demographics jsonb; -- [{id,label,question,options[]}]
alter table fs_responses add column if not exists demo jsonb;          -- {dimId: value}
;
