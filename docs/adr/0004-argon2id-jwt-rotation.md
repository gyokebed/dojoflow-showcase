# ADR-0004: Argon2id + short-lived JWT access/refresh rotation

**Status:** Accepted · **Date:** 2025-08

## Context
Passwords and session tokens for a SaaS holding minors' data (schools, guardians, birthdays). Supabase provides SSO (Google OAuth); local passwords are also supported.

## Decision
- **Argon2id** for password hashing (memory-hard, GPU-resistant) over bcrypt.
- Short-lived **access JWT + rotating refresh token** (hashed at rest, revocable per account via `tokenVersion`), delivered as cookies with proper SameSite posture.
- Capability resolution (what this role may do *in this tenant*) computed server-side from persisted member types — never trusted from the client.

## Consequences
- Session theft has a short window; refresh rotation makes replay detectable.
- Role changes take effect on next token mint (tokenVersion bump forces it).
- The auth surface (guards, capability service, SSO linking, password reset) carries one of the densest test concentrations in the codebase.
