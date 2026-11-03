# ADR-0003: No LangGraph checkpointer — human-in-the-loop is a database state transition

**Status:** Accepted · **Date:** 2026-07

## Context
The announcement-drafting agent needs a pause point: a human (OWNER/ADMIN) must approve before anything is finalized or sent. LangGraph's `interrupt()` provides this — but it hard-requires a checkpointer, and a known async-context bug can leak state between concurrent callers of a shared compiled graph. Unacceptable in a multi-tenant SaaS.

## Decision
Run the Draft→Review loop synchronously inside a single `.invoke()`. Model the approval pause as a plain Prisma status transition on an `AgentRun` row (`PENDING_APPROVAL → FINALIZED | REJECTED`), entirely outside LangGraph. A dedicated `/agent-approvals` page drives the human step.

## Consequences
- No checkpointer dependency, no cross-caller state leakage surface, and the pause point is queryable, auditable, and survives restarts for free.
- LangGraph is used for what it's good at (graph structure, routing) and nothing else; every node calls the same in-house `ai.service.ts` methods the Q&A and streaming features use — one model client, one tracing wrapper, one cost primitive.
- If runs ever need multi-day resumable graphs, the `AgentRun` state machine extends without re-architecting.
