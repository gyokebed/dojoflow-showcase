# ADR-0001: Multi-tenant isolation enforced in the application layer, proven by tests

**Status:** Accepted · **Date:** 2025-08

## Context
DojoFlow is multi-tenant from day one: every school's data must be invisible to every other school. Options: schema-per-tenant, database-per-tenant, or shared schema with a `tenantId` discriminator.

## Decision
Shared schema with a mandatory `tenantId` on every tenant-owned model, enforced at the **service layer**: all queries pass through tenant-scoped service methods; guards resolve the caller's active tenant from the JWT before any handler runs. Isolation is *proven* by concurrency tests that run two tenants' workflows in parallel with input-derived mocks — contamination would actually be caught (see `code/agents/agents.service.concurrency.spec.ts`).

## Consequences
- One migration path, one connection pool, simple operations at 100s of tenants.
- The invariant lives in discipline, not the database — mitigated by the test suite; PostgreSQL RLS remains available as defense-in-depth if the threat model grows (e.g., multi-region or third-party analysts).
- Cross-tenant features (a person training at two dojos) are modeled through explicit membership rows, never by weakening the discriminator.
