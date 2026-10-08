# Complete multisport example

The API can publish an eight-week **Multisport example** for one existing, verified
Clerk account. It contains 64 scheduled sessions: running, cycling, swimming,
triathlon bricks and transitions, strength, Hyrox stations and gym conditioning.
Every week is populated, Friday is explicitly covered as a rest day, and double
sessions have consecutive positions. Briefs, all four sport baselines, phased blocks
(base with a cutback third week, two builds, recovery, peak and taper), an A, B and C
race (a B tune-up closes Build 1, a C race sits in Build 2 and the A race is the last
day), weekly targets, tags, nested prescriptions, calibration and two genuine locked
revisions are included.

The committed blueprint and coverage manifest live in
[`apps/api/src/examples`](../../apps/api/src/examples). Storage examples also cover
energy, lap and conditional completions; speed, raw heart rate, cadence, percentage
of 1RM, tempo and ranges; and immutable movement references. These additional fields
are readable by the API but are not all available to the coaching writer. EMOM,
AMRAP and rounds for time use existing containers and instructions: the example
does not add a scoring or time-cap engine, heart-rate zones or strength calibration.

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

1. Before merging, set both variables together in the intended Railway API
   service/environment. Use the verified email of the account that should own the
   example. Keep these variables out of the web service, worker and preview
   environments unless those APIs should independently seed an example. The
   currently deployed API predates this startup hook and ignores these variables.
2. Keep the API's existing Atlas migration pre-deploy command and leave its
   start-command override empty. The API image includes the new registry migration;
   normal image startup invokes the example publisher. The service was inspected
   on 8 October 2026 with these settings already in place. Reconfirm them before
   release; see [Railway operations](./railway-deployment-plan.md#api-service).
3. Merge the PR and deploy the API from that merged commit. Railway runs Atlas
   first, then the publisher, then opens the API listener. No manual migration or
   seed command is required. If automatic deployments are enabled, merging triggers
   this sequence; avoid deploying this branch before merging.
4. Wait for API readiness and an `Example publication` log (`created`, `unchanged`
   or `preserved`), then inspect the plan while signed in as the configured owner.
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

The command prints only status, plan ID, anchor date and systems for which it added
estimates. It does not print sessions, Clerk handshake URLs or credentials.

## Reruns, dates and preservation

Dates begin on the previous Monday in the athlete's timezone: one past week and
seven current/future weeks. The anchor stays stable within the calendar week.
The registry key is athlete + blueprint revision + anchor; redeploys/restarts in
that week do not duplicate content. Dates move only when the command runs, including
after a deploy in a new week. `BLUEPRINT_REVISION` ends with a fingerprint of the
blueprint's content, so editing example data (sessions, blocks, phases, the brief)
publishes a new edition on the next deploy or command run and archives the untouched
previous one. Changes outside the blueprint, such as the writer or the publication
steps, still need the revision's version prefix bumped deliberately.

Publication uses one PostgreSQL transaction and an owner advisory lock. Draft
creation, prescriptions, brief confirmation, real validation/hashes, two locks,
activation, registry insertion and archival of untouched older managed examples
commit together. Failure rolls everything back, including new estimates. Retry
normally. Concurrent startup jobs serialize rather than creating duplicates.

An edited, unlocked, renamed, archived or deactivated example is preserved; the
same edition is not recreated to undo that decision. A later week/revision may
produce a fresh example. Previous examples with an active coaching turn remain
untouched. Ordinary plans, historical test fixtures and other owners are never
cleanup targets. Older untouched managed editions are archived, retaining immutable
history rather than deleting it.

Existing nonretracted calibration for a sport is reused unchanged. Only a sport
with **no calibration history** receives a clearly labelled synthetic estimate
(run threshold pace, cycling FTP or swimming CSS). These estimates are
athlete-owned and therefore apply to that athlete's other plans too; replace them
with personal fitness inputs when available. Withdrawn fitness is not resurrected:
if an entire system was withdrawn, a new edition reports `calibration-required`
until the athlete records a replacement. An unchanged existing edition remains
untouched by reruns.

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
