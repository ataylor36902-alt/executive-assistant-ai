import { lt, sql } from "drizzle-orm";
import { db, classscribeLegacyRateLimitsTable } from "@workspace/db";

const WINDOW_MS = 60_000;
let requestsSinceCleanup = 0;

export async function consumeLegacyRateBudget(scope: string, maximum: number, now = Date.now()): Promise<boolean> {
  const windowStart = new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS);
  const [counter] = await db.insert(classscribeLegacyRateLimitsTable).values({
    scope,
    windowStartedAt: windowStart,
    requestCount: 1,
  }).onConflictDoUpdate({
    target: classscribeLegacyRateLimitsTable.scope,
    set: {
      windowStartedAt: windowStart,
      requestCount: sql`case when ${classscribeLegacyRateLimitsTable.windowStartedAt} = ${windowStart}
        then ${classscribeLegacyRateLimitsTable.requestCount} + 1 else 1 end`,
    },
  }).returning({ requestCount: classscribeLegacyRateLimitsTable.requestCount });

  requestsSinceCleanup += 1;
  if (requestsSinceCleanup >= 500) {
    requestsSinceCleanup = 0;
    await db.delete(classscribeLegacyRateLimitsTable)
      .where(lt(classscribeLegacyRateLimitsTable.windowStartedAt, new Date(now - 2 * 60 * 60_000)));
  }
  return counter.requestCount <= maximum;
}