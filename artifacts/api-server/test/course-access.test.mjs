import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool, coursesTable, courseMembersTable } from "@workspace/db";
import { accessibleCourseIds, canAccessCourse } from "../src/routes/course-access.ts";

test("only the owner and invited members can access a course", async () => {
  const owner = `test-owner-${randomUUID()}`;
  const member = `test-member-${randomUUID()}`;
  const outsider = `test-outsider-${randomUUID()}`;
  const [course] = await db.insert(coursesTable).values({
    name: "Access test", subject: "TEST", term: "Test", color: "#000000",
    inviteCode: randomUUID(), ownerId: owner,
  }).returning();
  try {
    assert.equal(await canAccessCourse(owner, course.id), true);
    assert.equal(await canAccessCourse(outsider, course.id), false);
    assert.equal((await accessibleCourseIds(outsider)).includes(course.id), false);
    await db.insert(courseMembersTable).values({ courseId: course.id, userId: member });
    assert.equal(await canAccessCourse(member, course.id), true);
    assert.equal(await canAccessCourse(outsider, course.id), false);
  } finally {
    await db.delete(coursesTable).where(eq(coursesTable.id, course.id));
    await pool.end();
  }
});