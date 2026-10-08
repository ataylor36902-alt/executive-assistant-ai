import { Router, type IRouter, type Request, type Response } from "express";
import { absentGradebookStatus } from "../lib/edu-gradebook-status";
import { clerkClient, getAuth } from "@clerk/express";
import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import {
  db, coursesTable, courseMembersTable, eduAssignmentsTable, eduSubmissionsTable,
  classscribeEduLicenseGrantsTable, activeInstitutionCondition, eduDiscussionRepliesTable, eduDiscussionTopicsTable,
} from "@workspace/db";
import { getPrivacyAgeBand, publicAuthorName } from "../lib/privacy-minor";

import { eduGradebookCsv } from "../lib/edu-gradebook-csv";

const router: IRouter = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 10_000;
const MAX_PAGE_SIZE = 100;
const LICENSE_REQUIRED = {
  code: "edu_license_required",
  error: "An approved EDU license agreement is required to manage EDU courses.",
} as const;

type CourseAccess = { id: string; ownerId: string | null; role: "instructor" | "student" };

function invalid(res: Response, error: string) {
  res.status(400).json({ error });
}

function parsePagination(req: Request): { limit: number; offset: number } | undefined {
  const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE ||
    !Number.isInteger(offset) || offset < 0) return undefined;
  return { limit, offset };
}

function parseTextBody(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_BODY_LENGTH
    ? value.trim()
    : undefined;
}

function routeUuid(req: Request, name: string): string | undefined {
  const value = req.params[name];
  return typeof value === "string" && uuidPattern.test(value) ? value : undefined;
}

async function activeSignedLicense(userId: string, at = new Date()): Promise<boolean> {
  const [grant] = await db.select({ signedAgreementRef: classscribeEduLicenseGrantsTable.signedAgreementRef })
    .from(classscribeEduLicenseGrantsTable)
    .where(and(
      eq(classscribeEduLicenseGrantsTable.userId, userId),
      lte(classscribeEduLicenseGrantsTable.approvedAt, at),
      gt(classscribeEduLicenseGrantsTable.expiresAt, at),
      isNull(classscribeEduLicenseGrantsTable.revokedAt),
      activeInstitutionCondition(at),
      sql`length(trim(${classscribeEduLicenseGrantsTable.signedAgreementRef})) > 0`,
    )).limit(1);
  return Boolean(grant);
}

async function courseAccess(userId: string | undefined, rawCourseId: string): Promise<CourseAccess | undefined> {
  if (!userId || !uuidPattern.test(rawCourseId)) return undefined;
  const [course] = await db.select({
    id: coursesTable.id,
    ownerId: coursesTable.ownerId,
    memberId: courseMembersTable.userId,
  }).from(coursesTable).leftJoin(courseMembersTable, and(
    eq(courseMembersTable.courseId, coursesTable.id),
    eq(courseMembersTable.userId, userId),
  )).where(and(
    eq(coursesTable.id, rawCourseId),
    eq(coursesTable.eduEnabled, true),
    or(eq(coursesTable.ownerId, userId), eq(courseMembersTable.userId, userId)),
  )).limit(1);
  if (!course) return undefined;
  const owner = course.ownerId === userId;
  return { id: course.id, ownerId: course.ownerId, role: owner ? "instructor" : "student" };
}

async function checkedCourse(req: Request, res: Response): Promise<CourseAccess | undefined> {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return undefined;
  }
  const courseId = routeUuid(req, "id");
  if (!courseId) {
    res.status(404).json({ error: "EDU course not found" });
    return undefined;
  }
  try {
    const course = await courseAccess(userId, courseId);
    if (!course) {
      res.status(404).json({ error: "EDU course not found" });
      return undefined;
    }
    if (!course.ownerId) {
      res.status(404).json({ error: "EDU course not found" });
      return undefined;
    }
    const licensed = await activeSignedLicense(course.ownerId);
    if (!licensed && course.role === "instructor") {
      res.status(403).json(LICENSE_REQUIRED);
      return undefined;
    }
    if (!licensed) {
      res.status(404).json({ error: "EDU course not found" });
      return undefined;
    }
    return course;
  } catch (error) {
    req.log.error({ err: error }, "EDU learning access verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
    return undefined;
  }
}

async function verifiedNames(req: Request, userIds: string[]) {
  const unique = [...new Set(userIds)];
  const names = await Promise.all(unique.map(async userId => {
    try {
      const user = await clerkClient.users.getUser(userId);
      const firstLast = [user.firstName, user.lastName].filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
      return [userId, user.fullName?.trim() || firstLast || user.username?.trim() || userId] as const;
    } catch (error) {
      req.log.warn({ err: error }, "Could not resolve EDU student display name");
      return [userId, userId] as const;
    }
  }));
  return new Map(names);
}

