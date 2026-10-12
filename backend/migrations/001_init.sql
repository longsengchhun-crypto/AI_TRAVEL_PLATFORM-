-- WAYFARER initial schema. Money is stored in USD (numeric 12,2); display currency is converted via currencies.
-- Only additive/idempotent statements: safe to run against an empty database. Never DROP here.

CREATE TABLE currencies (
  code        char(3) PRIMARY KEY,
  name        text NOT NULL,
  symbol      text NOT NULL,
  per_usd     numeric(14,4) NOT NULL CHECK (per_usd > 0),   -- units of this currency for 1 USD (documented sample rate)
  rate_source text NOT NULL DEFAULT 'sample',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exchange_rate_snapshots (
  id         bigserial PRIMARY KEY,
  code       char(3) NOT NULL REFERENCES currencies(code),
  per_usd    numeric(14,4) NOT NULL,
  source     text NOT NULL,
  taken_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  password_hash    text NOT NULL,
  name             text NOT NULL,
  phone            text,
  role             text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','partner','staff','admin')),
  preferred_currency char(3) NOT NULL DEFAULT 'USD' REFERENCES currencies(code),
  is_demo          boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE deleted_at IS NULL;

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partners (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE destinations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,
  country          text NOT NULL,
  region           text,
  is_international boolean NOT NULL DEFAULT false,
  short_description text NOT NULL,
  long_description text NOT NULL,
  lat              double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng              double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  cover_image      text,
  image_credit     text,
  daily_budget_usd numeric(10,2) NOT NULL CHECK (daily_budget_usd >= 0),
  currency         char(3) NOT NULL REFERENCES currencies(code),
  best_period      text,
  transport_info   text,
  practical_info   text,
  tags             text[] NOT NULL DEFAULT '{}',
  popularity       int NOT NULL DEFAULT 0,
  is_featured      boolean NOT NULL DEFAULT false,
  is_demo          boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX destinations_country_idx ON destinations (country);

CREATE TABLE destination_images (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  url            text NOT NULL,
  caption        text,
  credit         text,
  position       int NOT NULL DEFAULT 0
);

CREATE TABLE related_destinations (
  destination_id uuid NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  related_id     uuid NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  PRIMARY KEY (destination_id, related_id),
  CHECK (destination_id <> related_id)
);

CREATE TABLE amenities (
  id    serial PRIMARY KEY,
  code  text NOT NULL UNIQUE,
  label text NOT NULL
);

CREATE TABLE accommodations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  destination_id     uuid NOT NULL REFERENCES destinations(id),
  partner_id         uuid REFERENCES partners(id),
  name               text NOT NULL,
  type               text NOT NULL CHECK (type IN ('hotel','guesthouse','resort','hostel','boutique','villa','apartment')),
  stars              int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  description        text NOT NULL,
  address            text NOT NULL,
  lat                double precision NOT NULL,
  lng                double precision NOT NULL,
  cover_image        text,
  image_credit       text,
  check_in_from      text NOT NULL DEFAULT '14:00',
  check_out_until    text NOT NULL DEFAULT '12:00',
  free_cancel_hours  int NOT NULL DEFAULT 48 CHECK (free_cancel_hours >= 0),  -- 0 = non-refundable
  cancellation_policy text NOT NULL,
  breakfast_included boolean NOT NULL DEFAULT false,
  family_friendly    boolean NOT NULL DEFAULT false,
  tax_rate           numeric(5,4) NOT NULL DEFAULT 0.10,
  service_fee_rate   numeric(5,4) NOT NULL DEFAULT 0.02,
  rating_avg         numeric(3,2) NOT NULL DEFAULT 0,
  review_count       int NOT NULL DEFAULT 0,
  from_price_usd     numeric(10,2) NOT NULL DEFAULT 0,
  is_demo            boolean NOT NULL DEFAULT true,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accommodations_dest_idx ON accommodations (destination_id) WHERE deleted_at IS NULL;
CREATE INDEX accommodations_price_idx ON accommodations (from_price_usd);

CREATE TABLE accommodation_images (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_id uuid NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE,
  url              text NOT NULL,
  caption          text,
  position         int NOT NULL DEFAULT 0
);

CREATE TABLE accommodation_amenities (
  accommodation_id uuid NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE,
  amenity_id       int NOT NULL REFERENCES amenities(id),
  PRIMARY KEY (accommodation_id, amenity_id)
);

CREATE TABLE room_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_id uuid NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description      text NOT NULL,
  bed_type         text NOT NULL,
  max_adults       int NOT NULL CHECK (max_adults > 0),
  max_children     int NOT NULL DEFAULT 0 CHECK (max_children >= 0),
  size_sqm         int,
  base_price_usd   numeric(10,2) NOT NULL CHECK (base_price_usd > 0),
  total_units      int NOT NULL CHECK (total_units > 0),
  breakfast_included boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX room_types_acc_idx ON room_types (accommodation_id);

-- One row per room type per night. A missing row means "not sellable" for that date.
CREATE TABLE room_inventory (
  room_type_id    uuid NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  night           date NOT NULL,
  units_available int NOT NULL CHECK (units_available >= 0),
  price_usd       numeric(10,2) NOT NULL CHECK (price_usd > 0),
  PRIMARY KEY (room_type_id, night)
);
CREATE INDEX room_inventory_night_idx ON room_inventory (night);

CREATE TABLE attractions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  destination_id uuid NOT NULL REFERENCES destinations(id),
  kind           text NOT NULL CHECK (kind IN ('attraction','restaurant','activity')),
  category       text NOT NULL,   -- temple, museum, nature, beach, cafe, food, culture, tour, family, outdoor, market, landmark
  name           text NOT NULL,
  description    text NOT NULL,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  image          text,
  image_credit   text,
  price_usd      numeric(10,2),
  duration_min   int NOT NULL DEFAULT 90 CHECK (duration_min > 0),
  opens_min      int CHECK (opens_min BETWEEN 0 AND 1440),   -- minutes after midnight, null = unknown
  closes_min     int CHECK (closes_min BETWEEN 0 AND 1440),
  hours_verified boolean NOT NULL DEFAULT false,
  tips           text,
  tags           text[] NOT NULL DEFAULT '{}',
  family_friendly boolean NOT NULL DEFAULT false,
  is_demo        boolean NOT NULL DEFAULT false,   -- true = educational sample listing, details not verified
  deleted_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attractions_dest_idx ON attractions (destination_id, kind) WHERE deleted_at IS NULL;

CREATE TABLE itineraries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,  -- null for curated templates
  destination_id uuid NOT NULL REFERENCES destinations(id),
  title          text NOT NULL,
  summary        text,
  start_date     date,
  num_days       int NOT NULL CHECK (num_days BETWEEN 1 AND 14),
  adults         int NOT NULL DEFAULT 1 CHECK (adults > 0),
  children       int NOT NULL DEFAULT 0 CHECK (children >= 0),
  budget_usd     numeric(10,2),
  interests      text[] NOT NULL DEFAULT '{}',
  pace           text NOT NULL DEFAULT 'balanced' CHECK (pace IN ('relaxed','balanced','packed')),
  generated_by   text NOT NULL DEFAULT 'manual' CHECK (generated_by IN ('manual','rules','llm','curated')),
  accommodation_id uuid REFERENCES accommodations(id),
  est_total_usd  numeric(10,2) NOT NULL DEFAULT 0,
  assumptions    jsonb NOT NULL DEFAULT '[]',
  is_template    boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX itineraries_user_idx ON itineraries (user_id);

CREATE TABLE itinerary_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id  uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  day_index     int NOT NULL CHECK (day_index >= 1),
  position      int NOT NULL CHECK (position >= 0),
  attraction_id uuid NOT NULL REFERENCES attractions(id),
  start_min     int NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  duration_min  int NOT NULL CHECK (duration_min > 0),
  travel_min_from_prev int NOT NULL DEFAULT 0,
  est_cost_usd  numeric(10,2) NOT NULL DEFAULT 0,
  reason        text,
  UNIQUE (itinerary_id, day_index, position)
);

CREATE TABLE wishlist_items (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('destination','accommodation','attraction')),
  ref_id     uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref_id)
);

