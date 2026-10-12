"""Writes the documentation set. Run: python docs/_gen_docs.py (kept in repo so docs can be regenerated/edited as plain Markdown)."""
import pathlib

D = pathlib.Path(__file__).parent
ROOT = D.parent

docs = {}

docs["../README.md"] = """# WAYFARER: AI Travel, Hotel & Location Platform

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
"""

docs["PROJECT_PROPOSAL.md"] = """# Project proposal

**Product:** WAYFARER, an AI travel, hotel and location platform for Cambodia and Southeast Asia.

**Problem.** Travellers juggle separate tools for destination research, hotel search, itinerary planning and bookings; generic AI planners invent places and prices. WAYFARER keeps these in one product and grounds every suggestion in stored, inspectable records.

**Differentiators**
1. Honest AI: the planner and assistant only return stored records/documents and disclose whether a language model or the rules engine produced the result.
2. Transparent pricing: nightly rates, taxes, fees and cancellation policy are shown before booking and snapshotted onto the booking.
3. Cambodia-first dataset with real landmarks and educational demo hotels clearly labelled.

**Scope.** Flutter client (web + mobile), REST API, PostgreSQL, admin/partner tooling, CI and cloud deployment.

**Out of scope for the capstone:** real payment processing, live routing/traffic, real hotel inventory feeds, push delivery.
"""

docs["REQUIREMENTS_SPECIFICATION.md"] = """# Requirements specification

## Functional requirements (implemented unless marked)
| ID | Requirement | Status |
|---|---|---|
| FR-1 | Browse/search destinations with filters, sort, pagination | Implemented |
| FR-2 | Search accommodation by destination/text, dates, guests, rooms, price, stars, rating, amenities, type, free cancellation, breakfast, family, distance; sort; paginate (server-side) | Implemented |
| FR-3 | Property detail: gallery, rooms, per-date quotes, policies, map, reviews | Implemented |
| FR-4 | Booking with transactional inventory reservation and hold expiry | Implemented |
| FR-5 | Booking state machine enforced server-side | Implemented |
| FR-6 | Payment abstraction with idempotency, signed webhooks, simulated provider | Implemented (simulation only) |
| FR-7 | Cancellation per policy snapshot, inventory release, simulated refund | Implemented |
| FR-8 | Itinerary generation from stored records, edit/reorder/remove, regenerate a day, recalculate costs | Implemented (rules engine; LLM path implemented but unverified) |
| FR-9 | Knowledge assistant with sources | Implemented (lexical retrieval; no embeddings) |
| FR-10 | Accounts: register/login/refresh rotation/logout/reset/profile/delete | Implemented (no email delivery) |
| FR-11 | Wishlist, search history, recently viewed | Implemented |
| FR-12 | In-app notifications | Implemented; push not configured |
| FR-13 | Admin console, partner portal, audit log | Implemented |
| FR-14 | Map with markers, location permission handling, route estimate | Implemented (OSM, straight-line estimates) |
| FR-15 | Currency display with documented sample rates | Implemented |

## Non-functional
Security (hashing, JWT, rate limits, validation, RBAC), responsive layouts (mobile < 840 px bottom nav, desktop top nav), accessibility labels/tooltips/contrast, graceful loading/empty/error states, idempotent seed, CI.
"""

docs["USE_CASES.md"] = """# Use cases

| UC | Actor | Flow summary |
|---|---|---|
| UC-1 Find a stay | Guest | Choose destination/dates/guests -> filter -> open property -> see per-room total |
| UC-2 Book and pay | Customer | Reserve room -> enter guest details -> room held -> simulated payment -> server verifies -> CONFIRMED -> receipt |
| UC-3 Cancel | Customer | Open booking -> cancel -> policy applied -> inventory released -> (refund simulated if within free window) |
| UC-4 Plan a trip | Guest/Customer | Describe trip -> system asks for missing info or returns itinerary -> save, edit, regenerate day |
| UC-5 Ask the guide | Guest | Ask question -> top passages retrieved -> answer with sources, or "not in approved guides" |
| UC-6 Manage content | Staff/Admin | Create destination, adjust inventory, moderate reviews, inspect audit log |
| UC-7 Manage property | Partner | View own properties/bookings, update availability, check-in/complete |
"""

