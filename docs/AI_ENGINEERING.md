# AI engineering

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
