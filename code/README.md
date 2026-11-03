# Code exhibits

Read-only excerpts from the private repository `gyokebed/arquitechta-core`
(provenance commit in each file's header). Selected to demonstrate the four
areas interviewers ask about most. The full codebase — 124K LOC, 44-model
schema, 835 tests, CI/CD — remains private; time-boxed read access on request.

| Directory | Contents |
|---|---|
| `ai-copilot/` | The AI service (Vercel AI SDK + Anthropic): tool calling with Zod contracts, max-tool-calls guardrail, structured outputs, streaming. Four Zod-parameterized tools backed by Prisma. The copilot service that ties them together. |
| `agents/` | LangGraph announcement agent: service (guardrails, run lifecycle), the Draft→Review graph, both nodes, and the tenant-isolation concurrency spec — the test that proves two tenants' agent runs never cross-contaminate, using input-derived mocks. |
| `auth-rbac/` | Roles guard, capability service (role→capability resolution per tenant), and the tenant service spec. |
| `platform/` | Prisma service: PgBouncer-aware pool sizing, raw-SQL helpers, graceful shutdown. |

**Reading order suggestion:** `ai-copilot/ai.service.ts` → one tool (e.g.
`attendance-stats.tool.ts`) → `agents/announcement.graph.ts` →
`agents/agents.service.concurrency.spec.ts`.
