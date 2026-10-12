# Database schema

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
