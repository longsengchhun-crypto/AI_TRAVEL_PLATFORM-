# Requirements specification

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
