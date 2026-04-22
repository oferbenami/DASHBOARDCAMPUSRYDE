# Stage 1 - Foundation and Architecture

## Goals
- Establish repository structure for parallel work.
- Define platform architecture and delivery boundaries.
- Create CI baseline and environment runbook.

## Locked contracts in stage 1
- Workspace naming and ownership boundaries.
- API service health endpoint contract (`GET /health`).
- Delivery model: web + hybrid wrapper.
- Hosting lock: Vercel.
- Database lock: Supabase PostgreSQL.

## Out of scope for stage 1
- Business entities and database schema details.
- KPI formulas implementation.
- Daily operations UI and drilldown flows.

## Team split for parallel execution
- Team A: Infrastructure and CI
- Team B: API foundation
- Team C: Web/mobile shell and UX framework

## Stage completion definition
- Structure validated by `npm run check`.
- CI workflow present and executable in GitHub Actions.
- Core architecture decisions documented via ADR.
