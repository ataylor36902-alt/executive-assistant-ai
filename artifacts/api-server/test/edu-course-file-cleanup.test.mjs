import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, coursesTable, eduMaterialsTable, eduAssignmentsTable,
  eduCourseFileCleanupTable, ensureEduCourseFileCleanup,
} from "@workspace/db";
import {
  isOwnedCourseFile, processEduCourseFileCleanupBatch,
} from "../src/jobs/edu-course-file-cleanup.ts";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage.ts";

test("course deletion durably inventories only its files and retries safely", async t => {
  const courseId = randomUUID();
  const otherCourseId = randomUUID();
  const materialKey = `edu-files/${courseId}/materials/${randomUUID()}`;
  const assignmentKey = `edu-files/${courseId}/assignments/${randomUUID()}`;
  const otherKey = `edu-files/${otherCourseId}/materials/${randomUUID()}`;
  const files = new Set([materialKey, assignmentKey, otherKey]);
  const removed = [];
  const errors = [];
  const log = { error: (data, message) => errors.push({ data, message }), info() {} };
  let now = new Date();
  const queue = () => db.select().from(eduCourseFileCleanupTable)
    .where(eq(eduCourseFileCleanupTable.courseId, courseId));
  const options = {
    now, courseId, log,
    deleteObject: async path => {
      const key = path.slice("/objects/".length);
      removed.push(key);
      files.delete(key); // Missing object is an idempotent success.
    },
  };
  try {
    await ensureEduCourseFileCleanup(pool);
    await ensureEduCourseFileCleanup(pool); // Installation is repeatable.
    await db.insert(coursesTable).values([
      { id: courseId, name: "Cleanup fixture", subject: "BIO", term: "Fall", color: "#000000", eduEnabled: true, inviteCode: randomUUID(), ownerId: "cleanup-fixture" },
      { id: otherCourseId, name: "Unrelated fixture", subject: "BIO", term: "Fall", color: "#000000", eduEnabled: true, inviteCode: randomUUID(), ownerId: "cleanup-unrelated-fixture" },
    ]);
    await db.insert(eduMaterialsTable).values([
      { courseId, title: "File", url: "", fileKey: materialKey },
      { courseId, title: "Link only", url: "https://example.com" },
      { courseId: otherCourseId, title: "Unrelated", url: "", fileKey: otherKey },
    ]);
    await db.insert(eduAssignmentsTable).values([
      { courseId, title: "With attachment", instructions: "Read", points: 10, fileKey: assignmentKey },
      { courseId, title: "Without attachment", instructions: "Read", points: 10 },
      { courseId, title: "Duplicate reference", instructions: "Read", points: 10, fileKey: materialKey },
    ]);

    await t.test("rolled-back course deletion rolls back inventory and leaves storage alone", async () => {
      await assert.rejects(db.transaction(async tx => {
        await tx.delete(coursesTable).where(eq(coursesTable.id, courseId));
        const rows = await tx.select().from(eduCourseFileCleanupTable)
          .where(eq(eduCourseFileCleanupTable.courseId, courseId));
        assert.equal(rows.length, 2);
        throw new Error("fixture rollback");
      }), /fixture rollback/);
      assert.equal((await queue()).length, 0);
      assert.equal(files.size, 3);
    });

    await t.test("any SQL deletion inventories before cascades and deduplicates keys", async () => {
      // This is also the account-deletion route's owner-filtered mutation.
      await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
      assert.deepEqual((await queue()).map(row => row.fileKey).sort(), [materialKey, assignmentKey].sort());
      assert.equal((await db.select().from(eduMaterialsTable).where(eq(eduMaterialsTable.courseId, courseId))).length, 0);
      assert.equal((await db.select().from(eduAssignmentsTable).where(eq(eduAssignmentsTable.courseId, courseId))).length, 0);
      assert.equal((await db.select().from(eduMaterialsTable).where(eq(eduMaterialsTable.courseId, otherCourseId))).length, 1);
      assert.equal(files.size, 3, "Storage deletion waits until after database commit");
      now = new Date();
      options.now = now;
    });

    await t.test("storage failure is observable and survives after the course is gone", async () => {
      const result = await processEduCourseFileCleanupBatch({
        ...options, deleteObject: async () => { throw new Error("temporary credentials error"); },
      });
      assert.deepEqual(result, { deleted: 0, retryScheduled: 2, blocked: 0 });
      assert.equal(errors.length, 2);
      for (const row of await queue()) {
        assert.equal(row.attempts, 1);
        assert.equal(row.lastErrorCode, "storage_delete_failed");
        assert.equal(row.nextAttemptAt.getTime(), now.getTime() + 60_000);
      }
      assert.deepEqual(await processEduCourseFileCleanupBatch(options),
        { deleted: 0, retryScheduled: 0, blocked: 0 }, "Backoff prevents an immediate retry");
      assert.equal(files.size, 3);
    });

    await t.test("retry clears the inventory without touching another course", async () => {
      const result = await processEduCourseFileCleanupBatch({ ...options, now: new Date(now.getTime() + 60_001) });
      assert.deepEqual(result, { deleted: 2, retryScheduled: 0, blocked: 0 });
      assert.deepEqual([...files], [otherKey]);
      assert.equal((await queue()).length, 0);
      await db.delete(coursesTable).where(eq(coursesTable.id, courseId));
      assert.deepEqual(await processEduCourseFileCleanupBatch(options),
        { deleted: 0, retryScheduled: 0, blocked: 0 });
      assert.equal(removed.length, 2);
    });

    await t.test("replayed inventory for an already missing object completes", async () => {
      await db.insert(eduCourseFileCleanupTable).values({ courseId, fileKey: materialKey, nextAttemptAt: now });
      assert.equal((await processEduCourseFileCleanupBatch(options)).deleted, 1);
      assert.equal((await queue()).length, 0);
      assert.deepEqual([...files], [otherKey]);
    });

    await t.test("unsafe keys are quarantined, logged, and never passed to storage", async () => {
      const badKeys = [otherKey, `/objects/${materialKey}`, `edu-files/${courseId}/materials/../other`,
        `edu-files/${courseId}/materials/${randomUUID()}/extra`, "syllabi/private-file", "https://example.com/file"];
      await db.insert(eduCourseFileCleanupTable).values(badKeys.map(fileKey => ({ courseId, fileKey, nextAttemptAt: now })));
      const callsBefore = removed.length;
      assert.equal((await processEduCourseFileCleanupBatch(options)).blocked, badKeys.length);
      assert.equal(removed.length, callsBefore);
      assert.ok((await queue()).every(row => row.blocked && row.lastErrorCode === "unsafe_course_file_key"));
      assert.equal((await processEduCourseFileCleanupBatch(options)).blocked, 0);
      assert.ok(errors.some(entry => entry.data.errorCode === "unsafe_course_file_key"));
      assert.deepEqual([...files], [otherKey]);
      assert.equal(isOwnedCourseFile(courseId, materialKey), true);
      assert.equal(isOwnedCourseFile(otherCourseId, materialKey), false);
    });

    await t.test("independent workers skip locked inventory instead of duplicating deletes", async () => {
      await db.insert(eduCourseFileCleanupTable).values({ courseId, fileKey: assignmentKey, nextAttemptAt: now });
      await db.transaction(async tx => {
        await tx.select().from(eduCourseFileCleanupTable).where(and(
          eq(eduCourseFileCleanupTable.courseId, courseId), eq(eduCourseFileCleanupTable.fileKey, assignmentKey),
        )).for("update");
        assert.deepEqual(await processEduCourseFileCleanupBatch(options),
          { deleted: 0, retryScheduled: 0, blocked: 0 });
      });
      assert.equal((await processEduCourseFileCleanupBatch(options)).deleted, 1);
    });
  } finally {
    await db.delete(coursesTable).where(inArray(coursesTable.id, [courseId, otherCourseId]));
    await db.delete(eduCourseFileCleanupTable).where(inArray(eduCourseFileCleanupTable.courseId, [courseId, otherCourseId]));
    await pool.end();
  }
});

test("App Storage deletion ignores 404 including a repeated cleanup after a crash", async () => {
  const oldBucket = objectStorageClient.bucket;
  const oldDir = process.env.PRIVATE_OBJECT_DIR;
  const calls = [];
  process.env.PRIVATE_OBJECT_DIR = "/fixture-bucket/private";
  objectStorageClient.bucket = bucket => ({
    file: object => ({
      delete: async options => { calls.push({ bucket, object, options }); },
    }),
  });
  try {
    const service = new ObjectStorageService();
    const key = `edu-files/${randomUUID()}/assignments/${randomUUID()}`;
    await service.deleteObject(`/objects/${key}`);
    await service.deleteObject(`/objects/${key}`);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { bucket: "fixture-bucket", object: `private/${key}`, options: { ignoreNotFound: true } });
    assert.deepEqual(calls[0], calls[1]);
  } finally {
    objectStorageClient.bucket = oldBucket;
    if (oldDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = oldDir;
  }
});
