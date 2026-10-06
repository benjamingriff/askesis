# ADR 0002: Use pnpm for workspace package management

## Status

Accepted for the v1 prototype.

**Scope clarification, 2026-10-06:** This decision governs the root pnpm workspace, CI and production services. The separate [Expo reference prototype](../../apps/mobile/README.md) is explicitly excluded from that workspace and uses npm with its own lockfile. The sole-lockfile statement below applies to the pnpm-managed workspaces.

## Context

Askesis is a TypeScript monorepo with API, web, generated client, and agent workspaces. npm workspaces were functional, but package-management conventions needed to be settled before CI and Railway deployment.

## Decision

Use pnpm 11.18.0, pinned through the root `packageManager` field.

- `pnpm-workspace.yaml` defines workspace packages.
- Workspace dependencies use the `workspace:` protocol.
- `pnpm-lock.yaml` is the sole dependency lockfile for the pnpm-managed workspaces.
- CI and Docker use `pnpm install --frozen-lockfile`.
- Required dependency build scripts are explicitly allowed in `pnpm-workspace.yaml`.
- Root scripts provide the standard repository commands.

## Consequences

Benefits:

- Strict workspace dependency resolution catches accidental undeclared dependencies.
- Content-addressable storage reduces repeated installation cost.
- Filtering supports independently working with API, web, and agent packages.
- Local, CI, Docker, and Railway builds use the same lockfile and pnpm version.

Costs:

- Contributors must use the pinned pnpm release.
- Docker images bootstrap pnpm before installing dependencies.
- pnpm build-script policy must be updated deliberately when a new dependency requires installation scripts.

The migration removed `package-lock.json` and retained all existing validation, database testing, and container smoke behaviour.
