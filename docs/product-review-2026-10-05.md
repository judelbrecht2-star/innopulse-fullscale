# InnoPulse Full-Scale product review

**Review date:** 5 October 2026. **Repository:** `judelbrecht2-star/innopulse-fullscale`.
**Starting revision:** `45386f0` on `main`.

## Assessment

InnoPulse has a coherent product foundation: organisations gather feedback from
different stakeholders, compare innovation capabilities and perception gaps,
review interpretations, select curated interventions, and measure what changes.
The strongest part is the separation of observed evidence, supported
interpretations and hypotheses. The principal weakness is continuity and trust
around the operational workflow: the user could see the wrong organisation's
campaigns, lose the selected cycle between pages, mistake an unavailable service
for an empty workspace, or reopen a report whose conclusions had changed.

This change improves those paths while retaining the existing assessment model
and visual identity. The follow-up restored the backend and recovered its full
InnoPulse function source inventory. Production readiness still depends on
testing database invariants and promoting the backend fixes described below.
A successful frontend build does not establish those facts.

## Scope and evidence

Reviewed the App Router pages, shared UI, scoring/gap/findings/trend/outcome
helpers, report generation, respondent draft/submission flow, package and build
configuration, SQL baseline/migrations, and available Edge Function source.
Inspected the hosted sign-in page and exercised signed-in screens locally using
synthetic data, including two organisations, official and sandbox cycles, and a
deliberately denied write. No customer responses were used for that UI testing.

During the initial review, the connected Supabase project `jydbinexjckfzjqgsmjf`, named
`innopulse-assessment`, reported **INACTIVE** during review. Production database
queries, live role enforcement, email delivery, end-to-end submission and report
creation could therefore not be validated. There was no connected Vercel
management tool. The repository homepage identifies
`https://innopulse-fullscale.vercel.app`; the exact deployment configuration was
not independently verified. The operational follow-up below supersedes these
availability and access limitations. No schema migrations or production frontend
deployment have been performed.

## Product model and workflows

The system assesses five capabilities: Strategic Innovation Intent, Innovation
Environment, Organisational Capability, Process Management and Return on
Innovation. Stakeholders include executives, employees, customers, partners and
other configured groups. A questionnaire version determines which questions
each group receives. Scores exclude don't-know/not-applicable choices, while
those choices remain evidence about data quality.

| User | Primary job | Product implication |
| --- | --- | --- |
| Owner/manager | Configure an assessment, launch it, collect responses and coordinate delivery | Organisation and campaign context must stay explicit; failed writes must be visible. |
| Analyst | Check quality, review evidence, qualify findings and author report context | Show evidence provenance and alternatives; distinguish review from publication authority. |
| Viewer | Understand results and reports | Read-only access should be understandable without offering unusable controls. |
| Action owner | Carry out interventions and record outcomes | Needs a clear assigned-work path, deadlines and progress; current experience is still largely campaign-centric. |
| Respondent | Give candid feedback through an invitation link | No workspace account required; clear consent, mobile inputs and reliable recovery matter most. |

### 1. Workspace and assessment setup

Authentication leads to an organisational overview. Settings establish governance,
privacy thresholds, default questionnaire and programme context. Campaign
creation chooses a questionnaire, stakeholder groups, targets, optional context
dimensions and official/sandbox status. Existing lifecycle RPCs support draft
creation, readiness checks, launch snapshots and configuration locks.

The overview should answer: which organisation, which cycle, who is participating,
and what should happen next? Previously list pages read all campaigns visible to
the account even though settings tracked one active organisation. That was a
context error, not proof that database row security was bypassed. Lists now
explicitly filter by the active organisation. The shared header exposes the
organisation switcher; switching returns to the overview and clears the old
campaign URL. Users with no campaigns see an onboarding state instead of zeros
that look like measured results.

### 2. Collection and respondent experience

Managers distribute group or unique invitation links and monitor progress.
Respondents consent, answer group-specific questions, optionally give context
and written feedback, and submit. Score and comment thresholds are distinct
privacy controls. The frontend must not claim that crossing one automatically
unlocks the other.

Draft recovery previously restored answers/comments but omitted optional context.
It also counted stale keys as completed answers. Drafts now retain demographic
and segment choices, validate them against the served configuration, remove
unknown answers and invalid scale codes, and count valid question answers only.
Missing answers receive focus when submission is attempted. Question fieldsets,
legends, labelled choices and progress semantics improve keyboard and assistive
technology use. Sending disables inputs; storage failures show truthful advice.

