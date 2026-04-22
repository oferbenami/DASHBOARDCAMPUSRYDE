# 00 - Master Program Plan

## Objective
Coordinate all delivery stages with explicit gates and parallel team ownership.

## Team model
- Team A: Platform, CI/CD, Security baseline
- Team B: Data and identity
- Team C: Daily operations and incidents
- Team D: Dashboard, drilldown, mobile UX
- Team E: Export, QA, release

## Infrastructure lock
- Hosting/Distribution: Vercel
- Database: Supabase PostgreSQL

## Integration cadence
- Weekly integration cut on Thursdays.
- Stage gate approval required before next stage starts.

## Global acceptance
- Functional scope delivered per approved phase docs.
- Auditability and performance targets tracked from stage 2 onward.
- Integration, security, and UAT validations run on Vercel + Supabase stack only.