CREATE TABLE bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users(id),
  accommodation_id uuid NOT NULL REFERENCES accommodations(id),
  room_type_id     uuid NOT NULL REFERENCES room_types(id),
  check_in         date NOT NULL,
  check_out        date NOT NULL,
  nights           int NOT NULL CHECK (nights > 0),
  rooms            int NOT NULL DEFAULT 1 CHECK (rooms > 0),
  adults           int NOT NULL CHECK (adults > 0),
  children         int NOT NULL DEFAULT 0 CHECK (children >= 0),
  guest_name       text NOT NULL,
  guest_email      text NOT NULL,
  guest_phone      text,
  special_requests text,
  status           text NOT NULL CHECK (status IN ('DRAFT','PENDING_CONFIRMATION','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','EXPIRED','REFUND_PENDING','REFUNDED')),
  subtotal_usd     numeric(12,2) NOT NULL,
  taxes_usd        numeric(12,2) NOT NULL,
  fees_usd         numeric(12,2) NOT NULL,
  total_usd        numeric(12,2) NOT NULL,
  cancellation_policy text NOT NULL,
  free_cancel_until timestamptz,
  hold_expires_at  timestamptz,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_acc_idx ON bookings (accommodation_id);
CREATE INDEX bookings_status_idx ON bookings (status);

