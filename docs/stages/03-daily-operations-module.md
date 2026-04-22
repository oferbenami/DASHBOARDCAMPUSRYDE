# 03 - Daily Operations Module

## Objective
Deliver daily input flow (pickup/dropoff), incidents panel, and validations.

## Owned Components
- Daily metrics write/read APIs
- Incident CRUD + recalculation API
- Day types upsert API
- Basic web daily input screen (mobile compatible)

## APIs delivered in stage 3
- `GET /daily-metrics?date=YYYY-MM-DD`
- `PUT /daily-metrics/:date/:serviceType`
- `GET /incidents?date=&serviceType=`
- `POST /incidents`
- `PUT /incidents/:id`
- `POST /incidents/recalculate`
- `PUT /day-types/:date`

## Acceptance
- Two daily sections are available: `dropoff(yesterday)` and `pickup(today)`.
- Incident panel supports create/list and recalculation into daily metrics.
- Validation rules enforce non-negative integers and delay minutes requirement.
- Full audit trail is recorded for daily metrics, incidents, and day types.

## Entry Dependency
- Stage 2 approved.
