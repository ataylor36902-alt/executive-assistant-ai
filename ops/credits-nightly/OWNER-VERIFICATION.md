# Owner-only verification and activation gates

## Current result

The complete supplied source and overlay are integrated in this scheduler copy.
Local nightly tests (10), migration-adapter logic tests (7), full workspace
typecheck, and frozen offline dependency installation passed. The copied
website/mobile source matches the supplied export. Gmail is attached, profile
GET access is verified, and the requested production recipient is configured.

**This is not production database verification.** No live reconciliation,
provider comparison, report/test email, balance/ledger/control/catalog/provider
write, or publishing has occurred. There is no active schedule. Execution is
blocked by default, even for `--test-delivery`.

## 1. Confirm the intended production database

Verify its non-secret database/provider identifier and source-project identity.
It must be the original ClassScribe production billing database, not this
scheduler's managed development database.

Resolve the conflicting evidence before continuing:

- The supplied guide says production has no migration-control record.
- An earlier read-only inspection through the original production pool returned
  `maintenance=false`, `activeCurrency=CREDITS`,
  `serverSubscriptionGrantReady=true`, `version=test-ready-v1`.

Confirm which state belongs to the intended production database and why the
other observation differed. Do not change any control record to resolve this
discrepancy. Share only non-secret identity/state information; never paste a
database URL, password, token, connection string, or private user records.

## 2. Independently verify least-privilege access

Have the database administrator verify the scheduler's intended role is
SELECT-only on the required billing tables, not a table/database owner,
superuser, or write-capable role. Check inherited permissions too. It must not
have INSERT, UPDATE, DELETE, TRUNCATE, schema modification, or migration rights.
No role creation, grants, migrations, or repair commands are run by this agent.

The runner sets PostgreSQL read-only session options and the child verifies
them before reading billing state. Those guards do not replace least-privilege
credentials or production database identity verification.

## 3. Configure this copy only, after those verifications

Use this scheduler project's Replit Secrets flow for a dedicated, least-privilege
`CREDITS_RECONCILIATION_DATABASE_URL` and a read-only
`REVENUECAT_CREDITS_API_KEY`. Do not copy original-project secrets or use the
scheduler's managed `DATABASE_URL` as a replacement.

Only after identity and access have been verified, configure the remaining
non-secret production settings listed in the source guide, including
`NODE_ENV=production`, the pinned RevenueCat project identifier, and
`CREDITS_RECONCILIATION_DATABASE_VERIFIED=classscribe-production`.
The owner email setting is already configured in this project.

Keep `CREDITS_RECONCILIATION_EXECUTION_ENABLED` absent until explicit owner
approval. Local passing tests are not permission to set the attestation or
execution flags. No credentials are requested or used before the verification
gates above.

## 4. Authorize live checks and any delivery test separately

After database identity and access are verified, the owner must explicitly
approve live read-only checks and enable execution. Only then can a dedicated
connection be tested safely and reconciliation evidence gathered.

A Gmail delivery test requires separate explicit owner approval in the
conversation. The existing support-mail default and historical delivery claims
in the source guide are not approval or verification for this scheduler.

## 5. Review Publishing settings; publish only as the owner

The `.replit` Scheduled build/run commands are staged. Artifact registration
metadata and web workflows were removed in this copy only. The original
website/project was not modified.

Proposed settings, not an active schedule:

- Build: `pnpm install --frozen-lockfile`
- Run: `pnpm --filter @workspace/scripts nightly-classscribe-credits`
- Cron: `17 3 * * *`
- Timezone: **UTC** — daily at **03:17 UTC**
- Job timeout: **3300 seconds**

The owner must review Publishing, confirm the Scheduled target and timezone,
and decide when to publish. The agent must not publish or activate the schedule.
Confirm the first execution and approved delivery through restricted logs only
after activation. Never change balances or automatically repair discrepancies.
