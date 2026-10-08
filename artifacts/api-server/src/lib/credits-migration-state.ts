import { eq } from "drizzle-orm";
import { classscribeLegacyDocumentsTable, db } from "@workspace/db";

export type CreditsMigrationState = {
  maintenance: boolean;
  activeCurrency: "CRD" | "CREDITS";
  serverSubscriptionGrantReady: boolean;
  version: string;
};

const statePath = "private/classscribe-billing/credits-migration-control";
const legacyState: CreditsMigrationState = {
  maintenance: true,
  activeCurrency: "CRD",
  serverSubscriptionGrantReady: false,
  version: "legacy-v1",
};

function isCurrency(value: unknown): value is CreditsMigrationState["activeCurrency"] {
  return value === "CRD" || value === "CREDITS";
}

export async function getCreditsMigrationState(): Promise<CreditsMigrationState> {
  const [row] = await db
    .select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, statePath))
    .limit(1);
  if (!row) return { ...legacyState };

  const rawData = row.data;
  if (
    !rawData ||
    typeof rawData !== "object" ||
    Array.isArray(rawData)
  ) {
    return {
      maintenance: true,
      activeCurrency: "CRD",
      serverSubscriptionGrantReady: false,
      version: "invalid-control-record",
    };
  }
  const data = rawData as Record<string, unknown>;
  if (
    typeof data.maintenance !== "boolean" ||
    !isCurrency(data.activeCurrency) ||
    typeof data.serverSubscriptionGrantReady !== "boolean" ||
    typeof data.version !== "string" ||
    !data.version
  ) {
    return {
      maintenance: true,
      activeCurrency: "CRD",
      serverSubscriptionGrantReady: false,
      version: "invalid-control-record",
    };
  }
  return {
    maintenance: data.maintenance as boolean,
    activeCurrency: data.activeCurrency,
    serverSubscriptionGrantReady: data.serverSubscriptionGrantReady as boolean,
    version: data.version,
  };
}

export async function saveCreditsMigrationState(
  state: CreditsMigrationState,
): Promise<void> {
  await db
    .insert(classscribeLegacyDocumentsTable)
    .values({ path: statePath, data: state })
    .onConflictDoUpdate({
      target: classscribeLegacyDocumentsTable.path,
      set: { data: state, updatedAt: new Date() },
    });
}

export async function isCreditsMaintenance(): Promise<boolean> {
  return (await getCreditsMigrationState()).maintenance;
}

export async function activeCurrency(): Promise<CreditsMigrationState["activeCurrency"]> {
  return (await getCreditsMigrationState()).activeCurrency;
}

export async function serverSubscriptionGrantReady(): Promise<boolean> {
  return (await getCreditsMigrationState()).serverSubscriptionGrantReady;
}