# Complete multisport example

The API can publish an eight-week **Multisport example** for one existing, verified
Clerk account. It contains 64 scheduled sessions: running, cycling, swimming,
triathlon bricks and transitions, strength, Hyrox stations and gym conditioning.
Every week is populated, Friday is explicitly covered as a rest day, and double
sessions have consecutive positions. Briefs, all four sport baselines, blocks,
weekly targets, tags, nested prescriptions, calibration and two genuine locked
revisions are included.

The committed blueprint and coverage manifest live in
[`apps/api/src/examples`](../../apps/api/src/examples). Storage examples also cover
energy, lap and conditional completions; speed, raw heart rate, cadence, percentage
of 1RM, tempo and ranges; and immutable movement references. These additional fields
are readable by the API but are not all available to the coaching writer. EMOM,
AMRAP and rounds for time use existing containers and instructions: the example
does not add a scoring or time-cap engine, heart-rate zones or strength calibration.

## Hosted deployment

The existing Askesis Railway production project/environment is explicitly targeted
in `examples/config.ts`, with owner email `drjamin1990@gmail.com`. API image startup
runs the operator command before opening the listener; the existing Atlas
pre-deploy job still applies migrations first. The Railway API service was inspected
on 8 October 2026: repository-root Docker build, `apps/api/Dockerfile`, no start-command
override. No Railway settings need changing for this image to run the command.

Other installations and preview environments do not seed automatically. To opt in:

```text
EXAMPLE_PLAN_ENABLED=true
EXAMPLE_PLAN_EMAIL=<existing verified Clerk account email>
```

`EXAMPLE_PLAN_ENABLED=false` disables publication, including on the configured
Askesis deployment. An explicit email overrides the configured owner. Startup
rejects invalid enabled configuration or an absent, ambiguous or unverified owner.
It resolves accounts in the API's own Clerk instance and uses normal athlete
provisioning; it never reassigns an existing identity or creates a Clerk user.

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
after a deploy in a new week. Update `BLUEPRINT_REVISION` when changing prescriptions
so an existing immutable edition is replaced deliberately.

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