async function verifiedDiscussionNames(req: Request, userIds: string[]) {
  const unique = [...new Set(userIds)];
  const names = await Promise.all(unique.map(async userId => {
    const ageBand = await getPrivacyAgeBand(userId);
    try {
      const user = await clerkClient.users.getUser(userId);
      const fullName = [user.firstName, user.lastName]
        .filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
      const name = user.fullName?.trim() || fullName || user.username?.trim() || userId;
      return [userId, name === userId ? userId : publicAuthorName(ageBand, name)] as const;
    } catch (error) {
      req.log.warn({ err: error }, "Could not resolve EDU discussion author name");
      return [userId, userId] as const;
    }
  }));
  return new Map(names);
}

router.get(["/edu/courses/:id/gradebook", "/edu/courses/:id/gradebook/export"], async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const exporting = req.path.endsWith("/gradebook/export");
    if (exporting && course.role !== "instructor") {
      res.status(403).json({ error: "Only the course instructor can export grades" });
      return;
    }
    const assignments = await db.select({
      id: eduAssignmentsTable.id,
      title: eduAssignmentsTable.title,
      points: eduAssignmentsTable.points,
      dueAt: eduAssignmentsTable.dueAt,
      createdAt: eduAssignmentsTable.createdAt,
    }).from(eduAssignmentsTable).where(eq(eduAssignmentsTable.courseId, course.id))
      .orderBy(asc(eduAssignmentsTable.createdAt));
    const roster = course.role === "instructor"
      ? await db.select({ studentId: courseMembersTable.userId }).from(courseMembersTable)
        .where(and(eq(courseMembersTable.courseId, course.id), sql`${courseMembersTable.userId} <> ${course.ownerId}`))
        .orderBy(asc(courseMembersTable.userId))
      : [{ studentId: getAuth(req).userId! }];
    const submissions = assignments.length && roster.length
      ? await db.select({
        assignmentId: eduSubmissionsTable.assignmentId,
        studentId: eduSubmissionsTable.studentId,
        score: eduSubmissionsTable.score,
        feedback: eduSubmissionsTable.feedback,
        submittedAt: eduSubmissionsTable.submittedAt,
      }).from(eduSubmissionsTable).innerJoin(eduAssignmentsTable, eq(eduAssignmentsTable.id, eduSubmissionsTable.assignmentId))
        .where(and(
          eq(eduAssignmentsTable.courseId, course.id),
          sql`${eduSubmissionsTable.studentId} in (${sql.join(roster.map(row => sql`${row.studentId}`), sql`, `)})`,
        ))
      : [];
    const submissionMap = new Map(submissions.map(row => [`${row.studentId}:${row.assignmentId}`, row]));
    const names = course.role === "instructor"
      ? await verifiedNames(req, roster.map(row => row.studentId))
      : new Map<string, string>();
    const now = Date.now();
    const students = roster.map(({ studentId }) => {
      let gradedEarned = 0;
      let gradedPossible = 0;
      let gradedCount = 0;
      let ungradedCount = 0;
      let missingCount = 0;
      let notSubmittedCount = 0;
      let noDeadlineCount = 0;
      const grades = assignments.map(assignment => {
        const submission = submissionMap.get(`${studentId}:${assignment.id}`);
        if (!submission) {
          const status = absentGradebookStatus(assignment.dueAt, now);
          if (status === "missing") missingCount += 1;
          else if (status === "not_submitted") notSubmittedCount += 1;
          else noDeadlineCount += 1;
          return { assignmentId: assignment.id, status, score: null, feedback: null, submittedAt: null };
        }
        if (submission.score === null) {
          ungradedCount += 1;
          return { assignmentId: assignment.id, status: "ungraded" as const, score: null, feedback: submission.feedback, submittedAt: submission.submittedAt };
        }
        gradedCount += 1;
        gradedEarned += submission.score;
        gradedPossible += assignment.points;
        return { assignmentId: assignment.id, status: "graded" as const, score: submission.score, feedback: submission.feedback, submittedAt: submission.submittedAt };
      });
      return {
        studentId,
        name: course.role === "instructor" ? (names.get(studentId) ?? studentId) : studentId,
        grades,
        totals: { earned: gradedEarned, possible: gradedPossible, gradedCount, ungradedCount, missingCount, notSubmittedCount, noDeadlineCount },
      };
    });
    const book = {
      assignments,
      students,
      totals: { assignmentCount: assignments.length, studentCount: students.length },
    };
    if (exporting) {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="gradebook-${course.id}.csv"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(eduGradebookCsv(book));
    } else {
      res.json(book);
    }
  } catch (error) {
    req.log.error({ err: error }, "EDU gradebook read failed");
    res.status(500).json({ error: "Could not load EDU gradebook" });
  }
});

