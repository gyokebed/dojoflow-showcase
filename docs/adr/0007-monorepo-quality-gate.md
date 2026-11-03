# ADR-0007: One reusable quality gate; deploys require it

**Status:** Accepted · **Date:** 2026-11

## Context
A monorepo with two packages (NestJS server, Next.js client), a husky pre-push hook that runs the full suite locally, and two deploy pipelines (Render via API trigger, Vercel via CLI) that originally deployed on push to `main` with **no** CI checks.

## Decision
- A single reusable workflow (`quality-gate.yml`, `on: workflow_call`) runs server (lint → 733 Jest tests → build) and client (lint → 102 Vitest tests → build) jobs with boolean inputs.
- `ci.yml` calls it on every PR and push to main; each deploy workflow calls only the half it deploys and makes `deploy` **`needs: quality`**. Concurrency groups prevent overlapping deploys.
- Cold-runner proofing: `prisma generate` runs immediately after `npm ci` — on a fresh runner `@prisma/client` is an ungenerated stub and both ts-jest and `nest build` fail with TS2305 on every model import. The build script's own generate runs too late for a cold install.

## Consequences
- Nothing reaches Render or Vercel without lint + 835 tests + build passing — and because neither host project is git-connected, the workflow is the *only* deploy path (no bypass).
- The same suite runs in three environments (pre-push hook, CI, deploy gate) with identical commands.
- Hardening lessons from rollout are part of the commit history: `permissions: {}` breaks checkout of private repos (GitHub masks it as "repository not found" — grant `contents: read`).
