# Deployment

| Component | Host | Notes |
|---|---|---|
| Flutter Web | Vercel project `wayfarer-web` (static, SPA rewrite) | `app/web/vercel.json` |
| API | Vercel project `wayfarer-api` (Node serverless, `backend/api/index.ts`) | env vars set in Vercel |
| Database | Neon PostgreSQL | migrations/seed run from a trusted machine |

## Steps
```bash
# API
cd backend
vercel env add DATABASE_URL production        # + JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PAYMENT_WEBHOOK_SECRET, DEMO_PASSWORD
DATABASE_URL=... npm run migrate && npm run seed
vercel deploy --prod

# Web
cd app && flutter build web --release --dart-define=API_BASE_URL=https://<api>/api
cp web/vercel.json build/web/ && cd build/web && vercel deploy --prod
```
## Limits
Serverless cold starts (~1-2 s), no background jobs (holds expire lazily), Vercel function timeout 30 s, preview deployments may be behind Vercel authentication (production aliases are public).

## Verified
Both production URLs respond over HTTPS independent of the developer machine; API reports `database: neon-pg`.
