# Go-Live Runbook (Stage 8)

## T-1 day
1. Validate env and secrets:
```bash
npm run preflight:go-live
```
2. Run full local regression:
```bash
npm --workspace @dashboardryde/api test
npm run check
```
3. Confirm UAT checklist sign-off in `docs/runbooks/uat-checklist.md`.

## Release window (T0)
1. Freeze writes (announce maintenance window).
2. Deploy current `main` to Vercel prod.
3. Run post-deploy smoke:
```bash
API_BASE_URL=https://<prod-api> SESSION_TOKEN=<token> npm run smoke:prod
```
4. Verify dashboard loads and export endpoints return files.

## Rollback criteria
- Any P1 failure in login, daily save, recalculate, or export.
- KPI summary unavailable for more than 5 minutes.

## Rollback action
- Redeploy previous stable Vercel deployment.
- Re-run smoke tests.
- Communicate rollback to stakeholders.
