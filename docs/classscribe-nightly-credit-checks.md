# Nightly ClassScribe credit checks

## Separate scheduler copy — live activation blocked

The sections below describe the supplied source-project handoff and historical
checks, **not verification or delivery from this new scheduler project**.
No schedule is active here and nothing has been published.
For the remaining owner-only gates, see
[`ops/credits-nightly/OWNER-VERIFICATION.md`](../ops/credits-nightly/OWNER-VERIFICATION.md).

The owner's complete source export has now been imported and the supplied
overlay merged. Its SHA-256 file manifest was checked before import. Website
source is preserved; source runtime/provider settings, secrets, and the original
schema-pushing post-merge hook were not copied. The scheduler hook installs
dependencies only. Do not invent or substitute billing table definitions.

There is conflicting evidence about the intended production database: the guide
below says the migration-control record is absent, whereas an earlier read-only
inspection through the original project's production pool returned
`maintenance=false`, `activeCurrency=CREDITS`,
`serverSubscriptionGrantReady=true`, and `version=test-ready-v1`.
The owner must confirm the intended production database identity and resolve
that discrepancy before comparisons, reports, or database attestation.

Gmail is attached to this scheduler project and the production recipient is
configured through `CREDITS_RECONCILIATION_OWNER_EMAIL`. No delivery test or report
has been sent from this copy. Production database and RevenueCat credentials
have not been copied, requested, or configured here.

The runner additionally requires `CREDITS_RECONCILIATION_EXECUTION_ENABLED=1`.
Leave it absent until owner approval after database identity and least-privilege
access are verified. While absent, both normal runs and `--test-delivery` exit
with a blocked status **before database, RevenueCat, or Gmail access**. Delivery
testing still requires separate explicit owner approval.

The deployment file under `ops/credits-nightly` is only a staged template.
The proposed schedule remains **03:17 UTC daily**, cron `17 3 * * *`, with a
3300-second timeout. Only the owner may review Publishing settings and publish.
Artifact metadata has been moved out of the registration locations into inert
references under `ops/credits-nightly/reference-artifacts`, in this copy only.
The platform has unregistered the starter artifacts and removed their managed
workflows. Do not restart them or launch copied application jobs. This copy is
now a standalone scheduled command, not a multi-artifact web publish.
The `.replit` build/run settings are staged for Scheduled publishing; there is
still no active schedule or deployment.

Direct reconciliation also requires the approved runner's configuration and
exact dedicated database URL. The read-only session check is mandatory, not
conditional; the managed scheduler database is never a fallback.

Local verification in this copy passed: 10 nightly report/execution tests,
7 migration-adapter logic tests, the full workspace typecheck, and a frozen
offline dependency install. The migration tests do not run the migration CLI.
All 449 copied website/mobile source files matched the supplied export manifest.
Gmail profile access was verified with a GET request only. None of these checks
verify the production database, provider balances, report delivery, or a live
schedule.

The copied mobile tooling's firewall-blocked `shell-quote` release is replaced
by a compatible 1.x override in this copy only; the mobile framework and website
source are unchanged. A redacted iOS provider-write utility is explicitly
disabled, with its supplied version retained as an inert source reference.
The copied RevenueCat verification utility received a JSON type-narrowing fix
but has not been executed.

## Current activation status

The guarded runner and separate-project deployment template are prepared.
**No live schedule has been activated and no app has been published.**
With owner approval on 2026-10-08, the runner sent one labeled delivery-test
report to the selected support inbox. Gmail accepted it and its Sent copy was
read back successfully. **The owner confirmed actual receipt in the support
inbox on 2026-10-08.** This verifies the approved development delivery test,
not delivery from a future separately published scheduler. The temporary
development recipient setting was removed after the test.

Read-only production inspection on 2026-10-08 found no migration-control record.
The existing migration-state reader treats a missing record as legacy CRD
maintenance, not a verified CREDITS cutover. Provider comparison must not run
until the owner completes and verifies the existing credit migration process.
This check must never create or change that control record.

The existing published app was verified as a public Autoscale deployment at
https://class-scribe.replit.app. Preserve that deployment. A development
workflow or cron process in the editor is not a production scheduler.

## Supported scheduler setup — requires owner activation

Use a **separate Replit Scheduled deployment**, with its own publishing
lifecycle, rather than converting this project's live web deployment.
Replit documentation consulted:

- https://docs.replit.com/features/publishing/deployment-types#scheduled
- https://docs.replit.com/features/project-setup/configuration
- https://docs.replit.com/features/projects-and-artifacts/multiple-artifacts-vs-projects
- https://docs.replit.com/features/data-and-storage/development-and-production

`ops/credits-nightly/scheduled-project.replit.toml` is a configuration template
for that separate non-artifact project, not an active schedule in this app.
This pnpm workspace's registered artifact services manage its web publishing;
do not add a scheduled target to their production services or replace their
configuration.

1. Create an independent scheduler project with this revision's required
   workspace code and dependencies. The reconciler dynamically imports the API
   migration-state and RevenueCat read helpers, so keep those paths available.
   Remove artifact registration metadata **only from that separate scheduler
   copy** so it is a scheduled command, not another multi-artifact web publish.
   Keep its source aligned with approved billing releases.
