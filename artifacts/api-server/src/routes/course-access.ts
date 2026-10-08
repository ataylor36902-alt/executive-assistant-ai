import { and, eq, or } from "drizzle-orm";
import { courseMembersTable, coursesTable, db } from "@workspace/db";

export async function accessibleCourseIds(userId: string) {
  const rows = await db.select({ id: coursesTable.id }).from(coursesTable)
    .leftJoin(courseMembersTable, and(
      eq(courseMembersTable.courseId, coursesTable.id),
      eq(courseMembersTable.userId, userId),
    ))
    .where(and(
      eq(coursesTable.eduEnabled, false),
      or(eq(coursesTable.ownerId, userId), eq(courseMembersTable.userId, userId)),
    ));
  return rows.map(row => row.id);
}

export async function canAccessCourse(userId: string, courseId: string) {
  const rows = await db.select({ id: coursesTable.id }).from(coursesTable)
    .leftJoin(courseMembersTable, and(
      eq(courseMembersTable.courseId, coursesTable.id),
      eq(courseMembersTable.userId, userId),
    ))
    .where(and(eq(coursesTable.id, courseId), eq(coursesTable.eduEnabled, false),
      or(eq(coursesTable.ownerId, userId), eq(courseMembersTable.userId, userId))))
    .limit(1);
  return rows.length > 0;
}
