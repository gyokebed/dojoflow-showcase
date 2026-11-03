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

- **10/10 scenarios pass** ($0.153 full run, 82.7s, ~35.3K in / 3.1K out tokens):
  7 pre-existing golden scenarios still pass (no regression from the new tool
  + prompt); both grounded scenarios pass **with a facing citation line**
  (`Source: <document title>`) verified in the final answer; the
  `unknown-refusal` scenario passes — the model says "I do not have that
  information" instead of inventing a refund policy.
- The citation line is enforced by prompt, not luck: the system prompt
  mandates `Source: <title>` and the finalizing (structuring) pass is
  instructed to preserve it.
- Evals are heuristic by design (LLM output isn't deterministic): facts are
  asserted as substrings (`december 15`, source names) rather than exact
  match; scenario keywords were tightened after a first run surfaced
  `'register'` vs `'registration'` phrasing.
- Fail-soft path was also exercised live: with embedding config absent, the
  same harness still passed the refusal scenario while the grounded ones
  reported their blocker. (Complete numbers in `eval-reports/latest.json`.)

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
