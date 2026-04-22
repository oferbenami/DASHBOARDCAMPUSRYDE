# API Stage 3 Contracts

## Infrastructure baseline
- Database provider: `excel` (default), path in Drive via `EXCEL_DB_PATH`
- Optional provider: `supabase`
- Hosting: Vercel (Serverless API)

## Required environment variables
- `DB_PROVIDER` (`excel` or `supabase`)
- `EXCEL_DB_PATH` (when `DB_PROVIDER=excel`)
- `SUPABASE_URL` (when `DB_PROVIDER=supabase`)
- `SUPABASE_SERVICE_ROLE_KEY` (when `DB_PROVIDER=supabase`)
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `SESSION_TTL_HOURS`

## Core APIs
- `GET /health`
- `POST /auth/google/callback`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /audit-log`

## Daily operations APIs
- `GET /daily-metrics?date=YYYY-MM-DD`
- `PUT /daily-metrics/:date/:serviceType` (`serviceType`=`pickup|dropoff`)
- `GET /incidents?date=&serviceType=`
- `POST /incidents`
- `PUT /incidents/:id`
- `POST /incidents/recalculate`
- `PUT /day-types/:date`

## Validation rules
- Quantitative fields must be integers >= 0.
- `affectedPassengers <= registeredPassengers`
- `issuesCount <= ridesCount`
- `delayMinutes` is mandatory when `issueType=delay`.

All non-health endpoints require `Authorization: Bearer <sessionToken>`.
