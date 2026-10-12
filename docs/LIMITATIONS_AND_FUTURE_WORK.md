# Limitations and future work

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
