# ClassScribe CRD → CREDITS migration: owner runbook

## Status and safety boundary

This work is staged only. No RevenueCat write was sent. Current RevenueCat
authorization is reported as HTTP 401/403, so **do not pass `--apply` and do
not set `REVENUECAT_CREDITS_MIGRATION_WRITE_ACCESS_VERIFIED=yes`** until the
owner has established working, project-scoped read/write credentials. The
migration and reconciliation commands are read-only by default.

The migration control record is stored in the existing
`classscribe_legacy_documents` table at
`private/classscribe-billing/credits-migration-control`; it does not create a
new table. `getCreditsMigrationState()` is the server’s authoritative
readiness source:

```ts
{
  maintenance: boolean;
  activeCurrency: "CRD" | "CREDITS";
  serverSubscriptionGrantReady: boolean;
  version: string;
}
```

Missing control state means legacy `CRD`, not in maintenance, server monthly
subscription grants not ready, version `legacy-v1`. Invalid persisted control
data fails closed (maintenance on, CRD, monthly grants not ready). Every
server-side grant/spend route must consult this control state: block grants
and spends while maintenance is true, and do not expose an empty `CREDITS`
balance or advertise `CREDITS` before the transfer has verified. Currency
version changes are persisted in the same record so server consumers can
invalidate any cached currency selection.

## Verified RevenueCat API contract