docs["USER_FLOWS.md"] = """# User flows

```mermaid
flowchart LR
  A[Home search] --> B[Stay results + filters]
  B --> C[Property detail]
  C -->|choose room + dates| D[Checkout: guest details]
  D -->|POST /bookings| E[Room held, countdown]
  E -->|simulate payment| F{Server verifies event}
  F -->|success| G[CONFIRMED + receipt]
  F -->|failed| E
  E -->|hold expires| H[EXPIRED, room released]
  G --> I[Cancel within policy -> REFUNDED]
```

```mermaid
flowchart TD
  P[Prompt] --> U[Understand: dest, days, party, budget, interests]
  U -->|missing| Q[Ask clarifying question]
  U --> R[Retrieve places/hotels from DB]
  R --> S[Score, cluster by distance, fit opening hours]
  S --> T[Price with explicit assumptions]
  T --> V[Plan + budget + warnings]
  V --> W[Save / edit / regenerate a day]
```
"""

docs["DESIGN_SYSTEM.md"] = """# Design system

**Direction:** editorial travel magazine meets calm hospitality booking.

| Token | Value |
|---|---|
| Background (ivory) | `#FAF7F0`; surface `#FFFFFF`; sand `#F1ECE0` |
| Ink | `#1E2421`; muted `#5E645E`; border `#E2DCCD` |
| Primary forest | `#2F5D50`; deep `#1F4036` |
| Accent terracotta | `#B65F37`; amber `#C9923A` |
| Type | Fraunces (headlines), Inter (UI) via google_fonts |
| Radius / spacing | 10 px; 4-8-12-16-24-32-48 scale |

Components: search panel, destination/stay/place cards, price breakdown rows, status pills, demo badges, skeleton/empty/error states, itinerary timeline, map with attribution.

Principles: functionality above the fold, no decorative gradients, imagery with fallbacks, `Tooltip`/`Semantics` on icon buttons, 48 px touch targets, reduced-motion respected by image fade.
"""

docs["ARCHITECTURE.md"] = """# Architecture

```mermaid
flowchart LR
  subgraph Client
    W[Flutter Web - Vercel static]
    M[Flutter Android/iOS]
  end
  subgraph Cloud
    API[Express API - Vercel serverless]
    DB[(Neon PostgreSQL)]
  end
  W -->|HTTPS JSON| API
  M -->|HTTPS JSON| API
  API -->|pg pool| DB
  API -.optional.-> LLM[LLM provider]
  W -->|tiles| OSM[(OpenStreetMap)]
```

- **Client:** Flutter, Riverpod providers (cached async data keyed by query objects), go_router with auth redirects, Dio client with single-flight refresh on 401, tokens in secure storage.
- **API:** Express 5, zod validation, JWT (15 min) + rotating refresh tokens, Helmet, CORS, rate limits, uniform error envelope.
- **DB access:** `Db` adapter over `pg` (Neon) or in-process PGlite for dev/tests, with identical SQL.
- **Serverless note:** no background workers; booking holds are expired lazily on access.
- **AI:** `services/llm.ts` provider abstraction; `planner.ts` always retrieves from DB and validates LLM output with zod; fallback is deterministic.

## Booking state machine
```mermaid
stateDiagram-v2
  [*] --> PENDING_CONFIRMATION
  PENDING_CONFIRMATION --> CONFIRMED: payment verified
  PENDING_CONFIRMATION --> CANCELLED
  PENDING_CONFIRMATION --> EXPIRED: hold elapsed
  CONFIRMED --> CHECKED_IN
  CONFIRMED --> CANCELLED
  CHECKED_IN --> COMPLETED
  CANCELLED --> REFUND_PENDING: paid + free window
  REFUND_PENDING --> REFUNDED
```
`DRAFT` exists in the enum/transition table but the API creates bookings directly in `PENDING_CONFIRMATION`.

## Payment state machine
`PENDING -> SUCCESS | FAILED | CANCELLED`, `SUCCESS -> REFUNDED`.
"""

