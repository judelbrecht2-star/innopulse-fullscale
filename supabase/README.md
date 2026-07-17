# InnoPulse Full-Scale — backend source (Release Gate 0)

The frontend in this repo is only half the product. The other half runs in
Supabase project `jydbinexjckfzjqgsmjf` (eu-west-1):

- **0001_baseline_schema_and_policies.sql** — the fs_ schema, every RLS policy
  and the security-definer helpers as deployed on 2026-07-17. Documented
  baseline: make future changes as new migration files, never dashboard-only.

## Edge functions (deployed versions as of 2026-07-17)

| Function   | Ver | verify_jwt | Purpose |
|------------|-----|------------|---------|
| fs-respond | v5  | false (token-gated) | Serve group-filtered questionnaire; validate + store submissions; atomic link claim (fs_use_link); per-device duplicate guard; anonymous progress beacons; no user-agent stored |
| fs-results | v4  | true | Aggregates with server-side anonymity floor (max(threshold,4)); ?detail=1 adds per-question mean/sd/DK + audience tags |
| fs-admin   | v2  | true | Team: members list w/ emails, owner invites (inviteUserByEmail), remove |
| fs-notify  | v1  | true | Reminder emails via Resend (owner/manager; recipients never stored) |

**To export their exact source into this repo** (next Gate 0 step):
`npx supabase functions download <name> --project-ref jydbinexjckfzjqgsmjf`
for each of the four names, committed under `supabase/functions/<name>/index.ts`.
Secrets required at runtime: `RESEND_API_KEY` (fs-notify).

## Release Gate status (per the 2026-07-17 product audit)

Gate 0 (source of truth): baseline SQL committed ✔ · function sources to
download ☐ · lockfile ☐ · staging environment ☐ · scoring/rules test suite ☐

Gate 1 (trust & privacy), open items: server-enforced anonymity for raw
answers/comments · report snapshots (immutable PDF/XLSX) · finding
accept/edit/reject/approve workflow gating the executive report · atomic
draft-first campaign creation · MFA + security headers · POPIA notice v2.
