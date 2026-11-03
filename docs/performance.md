# DojoFlow — Performance

Measured 2026-11-03 with Lighthouse (headless Chrome, `--only-categories=performance,accessibility,best-practices,seo`) against the production deployment at `dojoflow.mx`.

## Lighthouse (production)

| Page | Mode | Performance | Accessibility | Best Practices | SEO |
|---|---|---:|---:|---:|---:|
| `/en` (landing) | Desktop | **99** | 98 | 96 | 90 |
| `/en` (landing) | Mobile | **88** | 91 | 96 | 90 |
| `/en/demo` | Desktop | **99** | 98 | 96 | 90 |
| `/en/demo` | Mobile | **97** | 98 | 96 | 90 |

### Key vitals

| Metric | Landing desktop | Landing mobile | /demo desktop | /demo mobile |
|---|---|---|---|---|
| First Contentful Paint | 0.4 s | 1.1 s | 0.4 s | 1.1 s |
| Largest Contentful Paint | 0.9 s | **3.2 s** ⚠️ | 0.9 s | 1.1 s |
| Total Blocking Time | 0 ms | 70 ms | 0 ms | 10 ms |
| Cumulative Layout Shift | **0** | **0** | **0** | **0** |
| Speed Index | 1.2 s | 5.5 s | 0.8 s | 4.8 s |

Zero layout shift everywhere; interactivity is essentially unblocked (TBT ≤ 70 ms).

**Known gap (documented, not hidden):** the landing page's mobile LCP of 3.2 s
drives the 88 mobile score — the hero section's animation payload and web fonts
load ahead of the largest text block. Planned fixes, in order of expected impact:
self-host critical fonts with `size-adjust` fallbacks, `priority` hint on the
hero image, and gating Framer Motion's initial animation behind idle. The
`/demo` page (same shell, no animated hero) scoring 97 mobile confirms the
budget is reachable.

## Server-side timing (measured from Mexico, 2026-11-02)

| Endpoint | TTFB | Notes |
|---|---|---|
| `dojoflow.mx/en` | 330–420 ms | Vercel edge (iad1), dynamic render, hreflang + security headers |
| `api.dojoflow.mx/v1` | ~430 ms | Render (Washington, D.C.) |

## A documented optimization: the Prisma pool exhaustion incident

**Symptom:** intermittent 500s under request fan-out. **Root cause:** the
Prisma pool was pinned to `connection_limit=1` behind Supabase's PgBouncer
(session mode); concurrent dashboard queries serialized and timed out with
P2024 pool errors.

**Fix (measured before/after on the dashboard aggregates):**
- Pool raised to `connection_limit=5` (env-tunable), with the sizing rationale
  documented in `prisma.service.ts` so the constraint is visible, not tribal.
- Widget aggregations that previously fanned out N parallel `findMany` +
  JS reduce calls collapsed into **single raw-SQL queries** using
  `COUNT(*) FILTER (...)` — one round trip per widget instead of up to 2N.

**Outcome:** the P2024 failure class disappeared entirely; the convention
("sequence or combine — don't `Promise.all` fan-out") is written into the
repo instructions for both human and AI contributors. Full decision record:
[ADR-0005](adr/0005-pgbouncer-pool-discipline.md).

## Build & deploy pipeline performance

- Cold `npm ci` (both workspaces) + lint + 835 tests + builds: the CI quality
  gate runs in ~7–8 minutes on a 2-core GitHub runner, ~1 min warm.
- Deploy builds are deterministic (`npm ci` from committed lockfiles, Node 20
  pinned) — no resolution variance between runs.