docs["DATABASE_ERD.md"] = """# Database ERD

```mermaid
erDiagram
  users ||--o{ bookings : places
  users ||--o{ reviews : writes
  users ||--o{ itineraries : owns
  users ||--o{ notifications : receives
  users ||--o| partners : is
  partners ||--o{ accommodations : owns
  destinations ||--o{ accommodations : contains
  destinations ||--o{ attractions : contains
  destinations ||--o{ itineraries : targets
  accommodations ||--o{ room_types : has
  room_types ||--o{ room_inventory : "per night"
  accommodations ||--o{ bookings : receives
  room_types ||--o{ bookings : reserved
  bookings ||--o{ booking_items : "night snapshot"
  bookings ||--o{ booking_status_events : history
  bookings ||--o{ payments : paid_by
  payments ||--o{ payment_events : events
  itineraries ||--o{ itinerary_items : stops
  attractions ||--o{ itinerary_items : used_in
  travel_documents ||--o{ document_chunks : split
  accommodations }o--o{ amenities : offers
```
"""

docs["DATABASE_SCHEMA.md"] = """# Database schema

Source of truth: [`backend/migrations/001_init.sql`](../backend/migrations/001_init.sql). Migrations are applied by `npm run migrate` and recorded in `schema_migrations`.

Key decisions
- **Money** is `numeric(12,2)` in USD. Display currency uses `currencies.per_usd` (documented sample rates, `exchange_rate_snapshots` keeps history).
- **Inventory**: `room_inventory(room_type_id, night)` with `units_available >= 0` CHECK. Booking locks the affected rows (`SELECT ... FOR UPDATE`) and decrements them in the same transaction; a missing row means "not sellable".
- **Snapshots**: `booking_items` stores nightly rates; `bookings` stores policy text, taxes and fees at booking time.
- **Idempotency**: `payments.idempotency_key` and `payment_events.provider_event_id` are UNIQUE.
- **Integrity**: foreign keys, CHECK constraints on enums/ranges, partial unique index on active user emails, soft delete (`deleted_at`) on users/destinations/accommodations/attractions.
- **Search**: indexes on destination, price, night; `document_chunks.tsv` GIN index for retrieval.
- Tables not created on purpose: separate wishlist/saved-destination tables (one `wishlist_items`), `itinerary_days` (day index on items), `payment_refunds` (refund fields on `payments` + events), `user_roles`/`roles` (single role column).

Backup/recovery: Neon provides point-in-time restore; for local, `pg_dump`. Migrations never DROP.
"""

docs["SEED_DATA.md"] = """# Seed data

`npm run seed` is idempotent (`ON CONFLICT DO NOTHING` / existence checks) and deterministic (seeded PRNG).

| Entity | Count |
|---|---|
| Destinations | 20 (10 Cambodia, 10 international) |
| Accommodations / room types | 30 / 60 |
| Inventory rows | 7,200 (120 nights x 60 rooms) |
| Attractions + activities | 102 |
| Restaurants | 42 |
| Curated itineraries | 30 (generated by the real planner) |
| Reviews | 100 (flagged demo, never "verified stays") |
| Travel documents | 20 |
| Users | 20 (1 admin, 2 staff, 3 partner, 14 customer) |
| Bookings / payments / payment events | 50 / 50 / 100 |
| Notifications | 120 |

**Provenance.** Landmarks are real places with approximate coordinates; prices/hours are indicative (`hours_verified=false`). Hotels, restaurants, reviews, bookings and payments are fictional educational data (`is_demo=true`). Photos come from Wikipedia/Wikimedia Commons lead images with the source page recorded (licence per file page); property photos are illustrative destination photos and say so.

**Scenario hooks.** Riverside Heritage Hotel is blacked out on days +30..+34 from the seed date (no-availability scenario). The Backpackers' Lounge Hostel is non-refundable.

**Dates.** Inventory covers 120 nights from the day the seed runs; re-run the seed to extend.
"""

