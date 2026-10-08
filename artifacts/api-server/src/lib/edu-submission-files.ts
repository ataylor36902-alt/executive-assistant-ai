import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { classscribePrivacyDeletionOutboxTable, db } from "@workspace/db";
import { processPrivacyDeletionOutboxItem } from "./privacy-deletion";

type Executor = Pick<typeof db, "insert">;

/** Persist cleanup with the row mutation; a storage outage must not orphan private work. */
export async function queueSubmissionFileCleanup(executor: Executor, key: string, pendingUpload = false) {
  const [item] = await executor.insert(classscribePrivacyDeletionOutboxTable).values({
    id: randomUUID(),
    libraryHash: "edu-submission-file",
    pendingProviders: [`storage:${key}`],
    // Upload reservations survive process failure, but must not be swept during a live upload.
    nextAttemptAt: new Date(Date.now() + (pendingUpload ? 60 * 60 * 1000 : 0)),
  }).returning();
  return item;
}

export async function cleanSubmissionFiles(
  items: Awaited<ReturnType<typeof queueSubmissionFileCleanup>>[],
): Promise<boolean> {
  let pending = false;
  for (const item of items) {
    try { pending = (await processPrivacyDeletionOutboxItem(item)) || pending; }
    catch { pending = true; } // The committed outbox remains available to the retry worker.
  }
  return pending;
}

export async function retrySubmissionFileCleanup(): Promise<void> {
  const items = await db.select().from(classscribePrivacyDeletionOutboxTable).where(and(
    eq(classscribePrivacyDeletionOutboxTable.libraryHash, "edu-submission-file"),
    lte(classscribePrivacyDeletionOutboxTable.nextAttemptAt, new Date()),
  )).limit(50);
  await cleanSubmissionFiles(items);
}

let retryTimer: ReturnType<typeof setInterval> | undefined;
export function startSubmissionFileCleanupScheduler(onError: () => void): void {
  if (retryTimer) return;
  let running = false;
  retryTimer = setInterval(() => {
    if (running) return;
    running = true;
    void retrySubmissionFileCleanup().catch(onError).finally(() => { running = false; });
  }, 60_000);
  retryTimer.unref();
}
