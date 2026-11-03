# DojoFlow — Architecture

## System shape

**Modular monolith** on the server, monorepo on the wire:

```
arquitechta-core/
├── packages/client/   Next.js 15 (App Router, React 19 RSC, next-intl, Tailwind, Radix)
└── packages/server/   NestJS 11 (30+ feature modules, Prisma 6, PostgreSQL/Supabase)
```

Two packages, one lockfile, one quality gate. Deployed separately: client on
Vercel, API on Render, database on Supabase (PgBouncer session-mode pooling).

The platform is **multi-tenant** (strict per-tenant data isolation, app-layer
enforced + tested) and **multi-vertical**: a core layer (auth, tenants,
payments, communications, AI) is shared, while vertical packs (Martial Arts
live; Fitness and Wellness in build-out) drive terminology, feature flags,
onboarding, and AI prompts per tenant.

## The request path

1. **Client** — React Server Components render the shell; client components
   call a typed fetch layer with request timeout classification, optimistic
   updates, and a copilot chat reducer (all unit-tested) against `/v1/*`.
2. **API** — NestJS global prefix `/v1`, JWT access/refresh pair (Argon2id
   password hashing), role guard + capability service resolve what the caller
   may do *in this tenant*. DTO validation at the boundary.
3. **Data** — Prisma 6 against PostgreSQL. Every query is tenant-scoped;
   isolation is covered by concurrency tests (see
   `code/agents/agents.service.concurrency.spec.ts` for the pattern).
4. **Side effects** — Stripe (subscriptions + Connect payouts, webhook-driven
   billing lifecycle), Resend (transactional email), WhatsApp Business Cloud,
   Cloudinary (images).

## The AI layer

| Capability | Design |
|---|---|
| Q&A (tool calling) | `POST /v1/ai/copilot` → model calls Zod-parameterized tools (attendance stats, membership status, upcoming sessions) backed by Prisma. Hard max-tool-calls ceiling prevents loops. |
| Streaming | `streamText().toTextStreamResponse()` bridged into Express via `Readable.fromWeb().pipe(res)`; client renders token-by-token with stop/error states. |
| Announcement agent | LangGraph state machine: Draft → Review (self-correcting, bounded retries) → **pause for OWNER/ADMIN approval** (a Prisma state transition, not framework magic) → finalize. |
| Guardrails | Max-tool-calls, MAX_RETRIES, MAX_MODEL_CALLS_PER_RUN — each independently tested to fail safely. |
| Observability & evals | Every model call traced via Langfuse; golden-dataset eval script runs real scenarios against the real API and reports pass rate/latency/tokens/cost. |

Key trade-offs are documented as ADRs — notably
[ADR-0003](adr/0003-no-langgraph-checkpointer.md) (why human-in-the-loop is a
database state machine) and [ADR-0002](adr/0002-ai-sdk-node-20-pin.md) (why the
AI SDK is version-pinned).

## Scheduling

Class schedules are RFC-5545 RRule recurrences stored per session with a
timezone; occurrences expand for calendars/attendance; exceptions handled.
Belt progression is a first-class graph: levels → belts → promotions with
history, driving promotions, requirements and the student-facing progress view.

## Billing (Mexico-first)

Stripe for cards/subscriptions **plus** first-class manual flows: cash and
bank-transfer memberships with owner confirmation, grace windows, expiry
sweeps (idempotent cron), renewal reminders (one per period), and pause with
lossless resume. Tenants keep multiple bank accounts; per-tenant currency.

## Quality infrastructure

- Husky pre-push hook (lint → build → test both packages) — the local gate
- GitHub Actions quality gate (same suite, cold-runner-proof: Prisma client
  generated before any TS compilation) — the CI gate
- Deploy workflows *require* the gate before touching Render/Vercel
- Deterministic, lockfile-driven deploy installs with pinned runtimes

See [ADR-0007](adr/0007-monorepo-quality-gate.md) and
[ADR-0008](adr/0008-deterministic-deploys.md).
