# ADR-0001: Baseline Platform Architecture

## Status
Accepted - 2026-04-22

## Decision
Adopt a monorepo with three deployable surfaces:
1. Web app (responsive LTR Hebrew UI), deployed on Vercel
2. API service (REST-first), deployed on Vercel Serverless
3. Hybrid mobile shell (Capacitor over web app)

Data persistence strategy:
- Initial phase: Excel workbook in Drive-synced path
- Next phase: Supabase PostgreSQL

## Rationale
- Shared domain logic and UI assets between web and mobile wrappers.
- Fast team parallelization via workspace isolation.
- Excel-first onboarding reduces setup friction at project start.

## Consequences
- Stage 1 provides contracts and scaffolding only.
- Domain modules (metrics, incidents, targets) are explicitly deferred to later stages.
- Persistence layer remains provider-based to enable controlled migration to Supabase.