The current official [RevenueCat V2 Virtual Currency OpenAPI
schema](https://www.revenuecat.com/docs/redocusaurus/openapi-v2-virtual-currency.yaml)
was fetched and reviewed for this implementation:

- `POST /v2/projects/{project_id}/customers/{customer_id}/virtual_currencies/transactions`
  accepts one required `adjustments` object (currency-code → integer) and an
  optional `reference`. The migration sends one atomic request per library:
  `{ "adjustments": { "CRD": -X, "CREDITS": X }, "reference":
  "migrate-crd-<canonicalLibraryHash>" }`.
- `Idempotency-Key` is documented as optional, maximum 255 characters, and
  intended to ensure exactly-once execution of an identical request. Reusing a
  key with a different request can return `idempotency_error`. The migration
  uses the stable key `migrate-crd-<canonicalLibraryHash>`. Local database
  state alone cannot prove whether RevenueCat applied a timed-out request.
- There is **no transaction-history listing/read-by-reference operation in the
  current Virtual Currency API schema**. `reference` is accepted as a request
  field, but the schema does not define it as a queryable history key. Therefore
  a pending or ambiguous request is never blindly sent again. Inspect the
  provider’s transaction/event history manually for the exact reference and
  adjustments, then use `--verified-reference=<canonical-library-hash>` with
  `--apply` only after that external verification. The script still requires
  the read-back balances to match. If history does not expose a verifiable
  reference, leave the entry pending and request owner/support resolution.
- Currency `state` is documented as `active | inactive`. The actual archive
  endpoint is
  `POST /v2/projects/{project_id}/virtual_currencies/CRD/actions/archive`;
  its response/readback must report `state: "inactive"`. The migration does not
  fake an archive by renaming or editing a currency.
- The transaction endpoint requires `customer_information:purchases:read_write`;
  archive/configuration updates require
  `project_configuration:virtual_currencies:read_write`. Balance reads require
  `customer_information:purchases:read`.
- The migration and reconciliation scripts use the shared server
  `revenueCatRequest()` helper for project discovery, customer inventory, and
  customer virtual-currency balance/transaction calls. It prefers the
  server-only `REVENUECAT_CREDITS_API_KEY`; never print or pass the key as a
  command-line argument. When this explicit key is configured but invalid, a
  401 is a hard stop—there is no fallback to connector OAuth. Catalog
  project/product/offering/currency-configuration calls remain on the Replit
  RevenueCat connector and require its project-configuration read/write scopes.

These schema guarantees do not replace a live write-scope check. A 401/403 on
any preflight GET stops before migration-control, database-entry, catalog, or
provider writes. Since there is no safe non-mutating endpoint to prove all
write scopes, an owner must independently verify that the project-scoped V2
secret/API connection has the required write permissions before setting the
explicit confirmation environment variable. Never put a credential in CLI
arguments, logs, source, or this document.

## Preflight and execution

Run from the workspace root. The first command is inspection only:

```sh
pnpm --filter @workspace/scripts exec tsx src/migrate-classscribe-credit-currency.ts
```

It inventories all paginated RevenueCat customers and virtual-currency
balances, canonicalizes known library identity aliases, validates the
Student/Pro and credit-pack product classifications, and prints only
canonical SHA-256 library identifiers. Any ambiguous mapping, unsupported
product, unknown CRD/CREDITS product-grant association, existing nonzero
`CREDITS` target balance, or unexpected catalog state halts the run. It does
not create customers, assume aliases, detach unknown products, or overwrite an
existing target balance.

Before applying:

1. Resolve the current 401/403 and verify project-scoped project-read,
   `customer_information:customers:read_write`,
   `customer_information:purchases:read_write`, and
   `customer_information:purchases:read` permissions on the V2 server key.
   Separately verify the connector's project-configuration read/write scopes
   for catalog inspection/updates. Keep the secret in the secure environment
   only.
2. Confirm the application is deployed with the maintenance gate using
   `getCreditsMigrationState()` and that all server grants and spends fail
   closed during maintenance. Do not start catalog operations before
   authorization is proven.
3. Review the dry-run inventory, aliases, balances, and catalog plan. In
   particular, ensure every store’s Student/Pro subscription products and all
   `credits_10`, `credits_30`, and `credits_75` products are classified.
4. Schedule an owner-observed maintenance window. RevenueCat store product
   grants can occur independently of server-side grants; any balance movement
   during the transfer causes a loud stop with maintenance left active.

Only after the owner has verified the provider write permissions:

```sh
REVENUECAT_CREDITS_MIGRATION_WRITE_ACCESS_VERIFIED=yes \
  pnpm --filter @workspace/scripts exec tsx src/migrate-classscribe-credit-currency.ts --apply
```

The command stores each library’s pre-transfer balances and ledger total in a
durable private document before its provider transaction. It uses the resolved
canonical library hash once per real RevenueCat customer and sends the atomic
two-currency adjustment. It then confirms each customer has `CRD == 0` and
`CREDITS == original CRD`, prepares the catalog with all old CRD product grants
removed, applies the desired CREDITS grants, and reads back every currency,
product inventory, current offering, and package membership before changing
the readiness record. It commits `activeCurrency: "CREDITS"`,
`serverSubscriptionGrantReady: true`, and a new version only after final balance
and catalog verification; then it invokes the official CRD archive action and
verifies `state: "inactive"`.

If the process stops at `transfer-pending` or `transfer-uncertain`, a normal
re-run refuses to POST again. Verify the provider event/transaction history by
the exact stored reference first. Once verified, resume just that library:

```sh
REVENUECAT_CREDITS_MIGRATION_WRITE_ACCESS_VERIFIED=yes \
  pnpm --filter @workspace/scripts exec tsx src/migrate-classscribe-credit-currency.ts \
    --apply --verified-reference=<64-character-canonical-library-hash>
```

This recovery path performs balance readback and marks the existing transfer
verified; it does not resend it. Never use it without provider-history evidence.
A definitive HTTP rejection that is known not to have executed may be retried
with the same stable idempotency key after the reason has been resolved.

## Catalog plan

- Preserve the current `default` offering, every existing package, and native
  product IDs. Do not replace or detach active Apple subscription products.
- Keep all Student and Pro subscription products out of both currencies’
  RevenueCat product grants. Once CREDITS is verified and ready, the server is
  the sole authority for the monthly subscription bonuses (currently 10 and 30).
- Relink only classified native consumable pack products to CREDITS at 10, 30,
  or 75, with no trial grant or cycle expiry. The package/product inventory
  itself is not rewritten by the currency migration.
- Remove all product-grant associations from CRD only after every current grant
  has been classified. Any unknown/unsupported product or association halts
  for owner review; nothing is silently detached.
- The script removes product grants from both CRD and CREDITS while customer
  balances transfer. After all balances verify, only native pack grants are
  restored to CREDITS; readback must prove there are no subscription grants in
  either currency before the readiness record is committed. The server monthly
  grant becomes ready only after that readback and final balance verification.

## Nightly, read-only reconciliation

Run a one-off read-only report:

```sh
pnpm --filter @workspace/scripts exec tsx src/reconcile-classscribe-credits.ts
```

The command inventories all paginated provider customers and compares each
migrated balance to the durable migration baseline plus the net change in the
application credit ledger. The ledger delta includes actual RevenueCat native
pack/subscription grants persisted from provider webhooks; `reference` values
for `migrate-crd-*` migration transactions are excluded to prevent counting the
same API adjustment twice. Every mismatch is reported with a hashed library
identifier, and the command never adjusts balances or writes a repair.
Untracked nonzero provider customers are counted without exposing their
identities. Exit code 2 means the report found mismatches; exit code 1 means
reconciliation could not run.

The official Virtual Currency API does not expose transaction-history
enumeration, so the reconciliation is explicitly based on saved provider
balance baselines and application ledger deltas, not a claim that every
out-of-band provider adjustment can be reconstructed. Owners must investigate
mismatches in RevenueCat and the relevant app webhook/ledger before considering
any manual repair.

The guarded notification runner is available through
`pnpm --filter @workspace/scripts nightly-classscribe-credits`. Follow
`docs/classscribe-nightly-credit-checks.md` for its production-target guard,
separate Scheduled deployment template, Gmail delivery check, exit statuses,
and remaining owner activation steps. No live production scheduler has been
activated. Preserve the existing web deployment; do not add an automatic
balance fixer.

## Tests and current stage

The pure adapter/orchestration tests cover the atomic paired adjustment, stable
canonical key, invalid inputs, durable ambiguous phases, manual-history recovery
guard, exact post-transfer balance checks, pack-only catalog grants, the
readiness commit guard, and alias-normalized migration baselines:

```sh
pnpm --filter @workspace/scripts test:credits-migration
pnpm --filter @workspace/scripts typecheck
```

`--apply` has not been run. No RevenueCat/customer/catalog writes were made
during implementation.