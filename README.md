# InnoPulse Full-Scale

A stakeholder assessment workspace for collecting innovation feedback, comparing
perceptions, reviewing evidence, planning interventions and recording outcomes.

## Local development

Use Node.js 22 or newer and npm. Install with `npm ci`, run `npm run dev`, and
open `http://localhost:3000`. Run `npm test` and `npm run build` before a release.
The pull-request workflow also checks production dependencies for high/critical
advisories.

The existing Supabase deployment is the default. For a separate staging backend,
copy `.env.example` to `.env.local` and set **both**
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to that project's
public client credentials. Never put a service-role key in a `NEXT_PUBLIC_`
variable. These values are compiled into the frontend; restart development or
rebuild after changing them.

The browser points to Edge Functions on the same Supabase project. A working
frontend alone does not provide submissions, scoring, team management or email.
See [backend source and migrations](supabase/README.md).

## Product review and release readiness

The [5 October 2026 product review](docs/product-review-2026-10-05.md) records the
workflow, UI, trust and operational findings, implemented changes, validation and
remaining release work. It distinguishes repository evidence from live behavior.

The repository homepage points to Vercel. Check the actual Git integration and
preview deployment before assuming a branch is deployed. Apply staging backend
migrations and deploy the corresponding functions before testing a preview.
Supabase Auth must allow the staging application's callback URLs; password-reset
email currently uses the production settings/security URL and must be validated
separately when setting up another environment.

Before promoting a release, verify with synthetic data in staging:

- Owner, manager, analyst, viewer and action-owner access, including two organisations.
- Create draft, readiness checks, launch, rotate links, respond, close and archive.
- Unique-link concurrency, submission retries and database-error recovery.
- Small-group score/comment suppression and every export path.
- Reviewed findings, saved report versions, action saves and outcome learning.
- Authenticator challenges, password recovery, invitations and reminder delivery.

Do not point synthetic acceptance tests at customer data. Release only the
backend/frontend combination that passed these checks.
