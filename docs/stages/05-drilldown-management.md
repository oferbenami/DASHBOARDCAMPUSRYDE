# 05 - Drilldown and Management

## Objective
Deliver KPI drilldown, management screens, and edit flows from drilldown.

## Owned Components
- Drilldown data APIs and raw data exposure
- Management APIs/UI for targets, thresholds, and day types listing
- Change history view through audit log

## APIs delivered in stage 5
- `GET /kpi/drilldown?dateFrom=&dateTo=&serviceType=&metricKey=`
- `GET /management/targets?metricKey=&scopeKey=`
- `POST /management/targets`
- `GET /management/thresholds?metricKey=`
- `PUT /management/thresholds/:metricKey`
- `GET /day-types?dateFrom=&dateTo=`

## Acceptance
- Drilldown returns daily raw rows + related incidents.
- Targets and thresholds can be managed from UI/API.
- All management writes are audited.

## Entry Dependency
- Stage 4 approved.
