# ADR-0005: Size the Prisma pool for PgBouncer session mode; aggregate in SQL, not JS

**Status:** Accepted · **Date:** 2026-01 (documented after the incident)

## Context
Supabase is reached through PgBouncer in **session mode**. The Prisma pool was historically pinned to `connection_limit=1`; any concurrent request fan-out serialized and eventually timed out with P2024 errors surfacing as 500s.

## Decision
- Pool sized deliberately (`connection_limit=5`, tunable via env) and documented in `prisma.service.ts`.
- Default to **sequencing or combining** queries over `Promise.all` fan-out: multiple counts/aggregations collapse into single raw-SQL queries using `COUNT(*) FILTER (...)`; prefer `$queryRaw` with SUM/COUNT over `findMany` + JS reduce.
- The convention is written into the repo instructions so both humans and AI agents follow it.

## Consequences
- Predictable pooler load; the P2024 class of failure disappeared.
- Dashboards that used to fan out now issue one aggregate query per widget.
- Lesson generalized: connection pooling semantics (session vs transaction mode) are an architectural decision, not an infra detail — and prepared-statement interactions are a known follow-up if we ever move to transaction mode.
