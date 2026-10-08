# ClassScribe Credit Scheduler

A separate, staged nightly read-only ClassScribe credit checker. The complete
source export and scheduler overlay are imported; live database verification and
activation remain blocked. Never modify the original ClassScribe project.

## Safety and setup status

- Do not publish, activate a schedule, send a delivery test, or change balances,
  ledgers, migration controls, catalog records, or provider data.
- Production migration-control state and target identity are unverified. The
  guide reports no control record while a separate observation reports a
  CREDITS-ready `test-ready-v1` record. The owner’s provenance note cannot link
  either to original production: builds identify this workspace only, dev logs
  lack database IDs/probe times, and scheduler role/grants are unknown.
  Treat both observations as unattributed and resolve identity before live use.
- Do not request or use `CREDITS_RECONCILIATION_DATABASE_URL` or
  `REVENUECAT_CREDITS_API_KEY`, or set
  `CREDITS_RECONCILIATION_DATABASE_VERIFIED`, until that verification and
  least-privilege access are approved. Never copy original-project secrets.
- Gmail is attached. The production recipient environment variable is configured
  to the owner-approved business inbox. No mail has been sent from this project.
- Keep `CREDITS_RECONCILIATION_EXECUTION_ENABLED` absent. The runner blocks all
  external operations, including delivery tests, unless the owner activates it.
- Scheduled build/run settings are staged in `.replit`, but not published.
  The owner must confirm UTC, 03:17 daily, and 3300 seconds in Publishing.
- Artifact registration metadata is archived outside `artifacts`. The platform
  unregistered the starter artifacts and removed their managed workflows.
  Do not restart these or launch the copied application's jobs.
- Source secrets, provider config, and its schema-writing post-merge hook were
  excluded. The scheduler post-merge hook installs dependencies only.
- The original source billing schema is now present. Do not change it or run
  schema push, migration, seed, repair, or provider-write scripts.
- Source of truth: `docs/classscribe-nightly-credit-checks.md`, particularly
  its separate-copy status section.

## Run & Operate

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm check:classscribe-source-integrity` — offline website check; requires
  externally recorded `CLASSSCRIBE_SOURCE_ZIP_SHA256`. Never auto-repin it from
  workspace files. See `docs/classscribe-source-baseline.md` for baseline review.
- `pnpm --filter @workspace/scripts test:credits-nightly` — local parser and inactive-runner tests; no live access
- `pnpm --filter @workspace/scripts typecheck` — scheduler script typecheck
- Never run schema push, seeding, migration, balance repair, or provider writes.
- Never use this project's managed `DATABASE_URL` as a substitute for the
  original application's verified production billing database.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `scripts/src/run-nightly-classscribe-credits.ts` — default-off report runner
- `scripts/src/reconcile-classscribe-credits.ts` — supplied read-only checker
- `scripts/src/credits-nightly-report.ts` — sanitized report parser and renderer
- `scripts/test/` — local nightly tests
- `.replit` / `ops/credits-nightly/scheduled-project.replit.toml` — staged scheduled settings / source template
- `ops/credits-nightly/source-export/` — supplied export provenance and checksum manifest
- `docs/classscribe-nightly-credit-checks.md` — source guide with copy-specific status override

## Architecture decisions

This is an overlay integration, not a replacement billing implementation.
Preserve original workspace imports and use the exact original database schema,
rather than reconstructing missing definitions from SQL or guessing table names.

## Product

The supplied runner reports credit reconciliation issues through Gmail after
owner activation. It must never repair an issue automatically. This project is
not yet an integrated or production-verified scheduler.

## Gotchas

- Local validation passed: 10 nightly tests, 7 migration logic tests, full
  workspace typecheck, and frozen offline dependency install. None attest the
  production database or prove Gmail report delivery.
- Use both `test:credits-nightly` and `test:credits-migration` for local tests;
  the migration tests exercise pure logic and do not invoke the migration CLI.
- Reconciliation checks its owner activation, dedicated target configuration,
  and read-only session before reading billing state or calling RevenueCat.
- The export's redacted iOS provider-configuration CLI is explicitly disabled;
  its supplied source is archived as a non-executable reference. Do not restore
  write functionality in this scheduler.
- A compatible shell-quote 1.x override resolves the copied mobile tooling's
  firewall-blocked dependency. Do not bypass the firewall or upgrade frameworks
  to make this scheduler install.
- Historical delivery and database claims in the supplied guide are not
  verification of this separate scheduler copy.
- Historical source-guide claims of a development email test/receipt are not
  verified Sent-copy evidence for this scheduler. No message was sent or
  searched for here; only Gmail profile GET access was checked.
- Remaining owner gates: `ops/credits-nightly/OWNER-VERIFICATION.md`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
