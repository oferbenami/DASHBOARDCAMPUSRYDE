# API Stage 5 Contracts

## Infrastructure baseline
- Database provider: `excel` only
- `EXCEL_DB_PATH` is required
- Hosting: Vercel (Serverless API)

## Core APIs
- `GET /health`
- `POST /auth/google/callback`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /audit-log`

## Daily operations APIs
- `GET /daily-metrics?date=YYYY-MM-DD`
- `PUT /daily-metrics/:date/:serviceType`
- `GET /incidents?date=&serviceType=`
- `POST /incidents`
- `PUT /incidents/:id`
- `POST /incidents/recalculate`
- `PUT /day-types/:date`
- `GET /day-types?dateFrom=&dateTo=`

## KPI APIs
- `GET /kpi/summary?dateFrom=&dateTo=`
- `GET /kpi/trends?dateFrom=&dateTo=`
- `GET /kpi/stream?dateFrom=&dateTo=`
- `GET /kpi/drilldown?dateFrom=&dateTo=&serviceType=&metricKey=`

## Management APIs
- `GET /management/targets?metricKey=&scopeKey=`
- `POST /management/targets`
- `GET /management/thresholds?metricKey=`
- `PUT /management/thresholds/:metricKey`

All non-health endpoints require `Authorization: Bearer <sessionToken>`.

## Export APIs
- GET /export/excel?dateFrom=&dateTo= 
- GET /export/pdf?dateFrom=&dateTo= 


## Hardening
- Global and auth-specific rate limiting is enabled.
- Security headers are added to JSON, SSE, and export responses.

## Deployment note
- Before deploy/startup, verify `DB_PROVIDER=excel` and a valid writable `EXCEL_DB_PATH`.
- After deploy, call `GET /health` and verify `infra.database === "excel"`.
- If provider is misconfigured, API returns `503` with `code: "PROVIDER_MISCONFIGURED"`.