2. Apply the template there, or enter its settings in Publishing: Scheduled,
   cron `17 3 * * *`, **03:17 UTC daily**, run
   `pnpm --filter @workspace/scripts nightly-classscribe-credits`,
   build `pnpm install --frozen-lockfile`, timeout 3300 seconds.
   Confirm UTC explicitly in the schedule UI. The runner allows 45 minutes for
   reconciliation, then up to 60 seconds for notification; avoid overlapping runs.
3. Bind the existing Gmail integration in that project. Do not assume the new
   project inherits this project's connectors or production database.
4. Configure its secrets securely, never in code, logs, or chat:
   - `CREDITS_RECONCILIATION_DATABASE_URL`: a read-only connection to **the original ClassScribe
     published production billing database**, not the scheduler's own
     development/production database. Prefer a SELECT-only database role.
     In the original project's Database tool, select **Production**, then
     **Settings** for connection details. Put this connection only into the
     separate scheduler's Secrets; never paste it into Agent chat. Do not
     replace the new project's runtime-managed `DATABASE_URL`. The runner
     supplies the approved connection to its read-only child process.
   - `REVENUECAT_CREDITS_API_KEY`: server-only V2 credential for the published
     ClassScribe project; use least-privilege customer/currency read access.
5. Configure non-secret values in the scheduler's production environment:
   - `NODE_ENV=production`
   - `REVENUECAT_PROJECT_ID=projeea12cdc`
   - `CREDITS_RECONCILIATION_OWNER_EMAIL=<owner-approved recipient>`
   - `CREDITS_RECONCILIATION_DATABASE_VERIFIED=classscribe-production`
     **only after independently verifying the database target above**.
     This is owner attestation, not automatic proof of database identity.
6. Enable Scheduled deployment failure notifications to the owner in Publishing.
   These are essential for failures before this code starts, killed jobs,
   connector outages, and undelivered application reports. Retain restricted
   scheduler logs and check the last successful/maintenance heartbeat daily.
7. With recipient approval, run
   `pnpm --filter @workspace/scripts nightly-classscribe-credits -- --test-delivery`
   in the scheduler environment. The delivery test sends a clearly labeled
   configuration-failure sample and **does not access the database or RevenueCat**.
   Verify Gmail acceptance plus Sent readback; separately confirm actual receipt
   in the destination inbox. A Sent copy alone is not proof of receipt.
8. Manually run the normal command in that environment. Confirm target,
   sanitized output, exit status, report receipt if review is needed, and no
   writes. Before verified CREDITS cutover, the existing maintenance gate must
   return a skip without provider comparisons or a mismatch alarm. It is safe
   to activate a correctly configured scheduler in that skipped state; cutover
   blocks balance comparison, not scheduler setup. **Owner clicks Publish** to
   activate the separate scheduler; the agent must not publish automatically.
   Confirm the first scheduled execution in Publishing logs. After verified
   cutover, verify its first actual read-only provider comparison.

If the owner cannot provide read-only access to the original production DB,
stop here. Do not substitute the development DB or silently point the scheduler
at a fresh empty DB.

## Behavior and investigation

- The runner refuses provider comparison without explicit production-target
  attestation, pinned RevenueCat project, server key, database, and recipient.
- The existing migration-control readiness gate still runs first. Maintenance
  returns a skip, exit 0, and no mismatch email. If maintenance starts during
  comparison, results are discarded as a skip. Other readiness/version changes
  abort the comparison.
- Read queries use PostgreSQL default read-only transactions and bounded query
  timeouts. All RevenueCat requests made by the reconciler are GETs.
- Balance mismatches, nonzero untracked customers, ambiguous mappings, and
  uncertain adjustments or pending adjustments older than one hour trigger
  review. Both provider intents and subscription-period intents are included;
  an uncertain adjustment is reported even if its balance currently agrees.
- Report fields are allowlisted: UTC time, status, counts, validated SHA-256
  library hashes, relevant balances, source category and pending/uncertain state.
  Raw exceptions, SQL, connection strings, provider/customer IDs, access codes,
  metadata, and study content are never forwarded to email or runner output.
- A partial/failed inventory has no balance conclusion. Owners should check
  production DB access, catalog/project read permissions, migration baselines,
  and canonical identity mappings. Do not interpret missing output as zero issues.
- Email includes at most 100 entries of each kind; remaining sanitized entries
  are in restricted scheduler JSON logs. Set log retention/access with the owner.
- Provider and ledger reads are not one atomic cross-system snapshot. A grant
  or webhook in flight can produce a transient mismatch; compare committed
  history and rerun this read-only check before deciding a repair is needed.
- Investigate uncertain outcomes using provider evidence and application
  records. **Never automatically repeat an adjustment, modify a provider balance,
  write the ledger, or enable migration readiness.** Manual fixes need explicit
  owner approval.
- Sending has no blind retries. Gmail acceptance/Sent readback is logged
  separately from recipient receipt; a failed or unknown send exits 3 and needs
  scheduler-level notification.

Exit statuses: `0` verified or maintenance (or an accepted delivery test);
`1` failed check; `2` owner review required; `3` notification failed/unknown.
The report remains review-required even after its email was accepted.

## Checks

```sh
pnpm --filter @workspace/scripts test:credits-nightly
pnpm --filter @workspace/scripts test:credits-migration
pnpm --filter @workspace/scripts typecheck
```

These local tests do not prove production execution or inbox delivery. Owner
activation, verified database targeting, cutover, report receipt, and the first
scheduled execution remain release requirements.