router.get("/edu/courses/:id/discussions", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const page = parsePagination(req);
    if (!page) { invalid(res, "limit must be 1–100 and offset must be a non-negative integer"); return; }
    const topics = await db.select().from(eduDiscussionTopicsTable)
      .where(eq(eduDiscussionTopicsTable.courseId, course.id))
      .orderBy(desc(eduDiscussionTopicsTable.createdAt), desc(eduDiscussionTopicsTable.id))
      .limit(page.limit).offset(page.offset);
    const names = await verifiedDiscussionNames(req, topics.map(topic => topic.creatorId));
    res.json({ topics: topics.map(topic => ({ ...topic, creatorName: names.get(topic.creatorId) ?? topic.creatorId })), pagination: page });
  } catch (error) {
    req.log.error({ err: error }, "EDU discussions read failed");
    res.status(500).json({ error: "Could not load EDU discussions" });
  }
});

router.post("/edu/courses/:id/discussions", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const body = parseTextBody(req.body?.body);
    if (!title || title.length > MAX_TITLE_LENGTH || !body) {
      invalid(res, `title is required (max ${MAX_TITLE_LENGTH} characters) and body must be 1–${MAX_BODY_LENGTH} characters`);
      return;
    }
    const [topic] = await db.insert(eduDiscussionTopicsTable).values({
      courseId: course.id, creatorId: getAuth(req).userId!, title, body,
    }).returning();
    const names = await verifiedDiscussionNames(req, [topic.creatorId]);
    res.status(201).json({ topic: { ...topic, creatorName: names.get(topic.creatorId) ?? topic.creatorId } });
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion topic creation failed");
    res.status(500).json({ error: "Could not create discussion topic" });
  }
});

router.get("/edu/courses/:id/discussions/:topicId/replies", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const topicId = routeUuid(req, "topicId");
    if (!topicId) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    const page = parsePagination(req);
    if (!page) { invalid(res, "limit must be 1–100 and offset must be a non-negative integer"); return; }
    const [topic] = await db.select({ id: eduDiscussionTopicsTable.id }).from(eduDiscussionTopicsTable).where(and(
      eq(eduDiscussionTopicsTable.id, topicId),
      eq(eduDiscussionTopicsTable.courseId, course.id),
    )).limit(1);
    if (!topic) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    const replies = await db.select().from(eduDiscussionRepliesTable)
      .where(eq(eduDiscussionRepliesTable.topicId, topic.id))
      .orderBy(asc(eduDiscussionRepliesTable.createdAt), asc(eduDiscussionRepliesTable.id))
      .limit(page.limit).offset(page.offset);
    const names = await verifiedDiscussionNames(req, replies.map(reply => reply.creatorId));
    res.json({ replies: replies.map(reply => ({ ...reply, creatorName: names.get(reply.creatorId) ?? reply.creatorId })), pagination: page });
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion replies read failed");
    res.status(500).json({ error: "Could not load discussion replies" });
  }
});

router.post("/edu/courses/:id/discussions/:topicId/replies", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const topicId = routeUuid(req, "topicId");
    if (!topicId) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    const [topic] = await db.select().from(eduDiscussionTopicsTable).where(and(
      eq(eduDiscussionTopicsTable.id, topicId),
      eq(eduDiscussionTopicsTable.courseId, course.id),
    )).limit(1);
    if (!topic) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    if (topic.lockedAt) { res.status(409).json({ error: "Discussion topic is locked" }); return; }
    const body = parseTextBody(req.body?.body);
    if (!body) { invalid(res, `body must be 1–${MAX_BODY_LENGTH} characters`); return; }
    const [reply] = await db.insert(eduDiscussionRepliesTable).values({
      topicId: topic.id, creatorId: getAuth(req).userId!, body,
    }).returning();
    const names = await verifiedDiscussionNames(req, [reply.creatorId]);
    res.status(201).json({ reply: { ...reply, creatorName: names.get(reply.creatorId) ?? reply.creatorId } });
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion reply creation failed");
    res.status(500).json({ error: "Could not create discussion reply" });
  }
});

