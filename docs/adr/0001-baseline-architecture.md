# ADR-0001: Baseline Platform Architecture

## Status
Accepted - 2026-04-22

## Decision
Adopt a monorepo with three deployable surfaces:
1. Web app (responsive LTR Hebrew UI), deployed on Vercel
2. API service (REST-first), deployed on Vercel Serverless
3. Hybrid mobile shell (Capacitor over web app)

Database platform is locked to Supabase PostgreSQL.

## Rationale
- Shared domain logic and UI assets between web and mobile wrappers.
- Fast team parallelization via workspace isolation.
- Vercel + Supabase provides managed runtime and managed Postgres with low ops overhead.

## Consequences
- Stage 1 provides contracts and scaffolding only.
- Domain modules (metrics, incidents, targets) are explicitly deferred to later stages.
- All persistence contracts must be implementable on Supabase.
