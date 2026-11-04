# Three-month example training plans

The API publishes three **12-week** plans for the configured, verified Clerk
account through the existing deployment seed hook:

| Plan                         | Weekly structure                                                                                                                           | Sessions |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Cycling endurance & strength | Four rides, two supporting strength sessions in weeks 1–8 and one in weeks 9–12                                                            | 68       |
| Triathlon foundation to race | Two swims, a bike session, two runs, a bike/run brick and supporting strength; the final week replaces the weekend with a sprint triathlon | 83       |
| Strength & HIIT athlete      | Lower, upper and full-body lifting, one HIIT workout and one aerobic gym circuit                                                           | 60       |

Each plan covers three months as twelve complete Monday–Sunday training weeks.
Foundation and build blocks each last four weeks, with progressive work followed
by a cutback in weeks 4 and 8. Three specific preparation weeks lead into a final
taper for endurance plans or a deload for the gym plan. Cycling and triathlon rest
on Friday; the gym plan rests on Thursday and Sunday. The triathlon goal event
prescribes a 750 m swim, 20 km bike and 5 km run on the final Sunday.

The plans have separate sport briefs, blocks, weekly targets, tags, complete
prescriptions, movement references and two genuine locked revisions. Weekly
duration, swimming distance and strength-frequency targets are derived from their
scheduled sessions. Gym workouts cover squat, hinge, push, pull, carries, core,
rowing and SkiErg alongside EMOM, AMRAP and rounds for time. Time caps and format
rules use existing instructions; scoring and automatic format execution are not
added. These are synthetic examples; loads are selected using RIR/RPE.

The committed blueprints live in
[`apps/api/src/examples`](../../apps/api/src/examples). The former eight-week
multisport showcase is no longer published. Its untouched managed editions are
archived when the new plans are seeded, retaining immutable history. Edited
examples and personal plans retain the preservation rules below.

## Hosted deployment

Every environment defaults to **disabled**, including production and Railway.
The application contains no account email, Clerk user ID or Railway deployment ID
for the hosted owner. Enable publication only on the intended **API service**:

```text
EXAMPLE_PLAN_ENABLED=true
EXAMPLE_PLAN_EMAIL=<existing verified Clerk account email>
```

`EXAMPLE_PLAN_ENABLED=false` or an unset flag disables publication. Setting an
email alone does not enable it; `true` requires an explicit valid email. Startup
rejects invalid enabled configuration or an absent, ambiguous or unverified owner.
It resolves accounts in the API's own Clerk instance and uses normal athlete
provisioning; it never reassigns an existing identity or creates a Clerk user.

### Release order

1. Retain `EXAMPLE_PLAN_ENABLED=true` and the verified owner's
   `EXAMPLE_PLAN_EMAIL` in the intended Railway API service/environment. If the
   existing example is already enabled, no configuration change is needed. Keep
   these variables out of the web service, worker and preview environments unless
   those APIs should independently seed examples.
2. Keep the API's existing Atlas migration pre-deploy command and leave its
   start-command override empty. This replacement reuses the existing registry
   and startup publisher; it needs no new migration. See
   [Railway operations](./railway-deployment-plan.md#api-service).
3. Merge the PR and deploy the API from that merged commit. Railway runs Atlas
   first, then the publisher, then opens the API listener. No manual migration or
   seed command is required. If automatic deployments are enabled, merging triggers
   this sequence; avoid deploying this branch before merging.
4. Wait for API readiness and an `Example publication` log (`created`, `unchanged`
   or `preserved`), then inspect all three plans while signed in as the configured owner.
   `calibration-required` means withdrawn fitness needs a replacement before a new
   edition can be published. This change requires no worker/web configuration;
   existing automatic worker/web rebuilds can proceed normally.

An invalid enabled configuration or failed publication blocks the new API startup.
Correct the service variables and redeploy. Setting `EXAMPLE_PLAN_ENABLED=false`
also lets the API start without publication; it does not delete existing plans.

## Manual local seeding

Fresh `pnpm dev:setup` databases and their normal verification account start empty,
so onboarding can be tested. Setup never changes existing plans or identities. To
populate the verification account when useful, run from the repository root:

```bash
pnpm example:seed --email askesis-verification+clerk_test@example.com
```

To seed another existing local account, pass its verified email. This command uses
the ignored root `.env` and its Clerk instance/database, so check that target before
running. The compiled image equivalent is:

```bash
node apps/api/dist/examples/cli.js --email '<verified email>'
```

The command prints overall status, per-plan kind/status/ID, anchor date and systems
for which it added estimates. The top-level `planId` remains the cycling plan ID
for compatibility. It does not print sessions, login URLs or credentials.

## Reruns, dates and preservation

Dates begin on the previous Monday in the athlete's timezone: one past week and
eleven current/future weeks. The anchor stays stable within the calendar week.
Each plan has an independent revision. The registry key is athlete + blueprint
revision + anchor; redeploys/restarts in that week do not duplicate content. Dates
move only when the command runs, including after a deploy in a new week.

Each entry in `BLUEPRINT_REVISIONS` ends with a fingerprint of its blueprint's
content. Editing one plan's sessions, blocks, phases or brief publishes a new
edition of that plan on the next deploy or command run and archives its untouched
predecessor. The other two plans keep their IDs in the same week. Changes outside
the blueprints, such as the writer or publication steps, require a deliberate bump
to the revision prefix.

Publication uses one PostgreSQL transaction and an owner advisory lock. Draft
creation, prescriptions, brief confirmation, real validation/hashes, two locks,
activation, registry insertion and archival of untouched older managed examples
commit together for all new editions. All three current plans are active. Failure
rolls everything back, including new estimates; retry normally. Concurrent startup
jobs serialize rather than creating duplicates.

An edited, unlocked, renamed, archived or deactivated example is preserved; the
same edition is not recreated to undo that decision. A later week/revision may
produce a fresh example. Previous examples with an active coaching turn remain
untouched. Ordinary plans, historical test fixtures and other owners are never
cleanup targets. Older untouched managed editions, including the former multisport
showcase, are archived, retaining immutable history rather than deleting it.

Existing nonretracted calibration is reused unchanged. A new endurance edition
adds a clearly labelled synthetic estimate only for a required sport with **no
calibration history** (run threshold pace, cycling FTP or swimming CSS). These
estimates are athlete-owned and therefore apply to the athlete's other plans too;
replace them with personal fitness inputs when available.

Withdrawn fitness is not resurrected. If a required system was withdrawn, new
publication reports `calibration-required` until the athlete records a replacement.
Unchanged existing editions remain untouched. A gym-only blueprint update does not
require endurance fitness and can publish despite withdrawn endurance calibration.

## Historical test fixtures

Cardiff remains required by database tests, smoke startup and populated migration
rehearsals. The old triathlon/Hyrox fixtures also remain in the smoke publisher.
Their Compose jobs are optional via the `fixtures` profile; normal local startup
only migrates. To load those historical fixtures explicitly:

```bash
docker compose --profile fixtures run --rm seed
docker compose --profile fixtures run --rm publish-fixture
```

The historical publisher/reset scripts remain local-only. Do not use them on
Railway. Existing databases retain their historical sample data; switching setup
to an empty default does not wipe earlier sessions.
