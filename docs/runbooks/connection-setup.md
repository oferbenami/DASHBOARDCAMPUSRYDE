# Connection Setup (Excel Drive + Vercel)

## 1) Fill environment values
Create `.env.local` from `.env.example` and set:
- `DB_PROVIDER=excel`
- `EXCEL_DB_PATH` to your Drive synced file path
  - Example: `C:\Users\oferi\My Drive\dashboardcampus\operations-store.xlsx`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

## 2) Validate local connectivity
```bash
npm run check:connections
```

## 3) Run API + Web locally
```bash
npm --workspace @dashboardryde/api run dev
```
Open `apps/web/src/index.html` in browser (or host statically) and set API base URL + session token.

## 4) Configure Vercel env vars
```bash
vercel link
vercel env add DB_PROVIDER
vercel env add EXCEL_DB_PATH
vercel env add GOOGLE_OAUTH_CLIENT_ID
vercel env add GOOGLE_OAUTH_CLIENT_SECRET
```

## 5) Deploy
```bash
vercel --prod
```

## 6) Smoke tests
- `GET /api/health`
- `PUT /api/daily-metrics/{date}/pickup`
- `POST /api/incidents`
- `POST /api/incidents/recalculate`
- `GET /api/audit-log`