docs["API_DOCUMENTATION.md"] = """# API documentation

Interactive docs: `/api/docs` (Swagger UI), machine-readable: `/api/openapi.json` (generated from [`backend/src/openapi.ts`](../backend/src/openapi.ts)).

**Conventions:** JSON; `Authorization: Bearer <access token>`; errors are `{ "error": { "code", "message", "details?" } }` with 400/401/403/404/409/422/429/500.

| Area | Endpoints |
|---|---|
| Auth | POST `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password`; GET/PATCH `/users/me`; POST `/users/me/delete` |
| Discovery | GET `/home`, `/meta`, `/destinations`, `/destinations/:id`, `/destinations/:id/attractions`, `/destinations/:id/accommodations`, `/attractions`, `/attractions/:id` |
| Stays | GET `/accommodations`, `/accommodations/:id`, `/accommodations/:id/availability`, `/room-types/:id`, `/accommodations/:id/reviews`; POST reviews |
| Bookings | POST `/bookings/quote`, `/bookings`; GET `/bookings`, `/bookings/:id`, `/bookings/:id/receipt`; POST `/bookings/:id/cancel` |
| Payments | POST `/payments/intent`, `/payments/:id/simulate` (demo), `/payments/webhook` (HMAC); GET `/payments/:id` |
| AI | POST `/ai/travel-plan`, `/ai/assistant`, `/ai/recommendations`; GET `/ai/sources`, `/ai/status` |
| Itineraries | CRUD `/itineraries`; POST `/:id/generate`, `/:id/recalculate`, `/:id/copy` |
| Maps | GET `/locations/search`; POST `/routes/estimate` |
| Account | `/wishlist`, `/search-history`, `/notifications` |
| Admin (staff/admin) | `/admin/overview|users|bookings|payments|audit-logs|reviews|ai-usage`, destinations, accommodations, room inventory |
| Partner | `/partner/accommodations|bookings|analytics`, inventory |

## Example: search
`GET /api/accommodations?destination=phnom-penh&checkIn=2026-11-01&checkOut=2026-11-04&adults=2&maxPrice=60&sort=price_asc`
```json
{ "items": [{ "slug": "tonle-garden-guesthouse", "price_from": 22, "total_for_stay_usd": 66, "free_cancel_hours": 24 }],
  "page": 1, "pageSize": 12, "total": 3, "totalPages": 1, "nights": 3 }
```

## Example: booking error
`409 { "error": { "code": "NO_AVAILABILITY", "message": "Not enough rooms left on 2026-11-30. Try different dates or fewer rooms." } }`

## Webhook
`POST /api/payments/webhook` with header `X-Wayfarer-Signature: hex(HMAC_SHA256(PAYMENT_WEBHOOK_SECRET, rawBody))` and body `{ id, type, payment_ref, amount_usd }`. Duplicate `id`s are acknowledged with `duplicate: true` and ignored.
"""

docs["AI_ENGINEERING.md"] = """# AI engineering

## Planner (`backend/src/services/planner.ts`)
1. **Understand**: LLM extraction when configured (validated with zod, destination must be a known slug); otherwise a rules parser (days, party, budget, per-day vs total, interest keywords, pace).
2. **Ask**: missing destination/duration returns `status: needs_more_info` with questions.
3. **Retrieve**: all candidates come from `attractions`/`accommodations` rows.
4. **Plan**: score by interests/family fit, cluster by distance, respect opening hours (when known), no duplicates, breakfast/lunch/dinner slots by pace.
5. **Price**: entry fees x party (children 50%), meals (60%), transport allowance, lodging with tax/fees; all assumptions are returned and displayed.
6. **Disclose**: `mode: rules|llm` and `modeNote` say who produced the output. A rules plan is never labelled as AI.

Travel-time estimates are straight-line x1.35 at 22 km/h, not routed or traffic-aware.

## Assistant / RAG (`services/rag.ts`)
documents -> sentence chunking (~480 chars, title prepended) -> `document_chunks` with generated `tsvector` -> OR-query with explicit synonym expansion -> `ts_rank` top 4 -> (LLM answer constrained to context with citations | extractive answer quoting passages) -> sources + disclaimer. No hit means an explicit "not in approved guides" response.

**Not implemented:** embeddings/pgvector (Neon supports it; needs an embedding provider key), conversation memory beyond logging.

## LLM provider
Anthropic Messages API via fetch with timeouts; model from `AI_MODEL` (default `claude-sonnet-5-5`). **This path has not been exercised in this project (no key was available);** its failures fall back silently to rules.

## Safeguards
Rate limit 20 req/min/IP in production, usage events in `ai_usage_events` (admin-visible), schema validation on all model output, model never writes structured plan data (only summary text).
"""

