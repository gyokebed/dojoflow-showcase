# ADR-0002: Pin the Vercel AI SDK to the Node-20-compatible generation

**Status:** Accepted · **Date:** 2026-07

## Context
The AI layer (tool calling, structured outputs, streaming) runs on the Vercel AI SDK + `@ai-sdk/anthropic` against Anthropic models. The repo runs Node 20 (devcontainer + production). AI SDK v7 requires Node ≥ 22.

## Decision
Pin `ai`@5 / `@ai-sdk/anthropic`@2. Verify a dependency's `engines` field with a real spike before adopting it — never trust prose in migration guides.

## Consequences
- Same Node everywhere: devcontainer, CI, Render. No runtime split-brain.
- This exact trap (docs assuming a newer Node) recurred three times in one month across three different libraries (AI SDK v7, LangGraph migration guide, Langfuse's official integration). The fix was the same each time — which is why it became a written rule instead of a habit.
- Upgrading to v7 is a deliberate, scheduled spike: bump Node across all environments first, then re-run the eval suite (`npm run eval:ai`) before merging.
