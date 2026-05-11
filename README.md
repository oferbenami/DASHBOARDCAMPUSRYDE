# DashboardRyde - Foundation Stage

This repository contains the staged implementation for the campus transport dashboard platform.

## Infrastructure lock (current)
- Initial database: Excel file in Drive-synced path
- Deployment: Vercel (Web + API)
- Future database target: Supabase (PostgreSQL)
- Production runtime is currently locked to `DB_PROVIDER=excel`.

## Workspace layout
- `apps/web`: Web UI shell (React + TypeScript placeholder)
- `apps/api`: API shell (Node + TypeScript placeholder)
- `apps/mobile`: Capacitor shell definition for hybrid mobile delivery
- `packages/config`: Shared config stubs
- `infra`: Cloud, docker, and monitoring scaffolding
- `docs`: Architecture decisions, runbooks, and stage plans

## Quick checks
```bash
npm run build
npm run build:web
npm run check
npm --workspace @dashboardryde/api test
npm run check:connections
```

`npm run build` at the repository root currently builds Web only (`@dashboardryde/web`).
API/Mobile build pipelines are not part of the root build at this stage.

Connection and deployment steps are documented in `docs/runbooks/connection-setup.md`.
Provider and production validation checklist is documented in `apps/api/README.md`.

## Release hard gate (required)
Use this flow on every release to prevent auth/login regressions:

1. `npm run check`
2. Preview/UAT target:
   - `WEB_BASE_URL=<preview-url> npm run smoke:auth`
   - `API_BASE_URL=<preview-url> SESSION_TOKEN=<uat-token> WEB_BASE_URL=<preview-url> npm run smoke:release`
3. Deploy to production.
4. Production target:
   - `WEB_BASE_URL=https://dashboarscampusryde.vercel.app npm run smoke:auth`
   - `API_BASE_URL=https://dashboarscampusryde.vercel.app SESSION_TOKEN=<prod-token> WEB_BASE_URL=https://dashboarscampusryde.vercel.app npm run smoke:release`

### Fail policy
- Any failed smoke command blocks release approval and promotion.
- Do not close a release cycle until all commands above pass.
