import { createHash } from "node:crypto";

export type SubscriptionCreditPlan = "student" | "pro";

export function planFromStoreProductIdentifier(value: unknown): SubscriptionCreditPlan | undefined {
  if (typeof value !== "string") return undefined;
  const productId = value.replace(/:monthly$/, "");
  if (productId === "classscribe_student_monthly" || productId === "student_monthly") return "student";
  if (productId === "classscribe_pro_monthly" || productId === "pro_monthly") return "pro";
  return undefined;
}

export function storeSubscriptionProductForEvent(
  type: unknown,
  productId: unknown,
  newProductId: unknown,
): string | undefined {
  const selected = type === "PRODUCT_CHANGE" ? newProductId : productId;
  return typeof selected === "string" ? selected : undefined;
}

export function isPaidStoreSubscriptionPeriod(price: unknown, periodType: unknown): boolean {
  return typeof price === "number" && Number.isFinite(price) && price > 0 &&
    typeof periodType === "string" && periodType.trim().toUpperCase() !== "TRIAL";
}

export function verifiedSubscriptionSnapshotMatches(input: {
  snapshot: Record<string, unknown>;
  plan: SubscriptionCreditPlan;
  productId: string;
  periodEndMs: number;
  expectedProjectId: string;
  nowMs?: number;
}): boolean {
  const snapshotProduct = typeof input.snapshot.productIdentifier === "string"
    ? input.snapshot.productIdentifier.replace(/:monthly$/, "")
    : "";
  const verifiedAt = typeof input.snapshot.verifiedAt === "string"
    ? Date.parse(input.snapshot.verifiedAt)
    : Number.NaN;
  const verifiedPeriodEnd = typeof input.snapshot.periodEnd === "string"
    ? Date.parse(input.snapshot.periodEnd)
    : Number.NaN;
  const now = input.nowMs ?? Date.now();
  return input.snapshot.status === "active" &&
    input.snapshot.plan === input.plan &&
    input.snapshot.projectId === input.expectedProjectId &&
    snapshotProduct === input.productId.replace(/:monthly$/, "") &&
    Number.isFinite(verifiedAt) &&
    verifiedAt <= now + 60_000 &&
    now - verifiedAt <= 15 * 60_000 &&
    Number.isFinite(verifiedPeriodEnd) &&
    Math.abs(verifiedPeriodEnd - input.periodEndMs) < 1_000;
}

export function canonicalPeriodDate(value: Date | string | number): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid subscription period date.");
  return date;
}

export function subscriptionPeriodGrantTarget(plan: SubscriptionCreditPlan): number {
  return plan === "pro" ? 30 : 10;
}

export function subscriptionPeriodGrantDecision(
  plan: SubscriptionCreditPlan,
  highWaterPlan: string | null,
  grantedAmount: number,
  revoked: boolean,
): { amount: number; highWaterPlan: SubscriptionCreditPlan | null } {
  if (revoked) return { amount: 0, highWaterPlan: highWaterPlan === "pro" ? "pro" : highWaterPlan === "student" ? "student" : null };
  const currentHighWater = highWaterPlan === "pro" ? "pro" : highWaterPlan === "student" ? "student" : null;
  const desired = Math.max(
    subscriptionPeriodGrantTarget(plan),
    currentHighWater ? subscriptionPeriodGrantTarget(currentHighWater) : 0,
  );
  return {
    amount: Math.max(0, desired - Math.max(0, grantedAmount)),
    highWaterPlan: desired === 30 ? "pro" : "student",
  };
}

export function subscriptionPeriodReversalAmount(balance: number, grantedAmount: number): number {
  if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(grantedAmount)) {
    throw new Error("Invalid credit balance or monthly grant amount.");
  }
  return Math.max(0, Math.min(balance, grantedAmount));
}

export function subscriptionPeriodGrantKey(
  libraryHash: string,
  plan: SubscriptionCreditPlan,
  periodStart: Date,
): string {
  const canonicalStart = periodStart.toISOString();
  const digest = createHash("sha256")
    .update(`${libraryHash}:${plan}:${canonicalStart}`)
    .digest("hex");
  return `credits-monthly-${digest}`;
}

export function subscriptionPeriodScopeKey(libraryHash: string, periodStart: Date): string {
  const digest = createHash("sha256")
    .update(`${libraryHash}:${periodStart.toISOString()}`)
    .digest("hex");
  return `credits-period-${digest}`;
}