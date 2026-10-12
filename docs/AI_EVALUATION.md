# AI evaluation

Automated checks (in `backend/tests/api.test.ts`):
- The scenario prompt "three days in Phnom Penh, two adults, $150, food/culture/photography/relaxed" is parsed to `{destination: phnom-penh, days: 3, adults: 2, budgetUsd: 150}`.
- Every itinerary stop id exists in `attractions`; no duplicates; stops are time-ordered and non-overlapping; totals equal the sum of components.
- Missing essentials produce questions rather than guesses.
- RAG returns the etiquette document for a clothing question, returns policy documents for cancellation questions and declines an off-topic question with `grounded=false`.

Not yet done: human relevance rating, retrieval recall/precision benchmark, LLM-mode evaluation.

Known weaknesses: lexical retrieval misses paraphrases without a synonym entry; the planner has no multi-day transport routing and small pools per destination can repeat categories.
