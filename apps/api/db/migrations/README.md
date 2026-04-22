# DB Migrations (Stage 2)

## Files
- `001_init_identity.sql`: base tables for identity, sessions, audit, and management metadata.
- `002_indexes_identity.sql`: baseline indexes for auth and audit queries.

## Apply order
1. `001_init_identity.sql`
2. `002_indexes_identity.sql`

## Runtime target
Migrations are authored for Supabase PostgreSQL and are intended to run in Supabase SQL editor or migration pipeline.
