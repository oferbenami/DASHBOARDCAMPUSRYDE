# Incident Response Runbook

## Severity matrix
- P1: core flow unavailable (auth, daily save, recalculate, export)
- P2: degraded KPI/trends, partial management failures
- P3: non-blocking UI issues

## First 15 minutes
1. Confirm issue with `npm run smoke:prod` inputs.
2. Capture failing endpoint, status code, and timestamp.
3. Check latest audit entries and deployment id.
4. Decide rollback if P1 persists > 10 minutes.

## Communication template
- Incident started at: <time>
- Impact: <who/what>
- Current status: investigating/mitigating/resolved
- Next update in: <minutes>

## Closure
- Root cause summary
- User impact window
- Preventive action item(s)
