# ADR-0008: Deterministic, lockfile-driven deploy installs with pinned runtimes

**Status:** Accepted · **Date:** 2026-11 (after a production deploy outage class)

## Context
The Vercel deployment root is `packages/client` (the CLI deploys from that directory), which means the repo-root workspace lockfile never reached the build. Installs had been **lockless** — `npm install` resolving the newest semver versions on every deploy. After three months without a frontend deploy, the floating resolution began crashing npm's installer outright (`Cannot read properties of null (reading 'edgesOut')`), and pinning the Node runtime alone did not fix it.

## Decision
- Ship a **client-local lockfile** into the deployment scope (`packages/client/package-lock.json`, generated with `npm install --package-lock-only --workspaces=false`). Vercel detects the lockfile and switches to `npm ci` — installing the pinned tree instead of resolving a floating one.
- Pin the runtime with `.nvmrc` **inside the deployment scope** (root-level pins never ship when the deploy root is a subdirectory).
- Verify fixes against the deploy's actual cold state: fresh copy of exactly the uploaded fileset → `npm ci` → `next build`, before pushing.

## Consequences
- Deploys are reproducible: the same lockfile builds the same tree regardless of registry drift or npm version rotation.
- Two lockfiles exist (root workspace + client-local); the client one must be regenerated on client dependency changes. Acceptable pragmatism — the alternative (root-scoped deploys) is the planned long-term unification.
- Diagnosis playbook that generalized: compare the deployment's uploaded-file count against `git ls-files`, and read *which command actually ran* in the error line — a custom `installCommand` that never shipped shows up as the default `npm install`.
