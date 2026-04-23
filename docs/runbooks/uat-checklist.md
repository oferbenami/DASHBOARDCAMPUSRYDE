# UAT Checklist (Stage 7)

## Security & Session
- [ ] Login succeeds with valid Google token.
- [ ] Unauthorized requests return 401 for protected APIs.
- [ ] Rate limit returns 429 after sustained burst.
- [ ] Security headers exist (`x-content-type-options`, `x-frame-options`, `referrer-policy`).

## Daily Operations
- [ ] Save pickup and dropoff daily metrics.
- [ ] Create incident and update incident.
- [ ] Recalculate updates issues and affected passengers in daily metrics.
- [ ] Audit log records each update with before/after.

## KPI & Drilldown
- [ ] KPI summary returns totals for selected range.
- [ ] KPI trends return daily points.
- [ ] Drilldown returns daily rows and incidents for selected filters.

## Management
- [ ] Create target and list targets.
- [ ] Upsert threshold and list thresholds.
- [ ] Day type update/list works with date range filter.

## Export
- [ ] Excel export downloads and contains expected sheets.
- [ ] PDF export downloads and includes summary values.

## Mobile
- [ ] Daily operations usable in mobile viewport.
- [ ] Management section hidden in mobile viewport.
