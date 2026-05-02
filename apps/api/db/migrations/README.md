# DB Migrations (Stage 2)

## Files
- `001_init_identity.sql`: base tables for identity, sessions, audit, and management metadata.
- `002_indexes_identity.sql`: baseline indexes for auth and audit queries.
- `003_stage3_6_core.sql`: daily operations, incidents, thresholds, and stage 3-6 indexing support for Supabase runtime.
- `004_management_targets.sql`: targets history hardening and management indexes.

## Apply order
1. `001_init_identity.sql`
2. `002_indexes_identity.sql`
3. `003_stage3_6_core.sql`
4. `004_management_targets.sql`

## Runtime target
Migrations are authored for Supabase PostgreSQL and are intended to run in Supabase SQL editor or migration pipeline.
