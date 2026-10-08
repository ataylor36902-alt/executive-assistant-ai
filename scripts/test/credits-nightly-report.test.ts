import { test } from "node:test";
import assert from "node:assert/strict";
import {
  failedReport, parseNightlyReport, renderNightlyReport, validateNightlyEnvironment,
  validateNightlyReconcilerEnvironment,
} from "../src/credits-nightly-report";

const libraryHash = "a".repeat(64);
function validReport() {
  return {
    status: "verified", activeCurrency: "CREDITS", serverSubscriptionGrantReady: true,
    writesOrAutomaticFixes: 0, libraryIdentifiersHashed: true,
    mismatchCount: 0, untrackedNonzeroCustomerCount: 0, ambiguousCustomerMappingCount: 0,
    uncertainAdjustmentCount: 0, mismatches: [], uncertainAdjustments: [],
  };
}
test("maintenance skips are not mismatch alarms", () => {
  const report = parseNightlyReport(JSON.stringify({
    status: "maintenance", reconciled: false, writes: 0,
  }), 0);
  assert.equal(report.status, "maintenance");
  assert.match(renderNightlyReport(report), /not a credit mismatch/);
});
test("verified read-only ready report is accepted", () => {
  assert.equal(parseNightlyReport(JSON.stringify(validReport()), 0).status, "verified");
});
test("uncertain adjustments require review even without a balance mismatch", () => {
  const report = parseNightlyReport(JSON.stringify({
    ...validReport(), status: "mismatch", uncertainAdjustmentCount: 2,
    uncertainAdjustments: [{ libraryHash, source: "provider_adjustment", status: "uncertain", count: 2 }],
  }), 2);
  assert.equal(report.status, "mismatch");
  assert.match(renderNightlyReport(report), /may already have applied/);
});
test("only allowlisted fields enter the report", () => {
  const report = parseNightlyReport(JSON.stringify({
    ...validReport(), status: "mismatch", mismatchCount: 1, secret: "PRIVATE_SECRET",
    privateStudyData: "PRIVATE_STUDY", customerId: "PRIVATE_CUSTOMER",
    mismatches: [{ libraryHash, providerCredits: 9, expectedCredits: 10, providerCrd: 0, token: "PRIVATE_TOKEN" }],
  }), 2);
  assert.equal(report.status, "mismatch");
  assert.doesNotMatch(JSON.stringify(report) + renderNightlyReport(report), /PRIVATE_/);
});
test("malformed, contradictory, unsafe, or raw-error outputs fail closed", () => {
  for (const [raw, exit] of [
    ["database secret=PRIVATE_SECRET", 1],
    [JSON.stringify({ ...validReport(), activeCurrency: "CRD" }), 0],
    [JSON.stringify({ ...validReport(), writesOrAutomaticFixes: 1 }), 0],
    [JSON.stringify(validReport()), 2],
    [JSON.stringify({ ...validReport(), mismatchCount: 1 }), 0],
    [JSON.stringify({ ...validReport(), status: "mismatch", uncertainAdjustmentCount: 1,
      uncertainAdjustments: [{ libraryHash: "u_private", source: "provider_adjustment", status: "uncertain", count: 1 }] }), 2],
  ] as const) {
    const report = parseNightlyReport(raw, exit);
    assert.equal(report.status, "failed");
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SECRET|u_private/);
  }
});
test("target requires owner-verified production DB, exact RC project, server key, and recipient", () => {
  const env = {
    NODE_ENV: "production", CREDITS_RECONCILIATION_DATABASE_VERIFIED: "classscribe-production",
    CREDITS_RECONCILIATION_DATABASE_URL: "not-a-real-credential", REVENUECAT_PROJECT_ID: "projeea12cdc",
    REVENUECAT_CREDITS_API_KEY: "fixture", CREDITS_RECONCILIATION_OWNER_EMAIL: "owner@example.com",
  };
  assert.equal(validateNightlyEnvironment(env), true);
  for (const key of Object.keys(env)) assert.equal(validateNightlyEnvironment({ ...env, [key]: "" }), false);
  assert.equal(validateNightlyEnvironment({ ...env, REVENUECAT_PROJECT_ID: "other" }), false);
  assert.equal(validateNightlyEnvironment({
    ...env, CREDITS_RECONCILIATION_DATABASE_URL: "", DATABASE_URL: "scheduler-own-database",
  }), false);
  assert.equal(validateNightlyEnvironment({ ...env, CREDITS_RECONCILIATION_OWNER_EMAIL: "owner@example.com\r\nBcc: other@example.com" }), false);
});
test("failed and test reports never claim reconciliation or expose exception details", () => {
  assert.match(renderNightlyReport(failedReport("timeout")), /No balance conclusion/);
  assert.match(renderNightlyReport(failedReport("configuration"), true), /not a completed production reconciliation/);
});

test("direct reconciliation cannot bypass activation, read-only mode, or the dedicated target", () => {
  const env = {
    NODE_ENV: "production",
    CREDITS_RECONCILIATION_DATABASE_VERIFIED: "classscribe-production",
    CREDITS_RECONCILIATION_DATABASE_URL: "not-a-real-credential",
    DATABASE_URL: "not-a-real-credential",
    REVENUECAT_PROJECT_ID: "projeea12cdc",
    REVENUECAT_CREDITS_API_KEY: "fixture",
    CREDITS_RECONCILIATION_OWNER_EMAIL: "owner@example.com",
    CREDITS_RECONCILIATION_EXECUTION_ENABLED: "1",
    CREDITS_RECONCILIATION_READ_ONLY_REQUIRED: "1",
  };
  assert.equal(validateNightlyReconcilerEnvironment(env), true);
  for (const key of Object.keys(env)) {
    assert.equal(validateNightlyReconcilerEnvironment({ ...env, [key]: "" }), false);
  }
  assert.equal(validateNightlyReconcilerEnvironment({
    ...env, DATABASE_URL: "scheduler-managed-database",
  }), false);
  assert.equal(validateNightlyReconcilerEnvironment({
    ...env, CREDITS_RECONCILIATION_READ_ONLY_REQUIRED: "0",
  }), false);
  assert.equal(validateNightlyReconcilerEnvironment({
    ...env, CREDITS_RECONCILIATION_EXECUTION_ENABLED: "0",
  }), false);
});
