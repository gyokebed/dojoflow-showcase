# Case Study: Owner Copilot — An AI Product Engineering Sprint

> **Showcase note:** this is the verbatim engineering write-up from the private
> DojoFlow repository. It was written 2026-07-08 at the close of a 4-week AI
> roadmap. The test counts cited below (691 server + 95 client) have since
> grown to 733 + 102 = 835, all still green. Cross-references to repo-internal
> paths refer to the private monorepo; the referenced AI/agent code is
> exhibited in [`code/`](../code/).

*Written 2026-07-08, at the close of the 4-week roadmap in `docs/ai-product-engineer-roadmap.md`.*

## The pitch

Over four weeks, inside an existing multi-tenant gym-management SaaS (`arquitechta-core`), I built "Owner Copilot" — a single AI feature that exercises all four core AI-product-engineering skills in one coherent arc: tool-calling and structured outputs, full-stack streaming, stateful multi-agent orchestration, and observability/evals. Each week shipped on top of the last, on real production code, against a real Postgres database and the real Anthropic API — not a toy demo.

## What was built, week by week

1. **Tool-calling & structured outputs (Week 1).** A `POST /v1/ai/copilot` endpoint where an owner asks a plain-English question ("How many students attended this week?") and the model calls real, Zod-parameterized, Prisma-backed tools (attendance stats, membership status, upcoming sessions) before returning a structured, validated answer. A hardcoded max-tool-calls guardrail prevents runaway loops.
2. **Full-stack streaming (Week 2).** The same capability, streamed: `streamText(...).toTextStreamResponse()` bridged into Express via `Readable.fromWeb(...).pipe(res)`, with a `/copilot` dashboard page rendering the response token-by-token, including stop/error states.
3. **Stateful multi-agent flows (Week 3).** Asking the Copilot to "draft an announcement" kicks off a LangGraph.js state machine: Draft → Review (self-correcting, bounded retries) → pause for OWNER/ADMIN human approval → finalize. A new `AgentRun` Prisma model tracks the run; a dedicated `/agent-approvals` page handles the human-in-the-loop step.
4. **Observability & evals (Week 4, this write-up).** Every model call across all three capabilities is now traced through `LangfuseService`; a golden-dataset eval script (`npm run eval:ai`) runs real scenarios against the real API and reports pass rate, latency, tokens, and cost; a `/settings/ai-observability` page surfaces that report to the owner.

## Concrete numbers (Week 4 eval run, 2026-07-08)

Real run against the dev database, `claude-sonnet-4-5`, 7 scenarios spanning all three capabilities:

| Metric | Value |
|---|---|
| Scenarios passed | 7 / 7 |
| Total latency | 71.4s (avg ~10.2s/scenario) |
| Total tokens | 18,507 in / 1,829 out |
| Estimated cost | $0.083 for the full run |
| Cheapest scenario | `holiday-closure-announcement` — $0.0058 |
| Most expensive scenario | `upcoming-sessions` (Q&A, tool-calling) — $0.0196 |

Per-capability shape: Copilot Q&A (tool-calling) scenarios ran 8-12s and $0.011-$0.020 each — the extra latency/cost versus streaming comes from the second `generateObject` structuring pass. Streaming scenarios were faster (4.7-6s) since there's no second pass. The announcement-draft agent ran 10-21s — the wider range reflects the Draft↔Review loop sometimes needing a second draft pass, exactly the guardrail-bounded behavior Week 3 was built to demonstrate.

## Key architectural decisions (interview material)

