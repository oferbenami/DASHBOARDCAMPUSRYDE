# DashboardRyde - Foundation Stage

This repository contains the staged implementation for the campus transport dashboard platform.

## Infrastructure lock
- Database: Supabase (PostgreSQL)
- Deployment: Vercel (Web + API)

## Workspace layout
- `apps/web`: Web UI shell (React + TypeScript placeholder)
- `apps/api`: API shell (Node + TypeScript placeholder)
- `apps/mobile`: Capacitor shell definition for hybrid mobile delivery
- `packages/config`: Shared config stubs
- `infra`: Cloud, docker, and monitoring scaffolding
- `docs`: Architecture decisions, runbooks, and stage plans

## Quick checks
```bash
npm run check
npm --workspace @dashboardryde/api test
npm run check:connections
```

Connection and deployment steps are documented in `docs/runbooks/connection-setup.md`.
