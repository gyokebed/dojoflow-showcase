# ADR-0009: Dojo Library — tenant-isolated RAG on pgvector

**Status:** Accepted (spike W-2) · **Date:** 2026-11-03

## Context

The Owner Copilot answers *structured* questions through tool-calling over the
relational DB (attendance, memberships, sessions). Owners also hold
*unstructured* institutional knowledge — tournament rules, seminar details,
belt-testing requirements, dojo etiquette — that no data model captures and no
tool can reach. We added a Dojo Library: owner-published documents chunked and
embedded into **pgvector on the existing Supabase Postgres**, retrieved by a
new `searchDojoLibrary` Copilot tool that filters by tenant at the SQL level
and refuses when nothing relevant is found.

## Decision

- **pgvector on the existing Postgres** (Supabase ships the extension) over a
  hosted vector store (Pinecone, Weaviate, pgvector in a separate DB) or
  serverless embeddings infra. Rationale: zero new infrastructure, tenant
  isolation in the same transactional DB, and the corpus is tiny (dozens of
  documents per dojo) — a scale-out vector DB would be noise.
- **Synchronous indexing.** On publish, chunk (hand-rolled ~400-token windows
  with 80-token overlap, word-boundary aligned) → embed → delete-and-insert
  chunks keyed on `(documentId, position)`. Unpublish purges chunks. At dojo
  corpus sizes a background queue buys nothing and costs a second moving part.
- **OpenAI embeddings via direct REST, no new npm dependency.** Anthropic has
  no embedding endpoint; adding `@ai-sdk/openai` would rewrite the pinned
  workspace lockfile (ADR-0008's failure mode). One bounded retry,
  `AbortSignal.timeout(30s)`, fail-soft `isEmbeddingConfigured` flag.
- **Tenant + published + locale filters in SQL** (`CLIENT` of the `<=>`
  operator query), never in the prompt. Retrieval is a single JOINed
  `$queryRaw` against published chunks only.
- **The model refuses below discoverability.** System prompt mandates naming
  the source document and saying "I do not have that information" when
  retrieval returns nothing — a hallucinated belt-test rule is worse than no
  answer.
- **Mixed retrieval deferred:** no BM25/hybrid RRF, no cross-encoder rerank,
  no parent-document small-to-big. Vector top-k with metadata filters is
  correct at this scale; the ADR notes them as the growth path past ~10K
  chunks/tenant.

## Measured evidence (eval run 2026-11-03, real Anthropic API)

- 7/7 pre-existing golden scenarios still pass (no regression from the new
  tool + prompt).
- **`unknown-refusal` passes even with embedding config absent** — the
  fail-soft path was exercised live: retrieval off ⇒ tool returns no results ⇒
  the model answered "don't have that information" instead of inventing a
  refund policy.
- The two grounded scenarios (`tournament-deadline`, `belt-testing-rules`)
  are gated on a real `OPENAI_API_KEY` for indexing; fixture + seed script
  (`npm run seed:dojo-library`) are in place to complete them.

## Consequences

- New secret required in prod: **`OPENAI_API_KEY`** on Render. Until present,
  the feature fail-softs (library search returns no results; saved as draft is
  unaffected; publish attempts raise 503 explaining indexing didn't happen).
- `DojoDocument`/`DojoDocumentChunk` are two Prisma models + one hand-authored
  migration (`CREATE EXTENSION IF NOT EXISTS vector;` + HNSW cosine index);
  prod deploy gated behind `migrate:prod:deploy` (ADR-0006).
- Chunk ids are position-stable only for replace-then-insert (delete-all +
  insert), so `(documentId, position)` uniqueness holds across re-publishes.
- The agent answers in the document's language: locale is a retrieval filter,
  so a Spanish corpus answers in Spanish; en/es corpora never mix.
