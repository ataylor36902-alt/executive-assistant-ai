/** Only these fields can leave the billing environment. Never forward raw logs. */
export type NightlyReport = {
  status: "verified" | "mismatch" | "maintenance" | "failed";
  checkedAt: string;
  failure?: "configuration" | "timeout" | "check_failed" | "invalid_report";
  mismatchCount: number;
  untrackedNonzeroCustomerCount: number;
  ambiguousCustomerMappingCount: number;
  uncertainAdjustmentCount: number;
  mismatches: Array<{
    libraryHash: string; providerCredits: number; expectedCredits: number; providerCrd: number;
  }>;
  uncertainAdjustments: Array<{
    libraryHash: string; source: "provider_adjustment" | "subscription_period";
    status: "pending" | "uncertain"; count: number;
  }>;
};

export function failedReport(failure: NightlyReport["failure"]): NightlyReport {
  return {
    status: "failed", checkedAt: new Date().toISOString(), failure,
    mismatchCount: 0, untrackedNonzeroCustomerCount: 0,
    ambiguousCustomerMappingCount: 0, uncertainAdjustmentCount: 0,
    mismatches: [], uncertainAdjustments: [],
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid report");
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Invalid count");
  return Number(value);
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid hash");
  return value;
}

export function parseNightlyReport(stdout: string, exitCode: number | null): NightlyReport {
  try {
    const raw = object(JSON.parse(stdout));
    const report = failedReport("invalid_report");
    if (raw.status === "maintenance" && exitCode === 0 &&
      raw.reconciled === false && raw.writes === 0) {
      return { ...report, status: "maintenance", failure: undefined };
    }
    if ((raw.status !== "verified" || exitCode !== 0) &&
        (raw.status !== "mismatch" || exitCode !== 2)) throw new Error("Invalid status");
    if (raw.activeCurrency !== "CREDITS" || raw.serverSubscriptionGrantReady !== true ||
        raw.writesOrAutomaticFixes !== 0 || raw.libraryIdentifiersHashed !== true ||
        !Array.isArray(raw.mismatches) || !Array.isArray(raw.uncertainAdjustments)) {
      throw new Error("Unsafe report");
    }
    report.status = raw.status;
    report.failure = undefined;
    report.mismatchCount = count(raw.mismatchCount);
    report.untrackedNonzeroCustomerCount = count(raw.untrackedNonzeroCustomerCount);
    report.ambiguousCustomerMappingCount = count(raw.ambiguousCustomerMappingCount);
    report.uncertainAdjustmentCount = count(raw.uncertainAdjustmentCount);
    report.mismatches = raw.mismatches.map((item) => {
      const row = object(item);
      return {
        libraryHash: hash(row.libraryHash), providerCredits: count(row.providerCredits),
        expectedCredits: count(row.expectedCredits), providerCrd: count(row.providerCrd),
      };
    });
    report.uncertainAdjustments = raw.uncertainAdjustments.map((item) => {
      const row = object(item);
      if ((row.source !== "provider_adjustment" && row.source !== "subscription_period") ||
          (row.status !== "pending" && row.status !== "uncertain")) throw new Error("Invalid intent");
      return {
        libraryHash: hash(row.libraryHash), source: row.source,
        status: row.status, count: count(row.count),
      };
    });
    if (report.mismatchCount !== report.mismatches.length ||
        report.uncertainAdjustmentCount !== report.uncertainAdjustments.reduce((sum, row) => sum + row.count, 0)) {
      throw new Error("Incomplete report");
    }
    const issues = report.mismatchCount + report.untrackedNonzeroCustomerCount +
      report.ambiguousCustomerMappingCount + report.uncertainAdjustmentCount;
    if ((report.status === "verified") !== (issues === 0)) throw new Error("Inconsistent report");
    return report;
  } catch {
    return failedReport(exitCode === 1 ? "check_failed" : "invalid_report");
  }
}

export function renderNightlyReport(report: NightlyReport, test = false): string {
  const lines = [
    test ? "DELIVERY TEST — not a completed production reconciliation." : "Nightly ClassScribe credit check",
    `UTC time: ${report.checkedAt}`,
    `Status: ${report.status}`,
    "Read-only: no provider balances, ledger entries, or migration controls were changed.",
  ];
  if (report.status === "maintenance") {
    lines.push("Skipped because migration maintenance is active. This is not a credit mismatch.");
  } else if (report.status === "failed") {
    lines.push(`Failure category: ${report.failure}`,
      "No balance conclusion is available. Check scheduler configuration, production database access,",
      "verified CREDITS migration readiness, RevenueCat project/read permissions, and durable baselines.");
  } else {
    lines.push(`Balance mismatches: ${report.mismatchCount}`,
      `Untracked nonzero customers: ${report.untrackedNonzeroCustomerCount}`,
      `Ambiguous mappings: ${report.ambiguousCustomerMappingCount}`,
      `Uncertain or pending-over-one-hour adjustments: ${report.uncertainAdjustmentCount}`);
    for (const row of report.mismatches.slice(0, 100)) {
      lines.push(`Library ${row.libraryHash}: CREDITS provider=${row.providerCredits}, expected=${row.expectedCredits}; retired CRD=${row.providerCrd} (expected 0)`);
    }
    for (const row of report.uncertainAdjustments.slice(0, 100)) {
      lines.push(`Library ${row.libraryHash}: ${row.source}, ${row.status}, count=${row.count}`);
    }
    if (report.mismatches.length > 100 || report.uncertainAdjustments.length > 100) {
      lines.push("Email limited to the first 100 entries of each kind; inspect the restricted scheduler JSON report for the remaining hashes.");
    }
    if (report.status === "mismatch") lines.push(
      "Investigate provider balances against saved migration baselines and committed ledger deltas.",
      "An uncertain adjustment may already have applied. Do not replay it or repair a balance automatically.",
      "Confirm provider evidence and obtain owner approval before any manual repair.");
  }
  return lines.join("\n");
}

export function validateNightlyEnvironment(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" &&
    env.CREDITS_RECONCILIATION_DATABASE_VERIFIED === "classscribe-production" &&
    Boolean(env.CREDITS_RECONCILIATION_DATABASE_URL) &&
    env.REVENUECAT_PROJECT_ID === "projeea12cdc" &&
    Boolean(env.REVENUECAT_CREDITS_API_KEY) &&
    /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.CREDITS_RECONCILIATION_OWNER_EMAIL ?? "");
}

export function validateNightlyReconcilerEnvironment(env: NodeJS.ProcessEnv): boolean {
  return validateNightlyEnvironment(env) &&
    env.CREDITS_RECONCILIATION_EXECUTION_ENABLED === "1" &&
    env.CREDITS_RECONCILIATION_READ_ONLY_REQUIRED === "1" &&
    env.DATABASE_URL === env.CREDITS_RECONCILIATION_DATABASE_URL;
}
