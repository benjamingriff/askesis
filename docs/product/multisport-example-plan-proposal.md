# Complete multisport example: accepted implementation plan

The owner approved the complete multisport showcase and then selected
`drjamin1990@gmail.com` as its hosted owner. Local accounts should start empty,
with manual example seeding available for verification.

The implementation uses a committed eight-week blueprint, 64 sessions, full
prescription/storage coverage and two real published revisions. Account lookup
requires an exact verified email in the configured Clerk instance and preserves
normal athlete ownership. Existing fitness is retained; missing systems receive
clearly labelled estimates, and withdrawn fitness is respected.

An owner advisory lock and one atomic transaction cover publication and replacement
of untouched older examples. This replaces the original proposal's resumable stage
registry: a failed operation leaves no partial plan or marker. Changes to personal
plans or examples are preserved.

The existing Railway API has no custom startup override. The image's startup
wrapper ensures the example after the existing Atlas pre-deploy migrations, scoped
to the known Askesis production environment. This replaces the originally proposed
external pre-deploy configuration change and also makes restarts safe.

The revised design was independently reviewed against `deec265` using the
review-proposal skill. The review accepted account targeting, transaction-capable
lifecycle helpers, plan-before-athlete lock ordering and checks for missing fitness
under the athlete lock. It did not approve merge or deployment.

See [example-plan operations](../operations/example-plan.md) for the implemented
commands, deployment configuration, preservation rules and current limitations.
Cardiff and the historical multisport fixtures remain for smoke/integration and
migration coverage; they are optional during local development.
