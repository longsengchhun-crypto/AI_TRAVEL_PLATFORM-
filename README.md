# WAYFARER: AI Travel, Hotel & Location Platform

Advanced Flutter capstone. A Flutter (Web + Android/iOS) client, a TypeScript/Express REST API and a PostgreSQL (Neon) database.

| | |
|---|---|
| Public web demo | https://wayfarer-web-red.vercel.app |
| API base URL | https://wayfarer-api-liart.vercel.app/api |
| API docs (Swagger UI) | https://wayfarer-api-liart.vercel.app/api/docs |
| Health | https://wayfarer-api-liart.vercel.app/api/health |

## What it does
- Destination discovery, hotel search with real date availability and server-side filtering.
- Booking lifecycle with inventory locking, simulated payments (clearly labelled), cancellation, receipts.
- AI trip planner: natural-language request -> day-by-day itinerary built **only from stored records**. Without an LLM key it uses a transparent rules engine and says so.
- Travel knowledge assistant (retrieval over approved guides, with source references).
- Map (OpenStreetMap), wishlist, notifications, admin console and partner portal with server-enforced roles.

## Repository layout
```
backend/   Express + TypeScript API, SQL migrations, idempotent seed, tests (Vitest)
app/       Flutter app (Riverpod, go_router, Dio) - web, Android, iOS
docs/      Documentation package
.github/   CI workflow
```

## Quick start
```bash
# API (uses in-process Postgres when DATABASE_URL is empty)
cd backend && npm ci && npm run dev          # http://localhost:8080/api/health
npm run seed                                  # seeds the configured database (idempotent)
npm test                                      # 39 tests

# Flutter
cd app && flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8080/api
flutter test && flutter build web --release
```
Copy `backend/.env.example` to `backend/.env` and fill values. **Never commit `.env`.**

## Demo accounts
See [docs/USER_MANUAL.md](docs/USER_MANUAL.md). Customer demo accounts share a documented password; admin/staff/partner demo passwords are not in the repo.

## Honest status
See [docs/LIMITATIONS_AND_FUTURE_WORK.md](docs/LIMITATIONS_AND_FUTURE_WORK.md) and [docs/TESTING_REPORT.md](docs/TESTING_REPORT.md).
