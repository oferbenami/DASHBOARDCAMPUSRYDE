# 02 - Data and Identity Core

## Objective
Implement database schema v1, migrations, identity, and audit core.

## Owned Components
- DB schema and migration scripts for Supabase Postgres
- Auth service (Google SSO)
- Audit log persistence model with switchable backend

## APIs delivered in stage 2
- `POST /auth/google/callback`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /audit-log`

## Data artifacts delivered in stage 2
- SQL migrations for `users`, `sessions`, `audit_log`, `targets_history`, `day_types`
- Baseline index migration
- Persistence runtime with provider switch:
  - `DB_PROVIDER=excel` (default, initial phase)
  - `DB_PROVIDER=supabase` (next phase)

## Acceptance
- Auth flow works with Google token validation endpoint.
- Session lifecycle (create/read/revoke) is enforced.
- Audit log persists before/after snapshots and supports filtering.
- Stage 2 tests pass.

## Entry Dependency
- Stage 1 approved.