A 409 response can mean either that this device already responded or that a
unique invitation was used elsewhere. The frontend now retains the draft and
shows the server's conflict instead of marking every 409 as a successful earlier
submission. Completion copy also acknowledges that privacy-eligible written
feedback can appear as excerpts; group suppression is not an absolute guarantee
against identification from someone's prose.

### 3. Quality review and insight

The response workspace combines submission metadata with privacy-gated server
details. Analysts distinguish valid, excluded/test and flagged records, examine
written feedback and select eligible excerpts. Insights compare shared questions
between groups, preserve sample thresholds, show detailed scores and support
cycle comparisons. Deterministic findings cite triggers, evidence, alternatives
and a validation step. Optional Jev evidence services can advise on written
support or contradiction; they do not replace analyst review.

Loading and service failure now have explicit states across campaign lists,
insights, findings and responses. Missing quality aggregates no longer appear as
healthy data. Campaign/response metadata reads paginate beyond the Data API row
cap, so totals do not silently stop at the first page. This does not fix any
pagination inside the deployed aggregate functions. The follow-up recovered
that source and fixes the confirmed truncation paths locally.

The overview's coverage heuristic was labelled confidence. It is now a
**participation signal**, with an explanation that it is not statistical
confidence. The diagnostic engine's evidence confidence remains separate.

### 4. Interventions and outcome learning

Recommendations come from an approved intervention library, matched to score
bands or reliable stakeholder gaps. Users add actions, assign an owner, update
status, add milestones, and capture baseline, target, observed score, due date and
learning notes. This is the bridge from diagnosis to operational value.

The action page previously chose a current campaign internally and provided no
cycle selector. It now lets users work on an earlier cycle and accepts campaign
context from the other pages. Review toggles, analyst notes, action status,
owner/milestone changes and outcome saves surface database errors. Failed saves
do not automatically show a saved result. Writes and refreshed reads are checked;
campaign changes are disabled during action saves. Batch owner updates remain
multiple database writes and require a future transactional backend operation
for all-or-nothing behavior.

### 5. Reporting and sharing

Reports store assessment evidence, reviewed findings, authored context,
privacy-eligible verbatims/themes and optional trend data. A checksum and version
help identify the stored record. The report experience must distinguish saved
evidence from a live view.

The printable saved-report path previously recomputed findings with the current
rulebook and fetched the current intervention library. It now uses saved finding
wording, and newly generated snapshots capture the intervention library and
interpretation text. Word exports use captured interpretation text when present.
Legacy snapshots lack that additional material: print shows an explanatory note
instead of quietly using today's library; legacy Word interpretation fallback
remains a compatibility limitation. An unavailable saved report ID now errors
instead of falling back to current evidence.

Required evidence-service failures now stop report generation instead of silently
producing a report without the failed source. Optional historical trend lookup
is still best-effort and should eventually disclose why comparison is missing.
Report deletion has an explicit confirmation. Spreadsheet exports share one
escaping helper that quotes delimiters/newlines and neutralises formula-like
text while preserving numeric values.

## Implemented UI direction

The current typography, stakeholder colours, cards, score bands and navigation
remain recognisable. The improvements focus on meaning and task progression:

- Sign-in explains the product's purpose and separates workspace access from
  respondent invitation access. Labels, password visibility, network failures
  and authenticator challenges are clearer; assurance-check failures do not
  continue into the application as though authentication had succeeded.
- A campaign workflow strip connects setup, collection, findings, actions and
  reports, displaying the campaign and sandbox context. Sidebar links carry the
  selected campaign between those sections.
- Shared loading/error/empty states avoid presenting invented results during
  outages. A global runtime-error screen offers recovery.
- A skip link, current-page semantics, labelled campaign selectors, question
  groups and reduced-motion handling improve accessibility. Phone layout was
  visually checked for the respondent form; this was not a full accessibility
  certification or complete device matrix.

Long tables, filter-heavy evidence screens and action-owner task discovery remain
the main opportunities for a subsequent UI iteration. A navigation strip should
not imply that the database has approved every preceding step; it indicates
where the user is working, not a completed governance checklist.

## Remaining priorities

