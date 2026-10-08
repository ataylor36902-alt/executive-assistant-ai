import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMigrationCutoverReady,
  assertTransferMayBeRetried,
  buildAtomicTransfer,
  buildPackOnlyGrantPlan,
  canSubmitTransfer,
  canonicalizeMigrationEntries,
  canonicalMigrationKey,
  migrationMatches,
  transferPhaseAfterRequest,
} from "../src/credits-migration-adapter";

const libraryHash = "a".repeat(64);

test("builds one atomic two-currency adjustment with a stable canonical-library key", () => {
  const request = buildAtomicTransfer(libraryHash, 37);
  assert.deepEqual(request, {
    adjustments: { CRD: -37, CREDITS: 37 },
    reference: `migrate-crd-${libraryHash}`,
  });
  assert.equal(canonicalMigrationKey(libraryHash), request.reference);
});

test("rejects invalid identities and amounts before a provider request", () => {
  assert.throws(() => canonicalMigrationKey("not-a-hash"), /Invalid canonical library hash/);
  assert.throws(() => buildAtomicTransfer(libraryHash, 0), /positive safe integer/);
  assert.throws(() => buildAtomicTransfer(libraryHash, -1), /positive safe integer/);
  assert.throws(() => buildAtomicTransfer(libraryHash, Number.MAX_SAFE_INTEGER + 1), /positive safe integer/);
});

test("only a prepared entry can submit; pending and ambiguous requests require external proof", () => {
  assert.equal(canSubmitTransfer("prepared"), true);
  assert.equal(canSubmitTransfer("transfer-pending"), false);
  assert.equal(transferPhaseAfterRequest("success"), "transferred");
  assert.equal(transferPhaseAfterRequest("ambiguous"), "transfer-uncertain");
  assert.equal(transferPhaseAfterRequest("definitive-rejection"), "prepared");
  assert.throws(
    () => assertTransferMayBeRetried("transfer-uncertain", false),
    /without verified provider transaction history/,
  );
  assert.throws(
    () => assertTransferMayBeRetried("transfer-pending", false),
    /without verified provider transaction history/,
  );
  assert.doesNotThrow(() => assertTransferMayBeRetried("transfer-uncertain", true));
});

test("balance verification requires CRD zero and CREDITS equal to the original CRD balance", () => {
  assert.equal(migrationMatches(0, 37, 37), true);
  assert.equal(migrationMatches(1, 36, 37), false);
  assert.equal(migrationMatches(0, 38, 37), false);
  assert.equal(migrationMatches(0, -1, 37), false);
});

test("CREDITS catalog grants contain only native consumable packs", () => {
  const plan = buildPackOnlyGrantPlan([
    { id: "test-pack-10", type: "consumable", store_identifier: "credits_10" },
    { id: "apple-pack-10", type: "consumable", store_identifier: "credits_10" },
    { id: "google-pack-30", type: "consumable", store_identifier: "credits_30" },
    { id: "test-pack-75", type: "consumable", store_identifier: "credits_75" },
    { id: "student-monthly", type: "subscription", store_identifier: "student_monthly" },
    { id: "pro-monthly", type: "subscription", store_identifier: "pro_monthly" },
  ], [
    { id: "credits_10", credits: 10 },
    { id: "credits_30", credits: 30 },
    { id: "credits_75", credits: 75 },
  ]);

  assert.deepEqual(plan.grants, [
    { product_ids: ["apple-pack-10", "test-pack-10"], amount: 10, trial_amount: 0, expire_at_cycle_end: false },
    { product_ids: ["google-pack-30"], amount: 30, trial_amount: 0, expire_at_cycle_end: false },
    { product_ids: ["test-pack-75"], amount: 75, trial_amount: 0, expire_at_cycle_end: false },
  ]);
  assert.deepEqual([...plan.productIds].sort(), [
    "apple-pack-10",
    "google-pack-30",
    "test-pack-10",
    "test-pack-75",
  ]);
  assert.equal(plan.grants.some((grant) => grant.product_ids.includes("student-monthly")), false);
  assert.equal(plan.grants.some((grant) => grant.product_ids.includes("pro-monthly")), false);
});

test("server subscription grants cannot become ready before balances and catalog are verified", () => {
  assert.throws(
    () => assertMigrationCutoverReady({
      allBalancesVerified: false,
      catalogReadbackVerified: true,
      subscriptionGrantsAbsent: true,
    }),
    /cannot enable server subscription grants/,
  );
  assert.throws(
    () => assertMigrationCutoverReady({
      allBalancesVerified: true,
      catalogReadbackVerified: false,
      subscriptionGrantsAbsent: true,
    }),
    /cannot enable server subscription grants/,
  );
  assert.throws(
    () => assertMigrationCutoverReady({
      allBalancesVerified: true,
      catalogReadbackVerified: true,
      subscriptionGrantsAbsent: false,
    }),
    /cannot enable server subscription grants/,
  );
  assert.doesNotThrow(() => assertMigrationCutoverReady({
    allBalancesVerified: true,
    catalogReadbackVerified: true,
    subscriptionGrantsAbsent: true,
  }));
});

test("migration baseline is normalized through alias rotation before ledger-delta joins", () => {
  const oldHash = "b".repeat(64);
  const canonicalHash = "a".repeat(64);
  const entries = canonicalizeMigrationEntries(
    [{ libraryHash: oldHash, ledgerTotalBefore: 42 }],
    (hash) => hash === oldHash ? canonicalHash : hash,
  );
  const canonicalLedgerTotals = new Map([[canonicalHash, 47]]);
  const baseline = entries.get(canonicalHash);
  assert.ok(baseline);
  assert.equal((canonicalLedgerTotals.get(canonicalHash) ?? 0) - baseline.ledgerTotalBefore, 5);
  assert.throws(
    () => canonicalizeMigrationEntries(
      [
        { libraryHash: oldHash, ledgerTotalBefore: 42 },
        { libraryHash: canonicalHash, ledgerTotalBefore: 42 },
      ],
      (hash) => hash === oldHash ? canonicalHash : hash,
    ),
    /duplicate canonical libraries/,
  );
});