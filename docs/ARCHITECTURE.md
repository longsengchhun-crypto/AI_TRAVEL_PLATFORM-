# Architecture

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
