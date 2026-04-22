# API Stage 2 Contracts

## Infrastructure baseline
- Database: Supabase Postgres
- Hosting: Vercel (Serverless API)

## Required environment variables
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (reserved for web clients)
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `SESSION_TTL_HOURS`

## Health
`GET /health`

Response:
```json
{
  "status": "ok",
  "stage": 2,
  "infra": { "database": "supabase", "hosting": "vercel" }
}
```

## Google callback
`POST /auth/google/callback`

Body:
```json
{ "idToken": "<google_id_token>" }
```

Response:
```json
{
  "user": { "id": "...", "email": "...", "fullName": "..." },
  "session": { "token": "...", "expiresAt": "..." }
}
```

## Current user
`GET /auth/me`
Header: `Authorization: Bearer <sessionToken>`

## Logout
`POST /auth/logout`
Header: `Authorization: Bearer <sessionToken>`

## Audit log
`GET /audit-log?actorUserId=&entityType=&action=&dateFrom=&dateTo=&limit=`
Header: `Authorization: Bearer <sessionToken>`
