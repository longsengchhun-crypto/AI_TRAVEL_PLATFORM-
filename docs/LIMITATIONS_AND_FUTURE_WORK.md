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

**Photos**
- 15 listings use a placeholder rather than an unsuitable photo; photo selection is automated plus manual review of titles, not a full visual review of all 307 images.
- Photos are mirrored from Wikimedia Commons under their individual licences; attribution is stored per image (`image_credit`).

**Data caveats**
- Hotels, restaurants, reviews, bookings, payments are fictional. Prices/hours of real landmarks are indicative.
- Exchange rates are fixed sample values.

**Future work**
Rotate secrets and restrict CORS; add pgvector + embeddings; routing provider with traffic; real payment adapter; push notifications; localisation (Khmer); offline caching; CI deployment; Flutter integration tests; richer admin CRUD.