docs["AI_EVALUATION.md"] = """# AI evaluation

Automated checks (in `backend/tests/api.test.ts`):
- The scenario prompt "three days in Phnom Penh, two adults, $150, food/culture/photography/relaxed" is parsed to `{destination: phnom-penh, days: 3, adults: 2, budgetUsd: 150}`.
- Every itinerary stop id exists in `attractions`; no duplicates; stops are time-ordered and non-overlapping; totals equal the sum of components.
- Missing essentials produce questions rather than guesses.
- RAG returns the etiquette document for a clothing question, returns policy documents for cancellation questions and declines an off-topic question with `grounded=false`.

Not yet done: human relevance rating, retrieval recall/precision benchmark, LLM-mode evaluation.

Known weaknesses: lexical retrieval misses paraphrases without a synonym entry; the planner has no multi-day transport routing and small pools per destination can repeat categories.
"""

docs["MAPS_AND_LOCATION.md"] = """# Maps and location

- **Provider:** OpenStreetMap tiles through `flutter_map`; no API key. A permanent label reads "OpenStreetMap - no live traffic" and attribution is shown. This is a real tile provider, not a mock. Google Maps (`MAPS_API_KEY`) is **not** integrated.
- **Markers:** destinations, stays, places, restaurants, user position; tapping shows a detail card with an external directions link.
- **Itinerary route:** dashed polyline between ordered stops (straight lines, labelled as such).
- **Location:** Geolocator with explicit handling for services disabled, denied, denied-forever and timeouts; nearby stays use a server haversine query.
- **Estimates:** `POST /routes/estimate` returns great-circle x1.35 and 22 km/h, `liveTraffic:false`, plus external navigation links. Tile usage must respect the OSM tile policy; use a commercial tile provider for production traffic.
- **Search:** `/locations/search` queries WAYFARER's own gazetteer (not a global geocoder).
"""

docs["PAYMENT_ARCHITECTURE.md"] = """# Payment architecture

```mermaid
sequenceDiagram
  participant App as Flutter
  participant API
  participant P as Provider (mock)
  App->>API: POST /bookings (room held)
  App->>API: POST /payments/intent {idempotencyKey}
  API-->>App: payment PENDING (simulated)
  App->>API: POST /payments/:id/simulate {outcome}
  API->>P: (mock) build signed event
  API->>API: applyWebhookEvent (dedupe, verify amount, transition booking)
  API-->>App: payment SUCCESS, booking CONFIRMED
```
- The client never sends "paid". Only a verified event changes payment/booking state.
- Real provider integration: implement `createCharge`/webhook verification in `services/payment.ts` and set `PAYMENT_PROVIDER_MODE`; the `/payments/webhook` route already verifies an HMAC over the raw body.
- Idempotency: unique `idempotency_key`; duplicate provider events ignored; amount mismatch fails the payment; payments for non-payable bookings fail.
- Everything is flagged `simulated` and receipts print "SIMULATED PAYMENT - no real money was transferred".
"""

docs["SECURITY_REPORT.md"] = """# Security report

| Control | Implementation |
|---|---|
| Passwords | bcrypt (cost 10), min 10 chars with letters + digit |
| Sessions | 15 min JWT, refresh tokens hashed (SHA-256) and rotated; reuse revokes the family; password reset revokes all |
| AuthZ | role re-read from DB per privileged request; ownership checks return 404 for foreign resources; partner scoped by `partners.user_id` |
| Input | zod validation everywhere; parameterised SQL; LIKE wildcards escaped |
| Abuse | global + auth + AI rate limits (production), body limit 100 kB |
| Transport/headers | HTTPS (Vercel), Helmet, CORS allow-list via `CORS_ORIGINS` |
| Payments | HMAC verified raw-body webhook, idempotency, amount check, no client-supplied status |
| Errors | no stack traces/internals in responses |
| Secrets | `.env` git-ignored; Vercel encrypted env vars; `.env.example` has names only |
| Audit | `audit_logs` for bookings, payments, admin and inventory changes |

## Open items
- **A Neon connection string was pasted into a chat and must be treated as compromised.** Rotate it in the Neon console, then update `DATABASE_URL` in Vercel (`vercel env`) and local `.env`.
- `CORS_ORIGINS` is `*` in the demo deployment; restrict to the web origin for production.
- No email delivery, so password reset returns a demo token only outside production (disabled in production).
- Access tokens are bearer tokens in storage; web uses secure-storage's web fallback (browser storage), which is weaker than mobile keystores.
- No dependency scanning or pen-test has been run.
"""