-- Nightly rate snapshot, one row per night held. Used to restore inventory on cancel/expiry.
CREATE TABLE booking_items (
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  night      date NOT NULL,
  rate_usd   numeric(10,2) NOT NULL,
  rooms      int NOT NULL,
  released   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (booking_id, night)
);

CREATE TABLE booking_status_events (
  id         bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  from_status text,
  to_status  text NOT NULL,
  actor_id   uuid REFERENCES users(id),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_idx ON booking_status_events (booking_id, created_at);

CREATE TABLE reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_id uuid NOT NULL REFERENCES accommodations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id),
  booking_id       uuid REFERENCES bookings(id),
  rating           int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title            text NOT NULL,
  body             text NOT NULL,
  status           text NOT NULL DEFAULT 'published' CHECK (status IN ('published','hidden')),
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (accommodation_id, user_id)
);

CREATE TABLE payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  amount_usd       numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  refunded_usd     numeric(12,2) NOT NULL DEFAULT 0,
  status           text NOT NULL CHECK (status IN ('PENDING','SUCCESS','FAILED','CANCELLED','REFUNDED')),
  provider         text NOT NULL,
  provider_ref     text NOT NULL UNIQUE,
  idempotency_key  text NOT NULL UNIQUE,
  simulated        boolean NOT NULL DEFAULT true,
  failure_reason   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_idx ON payments (booking_id);

CREATE TABLE payment_events (
  id                bigserial PRIMARY KEY,
  payment_id        uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL UNIQUE,   -- dedupes repeated webhook deliveries
  type              text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE travel_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE,
  title          text NOT NULL,
  destination_id uuid REFERENCES destinations(id),
  category       text NOT NULL,   -- guide, faq, policy, transport, etiquette, safety
  source_label   text NOT NULL,
  content        text NOT NULL,
  is_demo        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES travel_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  content     text NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX document_chunks_tsv_idx ON document_chunks USING gin (tsv);

CREATE TABLE ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_messages (
  id              bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant')),
  content         text NOT NULL,
  sources         jsonb NOT NULL DEFAULT '[]',
  mode            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_usage_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  kind       text NOT NULL,
  mode       text NOT NULL,     -- 'rules' | 'retrieval' | 'llm'
  provider   text,
  latency_ms int,
  ok         boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_idx ON audit_logs (created_at DESC);

CREATE TABLE search_history (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user_idx ON search_history (user_id, created_at DESC);
