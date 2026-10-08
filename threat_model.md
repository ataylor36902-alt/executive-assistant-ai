# Threat Model

## Project Overview

ClassScribe turns college lectures into searchable transcripts, structured notes, key points, and collaborative course memory. It is a pnpm monorepo (Node.js 24, TypeScript 5.9). The production backend is an Express 5 API server (`artifacts/api-server`) backed by PostgreSQL + Drizzle ORM, with a React web app (`artifacts/classscribe`) and an Expo mobile app (`artifacts/classscribe-mobile`). It is deployed publicly on Replit autoscale (`https://class-scribe.replit.app`). AI features call Anthropic; payments use Stripe and RevenueCat.

## Assets

- **Private student libraries** — lectures, transcripts, notes, study guides, grades, profile info. Keyed by a high-entropy sync code. Compromise exposes a student's entire academic record.
- **Sync codes (`u_...`) and class invite/group codes (`g_...`)** — bearer capabilities. The sync code grants full control of a library; the group code grants access to a class's shared posts/lectures/notebook.
- **EDU client credentials** — license number + client PIN granting school-scoped EDU access.
- **Billing/entitlement state** — Stripe/RevenueCat plan, credits balance. Compromise yields free paid features/credits.
- **Application secrets** — `DATABASE_URL`, `SESSION_SECRET` (encrypts library-link mappings), Anthropic/Stripe/RevenueCat keys, Clerk keys.
- **PII of minors** — age band drives sharing restrictions; mishandling has privacy/compliance impact.

## Trust Boundaries

- **Browser/mobile to API** — all client requests are untrusted. Two auth models coexist:
  - **Legacy sync-code model (primary):** `/api/db/*`, `/api/support`, billing, privacy, profile-photo, materials-extract routes authenticate ONLY via the `X-CS-User` header (sync code). Mounted at `/api` BEFORE the Clerk gate (`app.ts:80`). Authorization is entirely path-derived in `lib/classscribe-legacy-access.ts`.
  - **Clerk-backed model (retained):** routes in `routes/index.ts` (`classscribe.ts`, `classscribe-edu*.ts`, notes, study-plans, study-guides, grades) sit behind a global Clerk `getAuth().userId` 401 gate.
- **Public routes (no auth gate):** `privacy.ts`, `classscribe-edu-inquiries.ts`, `revenuecat-webhook.ts`, `stripe/webhook`. These must self-enforce authorization/signature verification.
- **API to Postgres** — single JSONB document table (`classscribeLegacyDocumentsTable`) for legacy data; authorization is path-string derived, so path validation IS the access control.
- **API to external services** — Anthropic (AI), Stripe/RevenueCat (billing). Webhooks must be signature/secret verified.
- **Public/minor sharing boundary** — age band (`13-17`) restricts public/group sharing of content and names.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts` (mount order is security-critical), `routes/classscribe-legacy.ts` (largest surface, bearer-based).
- **Core authz primitive:** `lib/classscribe-legacy-access.ts` `resolveAndAuthorizePath()` / `validPath()` — path-depth and regex here gate cross-library access.
- **Highest-risk areas:** legacy `/db/*` handler (classscribe-legacy.ts ~485-795), `/db/rotate` (takeover), billing/credits (`lib/classscribe-billing.ts`, `lib/classscribe-credits.ts`), privacy deletion/export (`routes/privacy.ts`, public), uploads (`classscribe-profile-photo.ts`, `classscribe-materials-extract.ts`, `lib/objectStorage.ts`).
- **Public surfaces (self-guard):** `privacy.ts`, `revenuecat-webhook.ts`, `app.ts` stripe webhook, `classscribe-edu-inquiries.ts`.
- **Dev-only / usually ignore unless proven reachable:** `artifacts/mockup-sandbox` (Canvas design), `artifacts/classscribe-mobile/server/serve.js` (preview static server), `attached_assets/*` (old uploaded source copies), `scripts/src/*` (operator CLIs that print credentials to stdout by design).

## Threat Categories

### Spoofing / Authentication
Legacy routes trust the `X-CS-User` sync code as a bearer secret; there is no additional auth. The sync code and group codes are high-entropy, so guessing is impractical, but any leak of a sync code is full library takeover. Webhooks (Stripe, RevenueCat) must verify signature/secret — confirmed: Stripe uses raw-body signature verification, RevenueCat fails closed without its configured Authorization secret.

### Tampering / Elevation of Privilege
Authorization for legacy data is derived purely from the request path string, so any weakness in `validPath`/`resolveAndAuthorizePath` (depth checks, regex, the `me`→uid alias, trailing-slash routing) can cross library/tenant boundaries or skip privacy checks. One confirmed issue: a trailing slash on `/api/db/set` makes `operation` fall through the special-case dispatch, skipping the age-band load and bypassing the minor group-sharing restriction. Billing/plan and `by`/`code`/owner fields must never be client-mass-assignable into documents.

### Information Disclosure
Shared/collaborative reads require the correct group code; member-name lookups require demonstrated group activity. AI Ask evidence must stay scoped to the caller's own library and authorized courses, never mixing another student's private work. Privacy exports use random 256-bit expiring download tokens.

### Denial of Service
Legacy routes enforce per-uid rate budgets and request/document size caps (1 MB document, ~1.05 MB request, 36 MB transcription, 50 MB JSON body). AI/transcription operations are metered and credit-gated.
