# 04 - KPI Engine and Dashboard

## Objective
Implement KPI computation engine, trend aggregation, and dashboard cards/charts.

## Owned Components
- KPI query APIs (`summary`, `trends`, stream)
- Dashboard page updates with KPI cards + trend table
- Auto-refresh behavior (polling and SSE-ready endpoint)

## APIs delivered in stage 4
- `GET /kpi/summary?dateFrom=&dateTo=`
- `GET /kpi/trends?dateFrom=&dateTo=`
- `GET /kpi/stream?dateFrom=&dateTo=`

## Acceptance
- KPI totals are aggregated from daily metrics (pickup/dropoff/total).
- Trend points are returned per day for selected range.
- Dashboard UI shows KPI cards and trend table without manual page refresh.

## Entry Dependency
- Stage 3 approved.