| Priority | Finding and evidence | Required next step / acceptance condition |
| --- | --- | --- |
| Release blocker | Backend project reported INACTIVE | Restore the project, confirm health, migrations and deployed function versions, then run staging acceptance. Do not infer data loss from this status. |
| Release blocker | Source inventory is incomplete: frontend calls `fs-results`, `fs-responses-ops`, `fs-admin`, `fs-notify` and other operational endpoints without matching sources in this repository | Export exact deployed sources, reconcile drift with migrations, and make a fresh staging deployment reproducible. |
| High | `fs-respond/index.ts` writes a claimed link, response, answers, comments and consent through separate calls; comment failures are logged but success can still be returned, and consent insert errors are unchecked | Add one transaction-backed, idempotent submission RPC. Inject failures at each step and test concurrent unique-link claims, retries and complete rollback. Validate stored consent and optional comments before success. |
| High | Snapshot migration adds JSON/version/checksum columns; the original report policy permits authorised writes, and no report immutability trigger was identified | Make saved report evidence immutable at the database boundary; version through new inserts. Test direct updates and concurrent report version allocation. A browser-generated checksum alone is not tamper prevention. |
| High | Review rows gate report findings, but this is a reviewed/unreviewed toggle rather than a full accept/edit/reject and separate publication-approval record | Agree the approval model, enforce it server-side and record actor/time/version. Confirm who may publish and what happens when evidence changes. |
| High | Privacy copy, optional AI processing, comment excerpts, demographic inference and assessor access need a consistent documented contract | Owner/privacy review should align the notice, retention/export rules and provider disclosures with actual deployed behavior before enabling AI processing. Keep optional pilot flags disabled until that review and staging checks pass. |
| High | Frontend MFA checks do not prove every database/function operation enforces the intended assurance level; migrations include assurance/audit controls, deployed state unverified | Test low/high-assurance sessions against sensitive RPCs and functions for all roles. Do not rely on hiding buttons as authorization. |
| Medium | Campaign detail and some library/action reads still use single-page queries; a working read can be capped, and high-volume paths fetch extensive metadata | Add count/aggregate endpoints and server pagination where volumes demand it. Test more than one page and concurrent changes. |
| Medium | Legacy report exports and live print links retain compatibility behavior; authored fields and saved notes may represent different save moments | Define a migration/export policy, show live versus saved state prominently, and make report generation consume one consistent authored revision. |
| Medium | Password-reset redirect is fixed to production; invitation/reminder behavior depends on unavailable functions and email service | Validate allowlisted preview/staging callbacks and actual recovery/delivery paths; make deployment-specific callback configuration explicit. |
| Medium | Action owners lack a dedicated assigned-work view; owner is free text and sequential updates can partially complete | Add a membership-backed assignment model, my-actions view and transactional batch updates after the permission model is settled. |
| Medium | Automated tests concentrate on pure helpers; live privacy/role/database behavior remains unverified | Add staging integration tests with synthetic tenants, permission failures, suppression boundaries and export checks. |

## Validation and operational changes

The baseline suite passed **125 tests in 12 files**. The updated suite passes
**148 tests in 17 files**, with new coverage for campaign selection, organisation
query boundaries, full-page reads, invalid draft recovery, stored report wording
and spreadsheet formula handling. The final production build passes (23 generated pages), the production dependency
audit reports zero vulnerabilities, and the diff passes whitespace checks. The
production bundle was checked for accidental local sample-service configuration;
none was found.

Local browser checks verified sign-in with a sample account, official-campaign
selection, an earlier-cycle handoff into interventions, organisation switching
to an empty workspace, visible denied action saves, incomplete submission focus,
and restoration of both answers and optional context. These are fixture-based
checks, not evidence that production row-security policies or functions work.

Next.js moved from 16.3.5 to the patched 16.3.6 release following the npm advisory
for `next/og` ([upstream security advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)).
No `next/og` usage was identified in this application; exploitability was not
demonstrated. The dependency update removes the reported vulnerable version.
Added `nosniff`, frame denial, a no-referrer policy to protect invitation URLs,
and restricted camera/microphone/geolocation permissions. A strict CSP needs a
separate report-only deployment exercise to account for framework scripts and
Supabase endpoints; it was not guessed into this release.

Added GitHub checks for tests, production build and production dependency audit,
plus explicit staging frontend configuration. The remaining backend work should
be done against a restored, disposable staging project, with production promotion
following the role/privacy/submission/report acceptance checks in the README.

## Operational follow-up: restored service and account recovery

