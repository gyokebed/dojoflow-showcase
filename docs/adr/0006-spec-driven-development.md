# ADR-0006: Spec-driven development for every non-trivial change

**Status:** Accepted · **Date:** 2025-09, evolving

## Context
A solo founder shipping a large SaaS with AI assistance needs a mechanism that keeps changes reviewable, bounded, and explainable six months later.

## Decision
Non-trivial changes begin as `specs/<change-id>/spec.md` + `plan.md`: problem, constraints, constitution checks (monorepo structure, tenant isolation, API stability), file-level plan, and test plan. Branches are named after the spec. The coding agent implements against the spec; the pre-push hook and CI gate verify it.

## Consequences
- The `specs/` directory doubles as an architectural changelog — ~230 change folders to date.
- AI-generated code arrives scoped and reviewable instead of sprawling.
- Overhead is real for tiny fixes; the rule is "non-trivial" and enforced with judgment, not bureaucracy.
- This practice is the backbone of [How I build with AI](../how-i-build-with-ai.md).
