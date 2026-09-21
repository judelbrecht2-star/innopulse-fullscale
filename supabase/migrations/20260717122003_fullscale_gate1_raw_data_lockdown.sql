
-- Release Gate 1: raw answers and written comments must not be readable from
-- the browser. All reads now flow through the fs-responses-ops / fs-results
-- edge functions (service role), which enforce role + anonymity threshold
-- server-side and audit-log individual-record access.
drop policy if exists fs_answers_select on fs_answers;
drop policy if exists fs_comments_select on fs_comments;
;
