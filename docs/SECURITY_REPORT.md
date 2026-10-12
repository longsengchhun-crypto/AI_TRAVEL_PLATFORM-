# Security report

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
