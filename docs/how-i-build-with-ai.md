# How I build with AI

AI multiplies my throughput; specs, tests, and evals keep it honest. This is the actual workflow behind 124K LOC, 835 tests, and 14 months of solo shipping — not aspiration.

## 1. Spec first, code second

Every non-trivial change in DojoFlow starts as a written spec: `specs/<change-id>/spec.md` (what & why, constraints, constitution checks like "tenant isolation preserved") and `plan.md` (how, file-level). Writing the spec is where the thinking happens; the AI then implements against a contract instead of vibing. ~230 spec'd changes so far. Sample titles from the repo: `doj-27-membership-payment-types`, `feat/enrollment-age-gating-and-student-tests`, `chore/normalize-prod-fk-on-update-cascade`.

## 2. Two-agent split

- **Claude Code** owns the codebase: edits, refactors, tests, migrations, PRs. It never guesses scope — the spec bounds it.
- **Hermes Agent** (a different assistant) owns research, planning, architecture comparisons, background monitoring, and codebase Q&A. When it needs to touch code it runs in a worktree so its changes are isolated and reviewable.

The split matters: the coding agent stays deep in context; the planning agent stays cheap and parallel. Cross-checking two models on design questions catches blind spots a single model rationalizes away.

## 3. Verification is the job

The pattern that makes AI output trustworthy:

1. **Run the real thing.** Cold-state verification — delete generated artifacts (`node_modules/.prisma`, `.next`), scrub env vars, reproduce the CI/depoy environment locally before claiming a fix. Warm-machine results prove nothing.
2. **Tests as the contract.** 835 of them, gated in CI and pre-push. Bug → regression test that fails first. AI-written code lands through the same gate as human-written code.
3. **Evals for AI features.** The Copilot has a golden-dataset eval running against the real Anthropic API: pass rate, latency, tokens, cost per scenario. A prompt or model change without an eval run doesn't ship.

Concrete example: in one day this workflow shipped a CI quality-gate PR where the AI agent caught — via the repo's own pre-push hook — a nondeterministic jsdom `localStorage` failure (14 specs), root-caused it to a Node-26 global-injection quirk, fixed it with a deterministic setup-file polyfill, and then debugged a production deploy failure by comparing the deployed file count (440) against `git ls-files` (441) to prove the fix was shipping to the wrong deployment scope. Every step verified against reality, not assumed.

## 4. AI needs guardrails exactly like code does

The announcement agent has max-tool-calls, retry ceilings, and model-call budgets — each independently tested to fail safely — and its output pauses for human approval as a database state transition. I apply the same philosophy to my own AI usage: bounded scope (specs), budgets (CI minutes, eval cost), and a human approval step before anything reaches production (PRs I review and merge).

## 5. What this buys

Solo founder-output that looks like a small team: a production multi-tenant SaaS with Stripe billing, WhatsApp/email, an AI copilot with observability and evals, 835 tests, CI/CD with gated deploys — while the human hours go to product judgment, architecture, and the parts AI is bad at: knowing what's worth building.