Using the user's signed-in Chrome session and Supabase connection, verified
the existing Vercel Git integration and protected branch preview. Supabase
refused to restore InnoPulse while two other Free projects were active. With
the user's explicit approval, paused `innovation-army-launchpad`
(`czissngwfcpaizyzxfqs`) and restored InnoPulse. Launchpad's backend remains
offline. InnoPulse then reported **ACTIVE_HEALTHY**, and a database readiness
query succeeded. All 29 `fs_*` tables have RLS enabled; this is not proof that
every policy or privileged function enforces the intended boundaries.

Recovered deployed `fs-admin` v9, `fs-notify` v5, `fs-results` v16 and
`fs-responses-ops` v10 sources into version control. Existing `fs-respond` v13,
`fs-jev-findings` v5 and `fs-jev-interventions` v2 and their shared sources match
deployed source after newline normalization. The inventory JSON records the
deployed baseline, not subsequent local edits. Embedded NUL string delimiters
were escaped as `\0` without changing their runtime meaning. The unrelated
`attio-sync` function was excluded.

The user signed into an existing account without an organisation membership.
With explicit approval, added that account as an owner of the existing demo
workspace, recorded the membership change in `fs_audit`, and verified the
membership with SQL and the live Security screen. No password was entered or
changed by the agent. The existing settings provider incorrectly made personal
password and profile screens depend on organisation membership. The local fix
keeps account security available when membership or preferences cannot load,
while retaining errors and access restrictions on organisation settings.

The live Auth configuration allows only two legacy custom-domain pages, while
the app's password-reset request specifies the Vercel Security page. The
requested callback was therefore not allowlisted and could fall back to the old
site. With explicit approval, added only the exact production Security page
(`https://innopulse-fullscale.vercel.app/settings/security`) to the allowlist.
The user declined the preview callback, so password reset remains directed to
production. UI acceptance of a reset request is not
proof of email delivery; a complete recovery email-to-password flow still
requires the user to finish the password submission.

Live signed-in preview reads verified the two existing campaign cycles and the
open campaign's aggregate results, comparison context and protected stakeholder
cells. No response text was opened and no assessment submissions or reports
were created. The live table exposed misleading copy: a five-person group was
hidden for complementary suppression yet labelled as waiting for five people.
The updated label explains that additional cells can be hidden to stop protected
results being inferred from other scores.

Recovered backend source confirmed two data-completeness defects: campaign
responses were read without pagination, and batches of 40 responses could have
2,000 answers while the Data API returned only its capped result. Local fixes
page responses, answers, comments, groups and progress with stable ordering;
continue through short capped pages; reject failed governance and data reads;
and propagate failed comment curation writes. Existing privacy gates remain in
place. Twelve endpoint/helper tests exercise real bundled handlers against a
capped synthetic database, including 1,040 respondents, 2,000-answer batches,
later-page failures, failed comment saves, missing membership and the absolute
owner comment lock. The updated suite passes **160 tests in 18 files**; the
production build and zero-vulnerability production dependency audit pass.
These backend code changes have **not been deployed** to Supabase.

Security Advisors report two extensions in `public`, five anonymous-callable
privileged functions, 21 authenticated-callable privileged functions, 25 RLS
tables with no policies (including unrelated legacy tables), and disabled leaked
password protection. These findings need individual review; some privileged
functions are deliberately used by membership-scoped RPCs and policies, so
changing their grants indiscriminately could break the product. Remediation
guidance: [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
[anonymous privileged calls](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[signed-in privileged calls](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Transactional submissions/consent, report immutability, real low/high-assurance
role tests, production email delivery and backend promotion remain unverified.
Restoring availability and adding one approved owner membership do not establish
these broader release properties.

## Recommended product sequence

1. Keep service availability healthy and deploy the recovered, tested backend source to staging.
2. Validate and release the workflow/context/draft/report fixes in this change.
3. Make submissions atomic and reports immutable, then prove role/privacy boundaries.
4. Complete approval and action-owner workflows using those established boundaries.
5. Improve dense-screen mobile behavior and instrument funnel completion,
   submission failures, findings review, report generation and action outcomes.

Useful operating measures are campaign launch completion, respondent completion,
submission failure/retry rate, time to review eligible findings, reports produced
from reviewed evidence, and actions with observed outcomes. The repository does
not provide usage evidence for a quantitative conversion or retention diagnosis;
these are proposed measurements, not claimed performance results.
