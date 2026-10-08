import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalPeriodDate,
  isPaidStoreSubscriptionPeriod,
  planFromStoreProductIdentifier,
  storeSubscriptionProductForEvent,
  subscriptionPeriodGrantDecision,
  subscriptionPeriodGrantKey,
  subscriptionPeriodReversalAmount,
  verifiedSubscriptionSnapshotMatches,
} from "../src/lib/credits-subscription-periods.ts";

test("subscription-period grant policy covers retries, source overlap, upgrades, downgrades, and refunds", () => {
  const libraryHash = "a".repeat(64);
  const initialPeriodStart = canonicalPeriodDate(1_735_689_600_000);
  const stripeKey = subscriptionPeriodGrantKey(libraryHash, "student", initialPeriodStart);
  assert.equal(subscriptionPeriodGrantKey(
    libraryHash,
    "student",
    canonicalPeriodDate("2025-01-01T00:00:00.000Z"),
  ), stripeKey, "canonical period timestamps produce source-independent keys");
  assert.deepEqual(subscriptionPeriodGrantDecision("student", null, 0, false), {
    amount: 10,
    highWaterPlan: "student",
  });
  assert.equal(subscriptionPeriodGrantDecision("student", "student", 10, false).amount, 0,
    "same plan/source retries cannot grant twice");
  assert.equal(subscriptionPeriodGrantDecision("student", "student", 10, false).amount, 0,
    "Stripe and RevenueCat overlap cannot grant twice");
  assert.equal(subscriptionPeriodGrantDecision("pro", "student", 10, false).amount, 20,
    "mid-period Student-to-Pro change only grants the difference");
  assert.equal(subscriptionPeriodGrantDecision("student", "pro", 30, false).amount, 0,
    "a downgrade does not claw back the period high-water");
  assert.equal(subscriptionPeriodReversalAmount(6, 30), 6,
    "reversal clamps to the actual provider balance");
  assert.equal(subscriptionPeriodReversalAmount(0, 30), 0,
    "reversal never makes an unlimited negative balance");
  assert.equal(subscriptionPeriodGrantDecision("pro", "pro", 30, true).amount, 0,
    "a refunded period cannot be reopened by an older paid replay");
});

test("RevenueCat subscription validation rejects trials, zero-price purchases, and notification-only product changes", () => {
  assert.equal(isPaidStoreSubscriptionPeriod(0, "NORMAL"), false);
  assert.equal(isPaidStoreSubscriptionPeriod(1.99, "TRIAL"), false);
  assert.equal(isPaidStoreSubscriptionPeriod(1.99, undefined), false);
  assert.equal(isPaidStoreSubscriptionPeriod(1.99, "NORMAL"), true);

  const productId = storeSubscriptionProductForEvent(
    "PRODUCT_CHANGE",
    "classscribe_student_monthly",
    "classscribe_pro_monthly",
  );
  assert.equal(productId, "classscribe_pro_monthly");
  assert.equal(planFromStoreProductIdentifier(productId), "pro");
  assert.equal(storeSubscriptionProductForEvent("PRODUCT_CHANGE", "classscribe_student_monthly", undefined), undefined);

  const paidProSnapshot = {
    status: "active",
    plan: "pro",
    productIdentifier: "classscribe_pro_monthly",
    periodEnd: "2025-02-01T00:00:00.000Z",
    projectId: "verified-test-project",
    verifiedAt: new Date(Date.now() - 10_000).toISOString(),
  };
  assert.equal(verifiedSubscriptionSnapshotMatches({
    snapshot: paidProSnapshot,
    plan: "pro",
    productId,
    periodEndMs: Date.parse(paidProSnapshot.periodEnd),
    expectedProjectId: "verified-test-project",
  }), true);
  assert.equal(verifiedSubscriptionSnapshotMatches({
    snapshot: { ...paidProSnapshot, plan: "student", productIdentifier: "classscribe_student_monthly" },
    plan: "pro",
    productId,
    periodEndMs: Date.parse(paidProSnapshot.periodEnd),
    expectedProjectId: "verified-test-project",
  }), false);
  assert.equal(verifiedSubscriptionSnapshotMatches({
    snapshot: { ...paidProSnapshot, verifiedAt: "2025-01-01T00:00:00.000Z" },
    plan: "pro",
    productId,
    periodEndMs: Date.parse(paidProSnapshot.periodEnd),
    expectedProjectId: "verified-test-project",
  }), false, "stale subscription state does not authenticate a delayed notification");
});