docs["TESTING_REPORT.md"] = """# Testing report

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
"""

docs["DEPLOYMENT.md"] = """# Deployment

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
"""

docs["USER_MANUAL.md"] = """# User manual and demo guide

Open https://wayfarer-web-red.vercel.app

## Demo accounts
| Role | Email | Password |
|---|---|---|
| Customer | `maya@demo.wayfarer.test`, `liam@demo.wayfarer.test`, `sophea@demo.wayfarer.test` (and 11 more) | `Wayfarer#Demo2026` |
| Staff / partner / admin | `staff1@`, `partner.pp@`, `admin@demo.wayfarer.test` | issued separately by the project owner |

## 10-minute walkthrough
1. **Search:** Home -> destination "Phnom Penh", pick dates 3 weeks out -> Search stays. Apply filters (price, free cancellation, pool).
2. **Open** a property; compare room totals (taxes and fees itemised).
3. **Book:** sign in as Maya -> Reserve -> guest details -> "Pay now (simulate success)". Booking becomes *Confirmed*; open the receipt (marked simulated).
4. **Failure case:** book another room and choose "Simulate a declined card"; the booking stays *Awaiting payment*.
5. **Cancel:** My bookings -> open -> Cancel; see refund status and restored availability.
6. **Planner:** Trips -> enter the Phnom Penh $150 example -> review budget and assumptions -> Save -> reorder/remove stops -> regenerate a day.
7. **Guide:** ask "What should I wear at temples?" and inspect the sources.
8. **Admin:** sign in with an admin/staff account -> Account -> Administration.

Blocked-dates demo: Riverside Heritage Hotel has no rooms from day +30 to +34.
"""

docs["TEAM_WORKFLOW.md"] = """# Team workflow

## Roles (5-7 students)
1. Flutter UI/UX and design system (`app/lib/core/theme`, `core/widgets`)
2. Flutter features and navigation (`app/lib/features/*`, `app/lib/app/router.dart`)
3. Backend and auth (`backend/src/routes`, `auth.ts`)
4. Database, migrations, OpenAPI (`backend/migrations`, `openapi.ts`)
5. AI and RAG (`services/planner.ts`, `rag.ts`, `llm.ts`)
6. Maps, booking and payments (`maps`, `services/booking.ts`, `payment.ts`)
7. QA, DevOps, docs (`tests`, `.github`, `docs`)

## Git
`main` (deployable) <- `develop` <- `feature/<area>-<topic>`. Pull requests need CI green and one review. No force-push to shared branches.

## Setup checklist
Node 22, Flutter stable, Vercel CLI (optional). Copy `backend/.env.example`. Never share secrets in chat; use the Vercel dashboard or a password manager.

## Demo checklist
See docs/USER_MANUAL.md walkthrough.
"""

docs["LIMITATIONS_AND_FUTURE_WORK.md"] = """# Limitations and future work

**Not verified / not done**
- Android and iOS builds have not been run (web build only).
- LLM-assisted planning/assistant paths are implemented but untested without an API key.
- No embedding/pgvector retrieval; no human evaluation of answer quality.
- No real payment provider, Firebase push, email delivery or Google Maps integration.
- Flutter integration (end-to-end UI) tests are not written; E2E is API-level only.
- Admin UI does not expose hotel/room editing forms (available via API and partner inventory dialog).
- Accessibility has had no screen-reader audit.
- Web search field may show a destination slug on deep links until the destination list loads.

**Data caveats**
- Hotels, restaurants, reviews, bookings, payments are fictional. Prices/hours of real landmarks are indicative.
- Exchange rates are fixed sample values.

**Future work**
Rotate secrets and restrict CORS; add pgvector + embeddings; routing provider with traffic; real payment adapter; push notifications; localisation (Khmer); offline caching; CI deployment; Flutter integration tests; richer admin CRUD.
"""

for name, content in docs.items():
    p = (D / name).resolve()
    p.write_text(content.strip() + "\n", encoding="utf-8")
print(f"wrote {len(docs)} files")
