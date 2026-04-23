# 06 - Export and Mobile Completion

## Objective
Deliver PDF/Excel exports and finalize hybrid mobile capabilities.

## Owned Components
- Export services and templates (Excel + PDF)
- Mobile behavior: management hidden on mobile viewport
- LTR responsiveness tuning for dashboard and daily operations

## APIs delivered in stage 6
- `GET /export/excel?dateFrom=&dateTo=`
- `GET /export/pdf?dateFrom=&dateTo=`

## Acceptance
- Exported Excel includes summary, trends, raw rows, incidents, targets, thresholds, and day types.
- Exported PDF includes KPI summary and key counts.
- Mobile view keeps operational capabilities and hides targets/thresholds management UI.

## Entry Dependency
- Stage 5 approved.
