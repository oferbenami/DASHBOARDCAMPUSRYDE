# Environment Runbook

## Environments
- `dev`: shared integration environment for feature branches.
- `stage`: pre-production verification and UAT.
- `prod`: production runtime.

## Platform mapping
- Hosting: Vercel projects for Web and API
- Database: Supabase project per environment tier

## Required variables
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `SESSION_TTL_HOURS`
- `WEB_BASE_URL`
- `VERCEL_ENV`
- `VERCEL_PROJECT_ID`

## Logging and monitoring baseline
- API emits structured JSON logs to stdout.
- Uptime checks target `/api/health`.
- Alerts and SLO thresholds are finalized in stage 7.

## Deployment baseline
- Every merge to main triggers CI validation.
- Promotion gates from dev -> stage -> prod are executed through Vercel environment promotions.
