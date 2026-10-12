# Testing report

## Backend (Vitest, in-process PostgreSQL via PGlite)
`cd backend && npm test` -> **39 tests, 3 files, all passing** at time of writing.

Coverage highlights: register/login/refresh rotation + reuse detection, password reset, role enforcement (incl. immediate DB role changes), partner isolation, search filters/sorting/pagination/validation, booking happy path, payment failure, duplicate webhook, bad signature, amount mismatch, idempotent intents, non-refundable cancellation, blocked inventory, hold expiry, illegal transitions, **6 concurrent bookings for the last room (exactly one succeeds)**, planner scenarios, RAG, admin operations, seed idempotency and volumes.

Limitation: PGlite serialises queries on one connection, so the concurrency test proves the transactional/locking logic and constraint safety, not Neon connection-pool contention.

## Flutter
`cd app && flutter test` -> **13 tests passing** (query model, formatting, state widgets, empty bookings view). `flutter analyze` -> no errors/warnings (3 info-level lints). `flutter build web --release` succeeds.

## Deployed smoke tests
Health, destinations and accommodation search were exercised against the live API; home, stay results and stay detail were rendered in headless Edge against the live site.

## Not tested
Android/iOS builds, screen-reader behaviour, LLM mode, real payment provider, load testing, cross-browser matrix, full E2E automation (Flutter integration tests are not written; the API-level E2E flow is covered by the backend suite).
