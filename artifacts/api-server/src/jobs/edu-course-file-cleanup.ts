import { and, asc, eq, lte } from "drizzle-orm";
import { db, eduCourseFileCleanupTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const storage = new ObjectStorageService();
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const courseFilePattern = new RegExp(`^edu-files/(${uuid})/(?:materials|assignments)/${uuid}$`);

export function isOwnedCourseFile(courseId: string, key: string): boolean {
  return courseFilePattern.exec(key)?.[1] === courseId;
}

type CleanupLog = Pick<typeof logger, "error" | "info">;
type CleanupOptions = {
  now?: Date;
  courseId?: string;
  deleteObject?: (path: string) => Promise<void>;
  log?: CleanupLog;
};

/** Missing objects count as success; failures remain durable and back off. */
export async function processEduCourseFileCleanupBatch(options: CleanupOptions = {}) {
  const now = options.now ?? new Date();
  const log = options.log ?? logger;
  const remove = options.deleteObject ?? (path => storage.deleteObject(path));
  const result = { deleted: 0, retryScheduled: 0, blocked: 0 };
  await db.transaction(async tx => {
    const rows = await tx.select().from(eduCourseFileCleanupTable).where(and(
      eq(eduCourseFileCleanupTable.blocked, false),
      lte(eduCourseFileCleanupTable.nextAttemptAt, now),
      ...(options.courseId ? [eq(eduCourseFileCleanupTable.courseId, options.courseId)] : []),
    )).orderBy(asc(eduCourseFileCleanupTable.nextAttemptAt)).limit(20).for("update", { skipLocked: true });
    for (const row of rows) {
      if (!isOwnedCourseFile(row.courseId, row.fileKey)) {
        await tx.update(eduCourseFileCleanupTable).set({
          blocked: true, lastErrorCode: "unsafe_course_file_key",
        }).where(eq(eduCourseFileCleanupTable.id, row.id));
        log.error({ cleanupId: row.id, courseId: row.courseId, errorCode: "unsafe_course_file_key" },
          "EDU course file cleanup blocked: key does not belong to course");
        result.blocked += 1;
        continue;
      }
      try {
        // ignoreNotFound in deleteObject also handles a crash after storage
        // deletion but before the queue transaction committed.
        await remove(`/objects/${row.fileKey}`);
      } catch {
        const attempts = row.attempts + 1;
        const delayMs = Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(attempts - 1, 11));
        await tx.update(eduCourseFileCleanupTable).set({
          attempts, lastErrorCode: "storage_delete_failed",
          nextAttemptAt: new Date(now.getTime() + delayMs),
        }).where(eq(eduCourseFileCleanupTable.id, row.id));
        log.error({ cleanupId: row.id, courseId: row.courseId, attempts, errorCode: "storage_delete_failed" },
          "EDU course file cleanup failed; retry scheduled");
        result.retryScheduled += 1;
        continue;
      }
      await tx.delete(eduCourseFileCleanupTable).where(eq(eduCourseFileCleanupTable.id, row.id));
      result.deleted += 1;
    }
  });
  if (result.deleted || result.retryScheduled || result.blocked) {
    log.info(result, "EDU course file cleanup batch finished");
  }
  return result;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startEduCourseFileCleanupScheduler(): void {
  if (timer) return;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await processEduCourseFileCleanupBatch();
    } catch {
      logger.error({ errorCode: "cleanup_batch_failed" }, "EDU course file cleanup worker failed");
    } finally {
      running = false;
    }
  };
  // Run in production too; pending deletes must not depend on a dev scheduler.
  timer = setInterval(() => { void run(); }, 60_000);
  timer.unref?.();
  void run();
}
