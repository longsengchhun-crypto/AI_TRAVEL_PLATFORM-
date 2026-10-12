# Team workflow

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