- **Vercel AI SDK over raw `@anthropic-ai/sdk` or LangChain's `ChatAnthropic`**, and pinned to `ai`@5/`@ai-sdk/anthropic`@2 rather than the v7 generation — v7 needs Node ≥22, and this repo runs Node 20. This exact trap (docs assuming a newer Node than the repo has) recurred three times across the 4 weeks: `ai`@7, LangGraph's own migration guide, and Langfuse's official Vercel-AI-SDK integration. The recurring fix was the same each time: verify the actual `engines` field and a real spike, don't trust prose.
- **LangGraph.js for state/routing only, never a second model client.** Every node calls the same `ai.service.ts` methods the Q&A and streaming capabilities already use — no LangChain `ChatAnthropic` or `tool()` living alongside the Vercel AI SDK's equivalents.
- **No LangGraph checkpointer, no `interrupt()`.** `interrupt()` hard-requires a checkpointer with no official custom-Postgres-backed guide, and there's an open async-context bug where a compiled graph shared across concurrent invocations can leak data between callers — a real risk in a multi-tenant SaaS. Instead, the whole Draft↔Review loop runs synchronously inside one `.invoke()` call, and human approval is a plain Prisma status transition entirely outside LangGraph.
- **Langfuse via its plain JS SDK, not the official AI-SDK-telemetry integration.** `@langfuse/vercel-ai-sdk` needs AI SDK v7/Node ≥22 (same trap as above); the Node-20-compatible fallback (`langfuse-vercel` + `@vercel/otel`) chains three version-coupled packages and is purpose-built for Vercel's runtime, not a Render-hosted NestJS process — a mismatch likely to silently no-op. Wrapping the plain `langfuse` SDK by hand around the 4 `ai.service.ts` call sites is one dependency, needs no OTel bootstrapping at the top of `main.ts`, and covers every LangGraph node for free since Week 3's nodes call those same 4 methods.
- **One cost primitive, reused three times.** `pricing.ts`'s `estimateCostUsd()` is computed once and consumed by the eval report, the settings page, and (implicitly) whatever Langfuse itself reports once configured — not three separate pricing tables.
- **No new database table for cost/latency.** The roadmap's own bar was "even a logged summary is enough." `/settings/ai-observability` reads the JSON artifact `eval-ai.ts` already produces rather than persisting usage tracking in Postgres — avoiding a second migration and scope creep.

## Guardrails demonstrated

- Max-tool-calls ceiling on every tool-calling request (Week 1), inherited automatically by both the Q&A and streaming capabilities since it lives in `ai.service.ts`, not per-caller.
- `MAX_RETRIES` and `MAX_MODEL_CALLS_PER_RUN` on the announcement-draft agent (Week 3) — two independently-tested guardrails, verified to fail a run safely (`MAX_RETRIES_EXCEEDED` / `MODEL_CALL_CEILING_EXCEEDED`) rather than loop forever.
- A concurrency/tenant-isolation test proving two tenants' concurrent announcement drafts never cross-contaminate — input-derived mock responses, not fixed return values, so contamination would actually be caught.

## What's deliberately not done in this session (hand-off checklist)

Per this session's planning decisions, everything above was built and fully tested locally; the following gated, user-owned steps are next:

1. **Check the GitHub Actions tab** (`github.com/gyokebed/arquitechta-core/actions`) for whether the Week 1-3 backend push already auto-deployed. This matters independent of Week 4: if it did, prod is likely serving 500s on the `AgentRun`-backed endpoints right now, since the migration below hasn't run against prod yet.
2. **Run `npm run migrate:prod:deploy`** (requires typing `MIGRATE PROD`) to bring prod's schema up to date with `AgentRun`.
3. **Create a Langfuse Cloud account** (free Hobby tier, no card) and add `LANGFUSE_SECRET_KEY` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_HOST` to local `.env` and Render's dashboard env vars.
4. **Confirm Render's env vars are complete** (`ANTHROPIC_API_KEY`, model config, now `LANGFUSE_*`).
5. **Push this session's commits**, confirm both GitHub Actions workflows (backend/frontend) go green.
6. **Smoke-test the deployed endpoints** once the migration is live, and confirm a real trace appears in the Langfuse dashboard.

## On screenshots and the demo video

This sandbox has no Chrome/Playwright available (a recurring constraint across all four weeks — noted in each week's verified footnote), so no screenshots or the walkthrough video the roadmap's Demo Checkpoint calls for could be captured here. Everything above was verified instead via `tsc`, `eslint`, the full Jest/Vitest suites (691 server tests + 95 client tests, all green), and direct calls against the real Anthropic API and dev database — described in the numbers section above. Recording the walkthrough video and taking the `/settings/ai-observability` / `/agent-approvals` / `/copilot` screenshots is a natural next step once the hand-off checklist above is complete and there's a real browser available.
