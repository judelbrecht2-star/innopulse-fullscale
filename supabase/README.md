# InnoPulse Full-Scale — backend source (Release Gate 0)

> Current status and release work are recorded in the
> [5 October 2026 product review](../docs/product-review-2026-10-05.md).
> The inventory and gate checklist below describe July's baseline and are
> historical: the repository now has a lockfile, tests and all seven InnoPulse
> function sources. Confirm deployed state before
> using this checklist as a release decision.

## Current inventory (5 October 2026)

The [deployed baseline inventory](function-inventory-2026-10-05.json) records
the versions recovered during the operational review. The unrelated `attio-sync`
function is outside this product inventory. The `fs-results` and
`fs-responses-ops` sources now include local pagination and database-error fixes
that have not been deployed. Their shared `query.js` must be included with any
deployment. `tests/backend-queries.test.js` bundles the actual handler sources
and tests complete reads and existing privacy gates against synthetic capped
query results. Run these checks against a disposable staging backend before
production promotion, including real role, RLS, MFA and concurrent-read cases.

The frontend in this repo is only half the product. The other half runs in
Supabase project `jydbinexjckfzjqgsmjf` (eu-west-1):

- **0001_baseline_schema_and_policies.sql** — the fs_ schema, every RLS policy
  and the security-definer helpers as deployed on 2026-07-17. Documented
  baseline: make future changes as new migration files, never dashboard-only.

## Edge functions (deployed versions as of 2026-07-17)

| Function   | Ver | verify_jwt | Purpose |
|------------|-----|------------|---------|
| fs-respond | v7 deployed / v8 local | false (token-gated) | Serve group-filtered questionnaire; validate + store submissions; atomic link claim; per-device duplicate guard; anonymous progress beacons. Local v8 adds privacy-gated Jev comment-coding shadow work. |
| fs-results | v4  | true | Aggregates with server-side anonymity floor (max(threshold,4)); ?detail=1 adds per-question mean/sd/DK + audience tags |
| fs-admin   | v2  | true | Team: members list w/ emails, owner invites (inviteUserByEmail), remove |
| fs-notify  | v1  | true | Reminder emails via Resend (owner/manager; recipients never stored) |

**Historical source-export instructions** (completed for the current inventory):
`npx supabase functions download <name> --project-ref jydbinexjckfzjqgsmjf`
for each of the four names, committed under `supabase/functions/<name>/index.ts`.
Secrets required at runtime: `RESEND_API_KEY` (fs-notify). The local Jev shadow
pilot additionally requires `TYPESAFE_API_KEY` and
`JEV_COMMENT_CODING_SHADOW=true`. Keep the flag false until migration 0009 is
applied and the data-processing/privacy review is complete.

The Jev pilot is shadow-only: it writes service-role-only model outputs to
`fs_comment_coding_shadow`, never copies raw comment text there, never changes
analyst tags, findings or reports, and only sends comments for a group after the
effective comment threshold has been reached.

## Release Gate status (per the 2026-07-17 product audit)

Gate 0 (source of truth): baseline SQL committed ✔ · function sources to
download ☐ · lockfile ☐ · staging environment ☐ · scoring/rules test suite ☐

Gate 1 (trust & privacy), open items: server-enforced anonymity for raw
answers/comments · report snapshots (immutable PDF/XLSX) · finding
accept/edit/reject/approve workflow gating the executive report · atomic
draft-first campaign creation · MFA + security headers · POPIA notice v2.
