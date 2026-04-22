# Connection Setup (Supabase + Vercel)

## 1) Fill environment values
Create `.env.local` from `.env.example` and set:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

## 2) Run migrations on Supabase
Execute SQL files in this order via Supabase SQL Editor:
1. `apps/api/db/migrations/001_init_identity.sql`
2. `apps/api/db/migrations/002_indexes_identity.sql`

## 3) Link and configure Vercel project
```bash
vercel link
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add GOOGLE_OAUTH_CLIENT_ID
vercel env add GOOGLE_OAUTH_CLIENT_SECRET
```

## 4) Validate locally
```bash
npm --workspace @dashboardryde/api run dev
node scripts/check-connections.mjs
```

## 5) Deploy
```bash
vercel --prod
```

## 6) Smoke tests
- `GET /api/health`
- `POST /api/auth/google/callback`
- `GET /api/auth/me`
- `GET /api/audit-log`