router.patch("/edu/courses/:id/discussions/:topicId", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const topicId = routeUuid(req, "topicId");
    if (!topicId) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    const userId = getAuth(req).userId!;
    const [topic] = await db.select().from(eduDiscussionTopicsTable).where(and(
      eq(eduDiscussionTopicsTable.id, topicId),
      eq(eduDiscussionTopicsTable.courseId, course.id),
    )).limit(1);
    if (!topic) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    if (course.role !== "instructor" && topic.creatorId !== userId) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    const patch: { title?: string; body?: string; lockedAt?: Date | null; updatedAt: Date } = { updatedAt: new Date() };
    if (Object.hasOwn(req.body ?? {}, "title")) {
      const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
      if (!title || title.length > MAX_TITLE_LENGTH) { invalid(res, `title must be 1–${MAX_TITLE_LENGTH} characters`); return; }
      patch.title = title;
    }
    if (Object.hasOwn(req.body ?? {}, "body")) {
      const body = parseTextBody(req.body.body);
      if (!body) { invalid(res, `body must be 1–${MAX_BODY_LENGTH} characters`); return; }
      patch.body = body;
    }
    if (Object.hasOwn(req.body ?? {}, "locked")) {
      if (course.role !== "instructor" || typeof req.body.locked !== "boolean") {
        res.status(403).json({ error: "Only the course instructor can lock or unlock a topic" }); return;
      }
      patch.lockedAt = req.body.locked ? topic.lockedAt ?? new Date() : null;
    }
    if (Object.keys(patch).length === 1) { invalid(res, "At least one valid topic field is required"); return; }
    const [updated] = await db.update(eduDiscussionTopicsTable).set(patch).where(and(
      eq(eduDiscussionTopicsTable.id, topic.id), eq(eduDiscussionTopicsTable.courseId, course.id),
    )).returning();
    res.json({ topic: updated });
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion topic update failed");
    res.status(500).json({ error: "Could not update discussion topic" });
  }
});

router.delete("/edu/courses/:id/discussions/:topicId", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const topicId = routeUuid(req, "topicId");
    if (!topicId) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    const userId = getAuth(req).userId!;
    const [deleted] = await db.delete(eduDiscussionTopicsTable).where(and(
      eq(eduDiscussionTopicsTable.id, topicId),
      eq(eduDiscussionTopicsTable.courseId, course.id),
      ...(course.role === "instructor" ? [] : [eq(eduDiscussionTopicsTable.creatorId, userId)]),
    )).returning({ id: eduDiscussionTopicsTable.id });
    if (!deleted) { res.status(404).json({ error: "Discussion topic not found" }); return; }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion topic deletion failed");
    res.status(500).json({ error: "Could not delete discussion topic" });
  }
});

router.patch("/edu/courses/:id/discussions/:topicId/replies/:replyId", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const topicId = routeUuid(req, "topicId");
    const replyId = routeUuid(req, "replyId");
    if (!topicId || !replyId) { res.status(404).json({ error: "Discussion reply not found" }); return; }
    const [reply] = await db.select({ id: eduDiscussionRepliesTable.id, creatorId: eduDiscussionRepliesTable.creatorId })
      .from(eduDiscussionRepliesTable).innerJoin(eduDiscussionTopicsTable, eq(eduDiscussionTopicsTable.id, eduDiscussionRepliesTable.topicId))
      .where(and(
        eq(eduDiscussionRepliesTable.id, replyId),
        eq(eduDiscussionRepliesTable.topicId, topicId),
        eq(eduDiscussionTopicsTable.courseId, course.id),
      )).limit(1);
    if (!reply || (course.role !== "instructor" && reply.creatorId !== getAuth(req).userId)) { res.status(404).json({ error: "Discussion reply not found" }); return; }
    const body = parseTextBody(req.body?.body);
    if (!body) { invalid(res, `body must be 1–${MAX_BODY_LENGTH} characters`); return; }
    const [updated] = await db.update(eduDiscussionRepliesTable).set({ body, updatedAt: new Date() })
      .where(and(eq(eduDiscussionRepliesTable.id, reply.id), eq(eduDiscussionRepliesTable.topicId, topicId))).returning();
    res.json({ reply: updated });
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion reply update failed");
    res.status(500).json({ error: "Could not update discussion reply" });
  }
});

router.delete("/edu/courses/:id/discussions/:topicId/replies/:replyId", async (req, res): Promise<void> => {
  try {
    const course = await checkedCourse(req, res);
    if (!course) return;
    const topicId = routeUuid(req, "topicId");
    const replyId = routeUuid(req, "replyId");
    if (!topicId || !replyId) { res.status(404).json({ error: "Discussion reply not found" }); return; }
    const [deleted] = await db.delete(eduDiscussionRepliesTable).where(and(
      eq(eduDiscussionRepliesTable.id, replyId),
      eq(eduDiscussionRepliesTable.topicId, topicId),
      ...(course.role === "instructor" ? [] : [eq(eduDiscussionRepliesTable.creatorId, getAuth(req).userId!)]),
      sql`exists (select 1 from ${eduDiscussionTopicsTable} where ${eduDiscussionTopicsTable.id} = ${eduDiscussionRepliesTable.topicId} and ${eduDiscussionTopicsTable.courseId} = ${course.id})`,
    )).returning({ id: eduDiscussionRepliesTable.id });
    if (!deleted) { res.status(404).json({ error: "Discussion reply not found" }); return; }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error }, "EDU discussion reply deletion failed");
    res.status(500).json({ error: "Could not delete discussion reply" });
  }
});

export default router;