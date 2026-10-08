import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import {
  bookmarksTable, classscribeConsentsTable, classscribeCreditActionsTable,
  classscribeCreditProviderIntentsTable, classscribeCreditSubscriptionPeriodsTable,
  classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable, classscribePrivacyDeletionOutboxTable,
  classscribePrivacyExportsTable, classscribePrivacyProfilesTable, classscribePrivacyRetentionWarningsTable,
  classscribePrivacyTombstonesTable, classscribePrivacyLibraryAliasesTable,
  classscribeEduClientLicensesTable, classscribeEduClientSessionsTable, classscribeEduInstitutionAgreementsTable,
  classscribeEduInstructorAuditTable, classscribeEduLicenseGrantsTable,
  academicDatesTable, courseCommentsTable, courseGradebooksTable, courseMembersTable, coursesTable, db, eduAnnouncementsTable, eduAssignmentsTable, eduSubmissionsTable,
  eduDiscussionRepliesTable, eduDiscussionTopicsTable, eduGroupMembersTable, eduLecturesTable,
  eduMaterialsTable, eduCourseFileCleanupTable, ensureEduCourseFileCleanup, pool,
  eduSourcesTable, gradeScalesTable, lecturesTable, notesTable, practiceAttemptsTable,
  studyGuidesTable, studyPlanImportsTable, studyPlansTable, syllabusAssignmentsTable,
  syllabusAssignmentCompletionsTable,
} from "@workspace/db";
import { privacyConsentConfig, privacyRetentionConfig } from "../lib/privacy-config";
import {
  lockPrivacyLibraryDeletion, requirePrivacyLibrary,
} from "../lib/privacy-access";
import { getLinkedLibraryCode } from "../lib/modern-library-link";
import { createPrivateZip, toCsv } from "../lib/privacy-archive";
import { freeBillingIdentityForOwner, getLibraryBillingStatus, getRevenueCatAppUserId } from "../lib/privacy-billing";
import { isRecord } from "../lib/classscribe-legacy-access";
import { processPrivacyDeletionOutboxItem } from "../lib/privacy-deletion";
import { ObjectStorageService } from "../lib/objectStorage";

const router = Router();
const objectStorage = new ObjectStorageService();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
function legacyTimestamp(value: unknown): string {
  if (typeof value !== "number" && typeof value !== "string") return "";
  const timestamp = typeof value === "number" && value > 0 && value < 100_000_000_000
    ? value * 1000 : value;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}
function normalizeObjectKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  let key = value.trim();
  if (/^https?:\/\//i.test(key)) {
    try {
      const url = new URL(key);
      const marker = url.pathname.indexOf("/objects/");
      if (marker < 0) return undefined;
      key = url.pathname.slice(marker + "/objects/".length);
    } catch { return undefined; }
  } else if (key.startsWith("/objects/")) {
    key = key.slice("/objects/".length);
  } else if (key.startsWith("objects/")) {
    key = key.slice("objects/".length);
  }
  if (!/^[A-Za-z0-9_./-]{1,512}$/.test(key) || key.split("/").some(part => !part || part === "." || part === "..")) {
    return undefined;
  }
  return key;
}

function referencedObjectKeys(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) referencedObjectKeys(item, output);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, item] of Object.entries(value)) {
    const isObjectKeyField = /(?:objectkey|objectpath|filekey|filepath|audioobject|audiopath|syllabusobject|syllabuspath|storagepath|uploadkey|uploadpath|attachmentkey|attachmentpath)$/i.test(name) ||
      /^(?:(?:profile)?photo|avatar)$/i.test(name);
    if (typeof item === "string" && (isObjectKeyField || item.includes("/objects/"))) {
      if (!item.trim()) continue;
      if (/^(?:(?:profile)?photo|avatar)$/i.test(name) && /^https?:\/\//i.test(item) && !item.includes("/objects/")) continue;
      const key = normalizeObjectKey(item);
      if (!key) throw new Error("A private object path could not be normalized for deletion.");
      output.add(key);
    } else if (Array.isArray(item) || isRecord(item)) {
      referencedObjectKeys(item, output);
    }
  }
}
function addStorageKey(output: Set<string>, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  const key = normalizeObjectKey(value);
  if (!key) throw new Error("A private object path could not be normalized for deletion.");
  output.add(key);
}
const noStore = (_req: Request, res: Response, next: () => void) => {
  res.set("Cache-Control", "private, no-store");
  next();
};
router.use(noStore);

function recentFirstFactor(req: Request): boolean {
  const claims = getAuth(req) as unknown as { sessionClaims?: Record<string, unknown> };
  const fva = claims.sessionClaims?.fva;
  const firstFactorAge = Array.isArray(fva) ? fva[0] : fva;
  return typeof firstFactorAge === "number" && Number.isFinite(firstFactorAge) &&
    firstFactorAge >= 0 && firstFactorAge <= 10;
}

function bodyRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

router.get("/privacy/config", (_req, res) => {
  res.json({ retention: privacyRetentionConfig, consent: privacyConsentConfig });
});

router.get("/privacy/status", async (req, res): Promise<void> => {
  try {
    const library = await requirePrivacyLibrary(req);
    const [profile] = library.userId ? await db.select({ ageBand: classscribePrivacyProfilesTable.ageBand })
      .from(classscribePrivacyProfilesTable).where(eq(classscribePrivacyProfilesTable.userId, library.userId)).limit(1) : [];
    const [latestExport] = await db.select({ createdAt: classscribePrivacyExportsTable.createdAt })
      .from(classscribePrivacyExportsTable)
      .where(eq(classscribePrivacyExportsTable.libraryHash, library.libraryHash))
      .orderBy(sql`${classscribePrivacyExportsTable.createdAt} desc`).limit(1);
    const billing = await getLibraryBillingStatus(library.libraryCode);
    res.json({
      ageBand: profile?.ageBand ?? null,
      activeSubscription: (billing.plan === "student" || billing.plan === "pro") &&
        ["active", "trialing", "past_due"].includes(billing.status),
      provider: billing.billingSource,
      reauthenticationRequired: Boolean(library.userId) && !recentFirstFactor(req),
      exportNextAllowedAt: latestExport
        ? new Date(latestExport.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : null,
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 503;
    req.log?.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Privacy status lookup failed");
    res.status(status >= 400 && status < 600 ? status : 503).json({
      error: error instanceof Error ? error.message : "Privacy status is temporarily unavailable.",
    });
  }
});

router.post("/privacy/age", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!bodyRecord(req.body) || Object.keys(req.body).length !== 1 ||
      (req.body.ageBand !== "13-17" && req.body.ageBand !== "18+")) {
    res.status(400).json({ error: 'ageBand must be exactly "13-17" or "18+".' }); return;
  }
  try {
    await requirePrivacyLibrary(req);
    const defaults = req.body.ageBand === "13-17"
      ? { sharing: "off" as const, publicProfiles: "off" as const, schoolLevel: "HighSchool" as const, discussionName: "firstName" as const }
      : {};
    await db.insert(classscribePrivacyProfilesTable).values({
      userId: auth.userId, ageBand: req.body.ageBand, defaults,
    }).onConflictDoUpdate({
      target: classscribePrivacyProfilesTable.userId,
      set: { ageBand: req.body.ageBand, defaults, updatedAt: new Date() },
    });
    res.json({ ageBand: req.body.ageBand });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 503;
    res.status(status >= 400 && status < 600 ? status : 503).json({ error: error instanceof Error ? error.message : "Could not save age band." });
  }
});

async function buildExport(library: Awaited<ReturnType<typeof requirePrivacyLibrary>>): Promise<Buffer> {
  const userId = library.userId;
  const ownedCourses = await db.select().from(coursesTable).where(eq(coursesTable.ownerId, userId));
  const membershipRows = await db.select({ courseId: courseMembersTable.courseId })
    .from(courseMembersTable).where(eq(courseMembersTable.userId, userId));
  const courseIds = [...new Set([...ownedCourses.map(row => row.id), ...membershipRows.map(row => row.courseId)])];
  const courses = courseIds.length ? await db.select().from(coursesTable).where(inArray(coursesTable.id, courseIds)) : [];
  const lectures = await db.select().from(lecturesTable).where(eq(lecturesTable.createdBy, userId));
  const eduLectures = await db.select().from(eduLecturesTable).where(eq(eduLecturesTable.createdBy, userId));
  const eduSources = await db.select().from(eduSourcesTable).where(eq(eduSourcesTable.createdBy, userId));
  const notes = await db.select().from(notesTable).where(eq(notesTable.userId, userId));
  const bookmarks = await db.select().from(bookmarksTable).where(eq(bookmarksTable.userId, userId));
  const practiceAttempts = await db.select().from(practiceAttemptsTable).where(eq(practiceAttemptsTable.userId, userId));
  const gradeScales = await db.select().from(gradeScalesTable).where(eq(gradeScalesTable.userId, userId));
  const studyPlans = await db.select().from(studyPlansTable).where(eq(studyPlansTable.userId, userId));
  const studyPlanImports = await db.select().from(studyPlanImportsTable).where(eq(studyPlanImportsTable.userId, userId));
  const syllabusCompletions = await db.select().from(syllabusAssignmentCompletionsTable)
    .where(eq(syllabusAssignmentCompletionsTable.userId, userId));
  const courseComments = await db.select().from(courseCommentsTable)
    .where(eq(courseCommentsTable.authorId, userId));
  const discussionTopics = await db.select().from(eduDiscussionTopicsTable)
    .where(eq(eduDiscussionTopicsTable.creatorId, userId));
  const discussionReplies = await db.select().from(eduDiscussionRepliesTable)
    .where(eq(eduDiscussionRepliesTable.creatorId, userId));
  const eduGroupMemberships = await db.select().from(eduGroupMembersTable)
    .where(eq(eduGroupMembersTable.userId, userId));
  const assignments = courseIds.length ? await db.select().from(syllabusAssignmentsTable).where(inArray(syllabusAssignmentsTable.courseId, courseIds)) : [];
  const academicDates = courseIds.length ? await db.select().from(academicDatesTable)
    .where(inArray(academicDatesTable.courseId, courseIds)) : [];
  const ownedCourseIds = ownedCourses.map(row => row.id);
  const eduAssignments = ownedCourseIds.length ? await db.select().from(eduAssignmentsTable).where(inArray(eduAssignmentsTable.courseId, ownedCourseIds)) : [];
  const eduMaterials = ownedCourseIds.length ? await db.select().from(eduMaterialsTable).where(inArray(eduMaterialsTable.courseId, ownedCourseIds)) : [];
  const eduAnnouncements = ownedCourseIds.length ? await db.select().from(eduAnnouncementsTable).where(inArray(eduAnnouncementsTable.courseId, ownedCourseIds)) : [];
  const grades = courseIds.length ? await db.select().from(courseGradebooksTable).where(and(
    inArray(courseGradebooksTable.courseId, courseIds), eq(courseGradebooksTable.userId, userId),
  )) : [];
  const eduSubmissions = await db.select().from(eduSubmissionsTable)
    .where(eq(eduSubmissionsTable.studentId, userId));
  const guides = courseIds.length ? await db.select().from(studyGuidesTable).where(and(
    inArray(studyGuidesTable.courseId, courseIds), eq(studyGuidesTable.userId, userId),
  )) : [];
  const transactions = await db.select().from(classscribeCreditTransactionsTable)
    .where(eq(classscribeCreditTransactionsTable.libraryHash, library.libraryHash));
  const consents = await db.select().from(classscribeConsentsTable)
    .where(eq(classscribeConsentsTable.libraryHash, library.libraryHash));
  const legacyRows = await db.select({ path: classscribeLegacyDocumentsTable.path, data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(or(
      like(classscribeLegacyDocumentsTable.path, `data/users/${escapeLike(library.libraryCode)}/%`),
      eq(classscribeLegacyDocumentsTable.path, `private/ai-consents/${library.libraryHash}`),
    ));
  const legacyCollection = (name: string): Array<Record<string, unknown> & { id: string }> => {
    const prefix = `data/users/${library.libraryCode}/lib/${name}/`;
    return legacyRows.flatMap(row => {
      if (!row.path.startsWith(prefix)) return [];
      const id = row.path.slice(prefix.length);
      return id && !id.includes("/") && isRecord(row.data) ? [{ ...row.data, id }] : [];
    });
  };
  const legacyCourses = legacyCollection("courses");
  const legacyLectures = legacyCollection("lectures");
  const legacyNotes = legacyCollection("notes");
  const legacyAssignments = legacyCollection("assignments");
  const legacyGradebooks = legacyCollection("gradebooks");
  const legacyStats = legacyCollection("stats");
  const legacyGuides = legacyCourses.flatMap(course => {
    if (!isRecord(course.guides)) return [];
    return Object.entries(course.guides).flatMap(([id, guide]) => isRecord(guide) && typeof guide.text === "string"
      ? [{
        id, courseId: course.id, content: guide.text, sources: [],
        createdAt: legacyTimestamp(guide.at), legacy: true,
      }]
      : []);
  });
  const legacyShared = await db.select({ path: classscribeLegacyDocumentsTable.path, data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(or(like(classscribeLegacyDocumentsTable.path, "posts/%"), like(classscribeLegacyDocumentsTable.path, "shared/%"),
      like(classscribeLegacyDocumentsTable.path, "notebooks/%")));
  const [profile] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, `data/users/${library.libraryCode}/profile`)).limit(1);
  const [privacyProfile] = await db.select({ ageBand: classscribePrivacyProfilesTable.ageBand })
    .from(classscribePrivacyProfilesTable).where(eq(classscribePrivacyProfilesTable.userId, userId)).limit(1);
  const files: Record<string, string | Buffer> = {
    "profile.json": JSON.stringify({ accountId: userId, ageBand: privacyProfile?.ageBand ?? null,
      legacyProfile: profile?.data ?? null }, null, 2),
    "courses.json": JSON.stringify([
      ...courses.map(course => ({
        id: course.id, name: course.name, subject: course.subject, term: course.term,
        color: course.color, classTimes: course.meetings,
        syllabusText: course.ownerId === userId ? course.syllabusParsedText : null,
        syllabusGradeWeights: course.ownerId === userId ? course.syllabusGradeWeights : null,
      })),
      ...legacyCourses.map(course => ({
        id: course.id, name: course.name, subject: course.code ?? null, term: course.semester ?? null,
        color: course.color ?? null, classTimes: null, syllabusText: null, syllabusGradeWeights: null,
        legacyCourse: course,
      })),
    ], null, 2),
    "lectures.md": [
      ...lectures.map(lecture => [
      `# ${lecture.title}`,
      "",
      `- Course: ${lecture.courseId}`,
      `- Professor: ${lecture.professor}`,
      `- Lecture timestamp: ${lecture.lectureDate.toISOString()}`,
      `- Created timestamp: ${lecture.createdAt.toISOString()}`,
      `- Analyzed timestamp: ${lecture.analyzedAt?.toISOString() ?? ""}`,
      `- Duration seconds: ${lecture.durationSeconds ?? ""}`,
      "",
      "## Summary",
      "",
      lecture.summary ?? "",
      "",
      "## Key points",
      "",
      ...(lecture.keyPoints ?? []).map(point => `- ${point}`),
      "",
      "## Definitions",
      "",
      ...(lecture.definitions ?? []).map(item => `- ${item}`),
      "",
      "## Study questions",
      "",
      ...(lecture.studyQuestions ?? []).map(question => `- ${question}`),
      "",
      "## Quiz questions",
      "",
      JSON.stringify(lecture.quizQuestions ?? [], null, 2),
      "",
      "## Transcript",
      "",
      lecture.transcript ?? "",
      "",
      "## Lecture notes",
      "",
      lecture.notes ?? "",
      "",
      ].join("\n")),
      ...legacyLectures.map(lecture => {
        const analysis = isRecord(lecture.analysis) ? lecture.analysis : {};
        const speakers = isRecord(lecture.speakers) ? lecture.speakers : {};
        const terms = Array.isArray(analysis.terms) ? analysis.terms : [];
        const definitions = Array.isArray(analysis.definitions) ? analysis.definitions : [];
        const keyPoints = Array.isArray(analysis.keyPoints) ? analysis.keyPoints : [];
        const questions = Array.isArray(analysis.studentQuestions) ? analysis.studentQuestions : [];
        const assignmentsMentioned = Array.isArray(analysis.assignments) ? analysis.assignments : [];
        const segments = Array.isArray(lecture.segs) ? lecture.segs : [];
        const professor = typeof speakers.P === "string" ? speakers.P : "";
        return [
          `# ${typeof lecture.title === "string" ? lecture.title : "Untitled legacy lecture"}`,
          "",
          `- Lecture ID: ${lecture.id}`,
          `- Course: ${typeof lecture.courseId === "string" ? lecture.courseId : ""}`,
          `- Professor: ${professor}`,
          `- Lecture timestamp: ${typeof lecture.date === "string" ? lecture.date : ""}`,
          `- Created timestamp: ${legacyTimestamp(lecture.created)}`,
          `- Duration seconds: ${typeof lecture.duration === "number" ? lecture.duration : ""}`,
          `- Reviewed: ${typeof lecture.reviewed === "boolean" ? lecture.reviewed : ""}`,
          "",
          "## Summary",
          "",
          typeof analysis.summary === "string" ? analysis.summary : "",
          "",
          "## Key points",
          "",
          ...keyPoints.map(point => `- ${typeof point === "string" ? point : JSON.stringify(point)}`),
          "",
          "## Definitions",
          "",
          ...terms.map(term => isRecord(term) ? `- ${String(term.term ?? "")}: ${String(term.def ?? "")}` : `- ${String(term)}`),
          ...definitions.map(definition => `- ${typeof definition === "string" ? definition : JSON.stringify(definition)}`),
          "",
          "## Study questions",
          "",
          ...questions.map(question => `- ${isRecord(question) ? String(question.q ?? "") : String(question)}`),
          "",
          "## Assignments mentioned",
          "",
          ...assignmentsMentioned.map(assignment => `- ${isRecord(assignment) ? String(assignment.title ?? "") : String(assignment)}`),
          "",
          "## Transcript",
          "",
          ...segments.map(segment => isRecord(segment)
            ? `[${typeof segment.t === "number" ? segment.t : ""}s] ${typeof segment.x === "string" ? segment.x : ""}`
            : String(segment)),
          "",
          "## Lecture notes",
          "",
          typeof analysis.notes === "string" ? analysis.notes : typeof lecture.myNotes === "string" ? lecture.myNotes : "",
          "",
        ].join("\n");
      }),
    ].join("\n---\n\n"),
    "edu-lectures.md": eduLectures.map(lecture => [
      `# ${lecture.title}`,
      "",
      `- Course: ${lecture.courseId}`,
      `- Professor: ${lecture.professor}`,
      `- Lecture timestamp: ${lecture.lectureDate.toISOString()}`,
      `- Created timestamp: ${lecture.createdAt.toISOString()}`,
      `- Duration seconds: ${lecture.durationSeconds ?? ""}`,
      `- Transcription status: ${lecture.transcriptionStatus}`,
      "",
      "## Transcript",
      "",
      lecture.transcript ?? "",
      "",
    ].join("\n")).join("\n---\n\n"),
    "notes.md": [
      ...notes.map(note => `# ${note.title}\n\n${note.markdownBody}\n`),
      ...legacyNotes.map(note => [
        `# ${typeof note.title === "string" ? note.title : "Untitled legacy note"}`,
        "",
        `- Note ID: ${note.id}`,
        `- Course: ${typeof note.courseId === "string" ? note.courseId : ""}`,
        `- Lecture: ${typeof note.lectureId === "string" ? note.lectureId : ""}`,
        `- Created timestamp: ${legacyTimestamp(note.created)}`,
        `- Updated timestamp: ${legacyTimestamp(note.updated)}`,
        "",
        typeof note.body === "string" ? note.body : "",
        "",
      ].join("\n")),
    ].join("\n---\n\n"),
    "personal-study.json": JSON.stringify({
      bookmarks, practiceAttempts, gradeScales, studyPlans, studyPlanImports, syllabusCompletions,
      legacyGradebooks, legacyStats,
    }, null, 2),
    "discussions.json": JSON.stringify({
      courseComments, discussionTopics, discussionReplies, eduGroupMemberships,
    }, null, 2),
    "edu-sources.json": JSON.stringify(eduSources.map(source => ({
      id: source.id, courseId: source.courseId, kind: source.kind, visibility: source.visibility,
      title: source.title, description: source.description, url: source.url,
      filename: source.filename, mimeType: source.mimeType, sizeBytes: source.sizeBytes, createdAt: source.createdAt,
    })), null, 2),
    "edu-course-content.json": JSON.stringify({
      announcements: eduAnnouncements,
      materials: eduMaterials.map(({ fileKey: _fileKey, ...material }) => material),
      assignments: eduAssignments.map(({ fileKey: _fileKey, ...assignment }) => assignment),
      syllabusAssignments: assignments,
    }, null, 2),
    "legacy-data.json": JSON.stringify({
      documents: legacyRows.map(row => ({ path: row.path, data: row.data })),
      sharedPosts: legacyShared.filter(row => (row.path.startsWith("posts/") || row.path.startsWith("shared/")) &&
        isRecord(row.data) && row.data.by === library.libraryCode)
        .map(row => ({ path: row.path, data: row.data })),
      notebooks: legacyShared.filter(row => row.path.startsWith("notebooks/") && isRecord(row.data) &&
        row.data.by === library.libraryCode).map(row => ({ path: row.path, data: row.data })),
    }, null, 2),
    "assignments.csv": toCsv([
      ...assignments.map(row => ({ id: row.id, courseId: row.courseId, title: row.title, type: row.type, dueDate: row.dueDate, done: "", source: "modern" })),
      ...eduAssignments.map(row => ({ id: row.id, courseId: row.courseId, title: row.title, type: "EDU", dueDate: row.dueAt?.toISOString() ?? "", done: "", source: "EDU" })),
      ...academicDates.map(row => ({ id: row.id, courseId: row.courseId, title: row.title, type: row.kind, dueDate: row.dueDate ?? "", done: "", source: "academic date" })),
      ...legacyAssignments.map(row => ({
        id: row.id, courseId: row.courseId, title: row.title, type: row.type, dueDate: row.due,
        done: row.done, source: typeof row.source === "string" ? row.source : "legacy",
      })),
    ], ["id", "courseId", "title", "type", "dueDate", "done", "source"]),
    "grades.csv": toCsv([
      ...grades.map(row => ({ courseId: row.courseId, weights: row.weights, items: row.items, finalLetter: row.finalLetter, source: "modern" })),
      ...legacyGradebooks.map(row => ({
        courseId: row.courseId, weights: row.weights, items: row.items,
        finalPercent: row.finalPercent, credits: row.credits, version: row.version, source: "legacy",
      })),
      ...eduSubmissions.map(row => ({ courseId: "", assignmentId: row.assignmentId, score: row.score, feedback: row.feedback, submissionText: row.text, source: "EDU" })),
    ], ["courseId", "assignmentId", "weights", "items", "finalLetter", "finalPercent", "credits", "version", "score", "feedback", "submissionText", "source"]),
    "edu-submissions.md": eduSubmissions.map(row => [
      `# Submission ${row.id}`,
      "",
      `- Assignment: ${row.assignmentId}`,
      `- Submitted timestamp: ${row.submittedAt.toISOString()}`,
      `- Score: ${row.score ?? ""}`,
      "",
      "## Submission",
      "",
      row.text,
      "",
      "## Feedback",
      "",
      row.feedback ?? "",
      "",
    ].join("\n")).join("\n---\n\n"),
    "guides.json": JSON.stringify([
      ...guides.map(row => ({ courseId: row.courseId, content: row.content, sources: row.sources })),
      ...legacyGuides,
    ], null, 2),
    "credits.csv": toCsv(transactions.map(row => ({
      date: row.date.toISOString(), amount: row.amount, reason: row.reason, source: row.source,
    })), ["date", "amount", "reason", "source"]),
    "consents.csv": toCsv(consents.map(row => ({
      sessionId: row.sessionId, lectureId: row.lectureId, courseId: row.courseId, version: row.version,
      statements: row.statements, platform: row.platform, appVersion: row.appVersion,
      accommodation: row.accommodation, createdAt: row.createdAt.toISOString(),
    })), ["sessionId", "lectureId", "courseId", "version", "statements", "platform", "appVersion", "accommodation", "createdAt"]),
  };
  const privateObjects = [
    ...eduLectures.filter(row => row.audioObjectKey).map(row => ({
      id: row.id, filename: row.audioFilename, key: row.audioObjectKey, folder: "edu-lectures",
    })),
    ...eduSources.filter(row => row.objectKey).map(row => ({
      id: row.id, filename: row.filename, key: row.objectKey, folder: "edu-sources",
    })),
    ...eduMaterials.filter(row => row.fileKey).map(row => ({
      id: row.id, filename: row.filename, key: row.fileKey, folder: "edu-materials",
    })),
    ...eduAssignments.filter(row => row.fileKey).map(row => ({
      id: row.id, filename: row.filename, key: row.fileKey, folder: "edu-assignments",
    })),
    ...ownedCourses.flatMap(course => [
      course.syllabusObjectPath ? { id: course.id, filename: course.syllabusFilename, key: course.syllabusObjectPath, folder: "syllabi" } : null,
      course.syllabusPendingObjectPath ? { id: course.id, filename: course.syllabusPendingFilename, key: course.syllabusPendingObjectPath, folder: "syllabi-pending" } : null,
    ].filter((item): item is { id: string; filename: string | null; key: string; folder: string } => item !== null)),
  ];
  for (const object of privateObjects) {
    const key = normalizeObjectKey(object.key);
    if (!key) throw new Error("A private upload path could not be normalized for export.");
    const safeName = (object.filename ?? "upload").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "upload";
    const file = await objectStorage.getObjectEntityFile(`/objects/${key}`);
    const [contents] = await file.download();
    files[`uploads/${object.folder}/${object.id}-${safeName}`] = contents;
  }
  return createPrivateZip(files);
}

router.post("/privacy/export", async (req, res): Promise<void> => {
  try {
    const library = await requirePrivacyLibrary(req);
    const now = new Date();
    const [latest] = await db.select({ createdAt: classscribePrivacyExportsTable.createdAt })
      .from(classscribePrivacyExportsTable).where(eq(classscribePrivacyExportsTable.libraryHash, library.libraryHash))
      .orderBy(sql`${classscribePrivacyExportsTable.createdAt} desc`).limit(1);
    if (latest && latest.createdAt.getTime() + 24 * 60 * 60 * 1000 > now.getTime()) {
      res.status(429).json({
        error: "A privacy export was already created during the last 24 hours.",
        exportNextAllowedAt: new Date(latest.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      });
      return;
    }
    const archive = await buildExport(library);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const created = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`privacy-export:${library.libraryHash}`}, 0))`);
      const [current] = await tx.select({ createdAt: classscribePrivacyExportsTable.createdAt })
        .from(classscribePrivacyExportsTable).where(eq(classscribePrivacyExportsTable.libraryHash, library.libraryHash))
        .orderBy(sql`${classscribePrivacyExportsTable.createdAt} desc`).limit(1);
      if (current && current.createdAt.getTime() + 24 * 60 * 60 * 1000 > Date.now()) {
        return { nextAllowed: new Date(current.createdAt.getTime() + 24 * 60 * 60 * 1000) };
      }
      await tx.insert(classscribePrivacyExportsTable).values({
        id: randomUUID(), libraryHash: library.libraryHash, tokenHash: hash(token), archive, expiresAt,
      });
      return { nextAllowed: null };
    });
    if (created.nextAllowed) {
      res.status(429).json({
        error: "A privacy export was already created during the last 24 hours.",
        exportNextAllowedAt: created.nextAllowed.toISOString(),
      });
      return;
    }
    res.status(201).json({ url: `/api/privacy/export/download/${token}`, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 503;
    req.log?.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Privacy export creation failed");
    res.status(status >= 400 && status < 600 ? status : 503).json({ error: error instanceof Error ? error.message : "Privacy export failed." });
  }
});

router.get("/privacy/export/download/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) { res.sendStatus(404); return; }
  const [archive] = await db.select().from(classscribePrivacyExportsTable)
    .where(and(eq(classscribePrivacyExportsTable.tokenHash, hash(token)), sql`${classscribePrivacyExportsTable.expiresAt} > now()`))
    .limit(1);
  if (!archive) { res.sendStatus(404); return; }
  res.set("Content-Type", "application/zip");
  res.set("Content-Disposition", 'attachment; filename="classscribe-privacy-export.zip"');
  res.set("Cache-Control", "private, no-store");
  res.send(archive.archive);
});

router.delete("/privacy/consents/lecture/:lectureId", async (req, res): Promise<void> => {
  try {
    const library = await requirePrivacyLibrary(req);
    await db.delete(classscribeConsentsTable).where(and(
      eq(classscribeConsentsTable.libraryHash, library.libraryHash),
      eq(classscribeConsentsTable.lectureId, req.params.lectureId),
    ));
    res.sendStatus(204);
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 503;
    res.status(status >= 400 && status < 600 ? status : 503).json({ error: error instanceof Error ? error.message : "Could not remove lecture consent." });
  }
});

async function resolveDeletionLibrary(req: Request) {
  const auth = getAuth(req);
  if (auth.userId) {
    const library = await requirePrivacyLibrary(req);
    if (!recentFirstFactor(req)) throw Object.assign(new Error("Reauthenticate with your first factor within the last 10 minutes before deleting this library."), { status: 403 });
    return { ...library, authenticated: true };
  }
  const library = await requirePrivacyLibrary(req);
  return { ...library, authenticated: false };
}

router.post("/privacy/delete", async (req, res): Promise<void> => {
  if (!bodyRecord(req.body) || Object.keys(req.body).sort().join(",") !== "confirmActiveSubscription,confirmation" ||
      req.body.confirmation !== "DELETE" || typeof req.body.confirmActiveSubscription !== "boolean") {
    res.status(400).json({ error: 'Request body must be { confirmation: "DELETE", confirmActiveSubscription: boolean }.' }); return;
  }
  let library: Awaited<ReturnType<typeof resolveDeletionLibrary>>;
  let providerAppUserId: string | undefined;
  try {
    library = await resolveDeletionLibrary(req);
    const billing = await getLibraryBillingStatus(library.libraryCode);
    const active = (billing.plan === "student" || billing.plan === "pro") &&
      ["active", "trialing", "past_due"].includes(billing.status);
    if (active && !req.body.confirmActiveSubscription) {
      res.status(409).json({
        error: "Cancel or manage the active subscription before deletion, or explicitly confirm that you want the account deleted while billing remains active.",
        cancelManageUrl: billing.billingSource === "web" ? "/api/billing/portal"
          : billing.billingSource === "play_store" ? "https://play.google.com/store/account/subscriptions"
            : "https://apps.apple.com/account/subscriptions",
        provider: billing.billingSource,
        requiresExtraConfirmation: true,
      });
      return;
    }
    try { providerAppUserId = await getRevenueCatAppUserId(library.libraryCode); } catch { /* outbox retry handles unknown provider identity */ }

    await deletePrivacyLibraryData(library, providerAppUserId);
    const [outbox] = await db.select().from(classscribePrivacyDeletionOutboxTable)
      .where(eq(classscribePrivacyDeletionOutboxTable.libraryHash, library.libraryHash)).limit(1);
    let providersPending = Boolean(outbox?.pendingProviders.length);
    let providerDependency: string | undefined;
    if (outbox) {
      try {
        providersPending = await processPrivacyDeletionOutboxItem(outbox);
      } catch {
        providersPending = true;
      }
      if (providersPending) {
        const [pending] = await db.select({
          pendingProviders: classscribePrivacyDeletionOutboxTable.pendingProviders,
          lastErrorCode: classscribePrivacyDeletionOutboxTable.lastErrorCode,
        }).from(classscribePrivacyDeletionOutboxTable)
          .where(eq(classscribePrivacyDeletionOutboxTable.id, outbox.id)).limit(1);
        if (pending?.pendingProviders.some(provider =>
          provider === "revenuecat" || provider === "revenuecat-confirm")) {
          providerDependency = pending.lastErrorCode === "revenuecat_authentication_failed"
            ? "RevenueCat deletion remains queued; the configured API credentials were rejected (HTTP 401)."
            : pending.lastErrorCode === "revenuecat_project_scope_denied"
              ? "RevenueCat deletion remains queued; the API key lacks customer access for the selected project (HTTP 403)."
              : pending.lastErrorCode === "revenuecat_delete_confirmation_pending"
                ? "RevenueCat accepted the asynchronous deletion request; customer deletion is still awaiting provider confirmation."
                : "RevenueCat deletion remains queued and will retry when provider identity, project configuration, or provider confirmation is available.";
        }
      }
    }
    res.json({
      deleted: true, providersPending, backupDays: 30,
      ...(providerDependency ? { providerDependency } : {}),
    });
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 503;
    req.log?.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Privacy deletion failed");
    res.status(status >= 400 && status < 600 ? status : 503).json({ error: error instanceof Error ? error.message : "Deletion could not be completed." });
  }
});

export async function deletePrivacyLibraryData(
  library: { userId: string; libraryCode: string; libraryHash: string },
  providerAppUserId?: string,
): Promise<void> {
  const { userId, libraryCode, libraryHash } = library;
  // The retention CLI calls this boundary without starting the HTTP server.
  // Never allow its course cascade to run before the inventory guard exists.
  await ensureEduCourseFileCleanup(pool);
  await db.transaction(async tx => {
    await lockPrivacyLibraryDeletion(tx, libraryCode);
    if (userId) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`library-account:${hash(userId)}`}, 0))`);
    }
    if (userId) {
      const currentCode = await getLinkedLibraryCode(userId) ?? freeBillingIdentityForOwner(userId);
      if (currentCode !== libraryCode) {
        throw Object.assign(new Error("The selected library changed before deletion; retry from the currently linked library."), { status: 409 });
      }
    }
    const [revokedCode] = await tx.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `revoked/${hash(libraryCode)}`)).limit(1);
    if (revokedCode) throw Object.assign(new Error("This sync code has been replaced."), { status: 409 });
    const [alreadyDeleted] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
      .from(classscribePrivacyTombstonesTable).where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
    if (alreadyDeleted) return;
    const aliases = await tx.select({ aliasHash: classscribePrivacyLibraryAliasesTable.aliasHash })
      .from(classscribePrivacyLibraryAliasesTable)
      .where(eq(classscribePrivacyLibraryAliasesTable.currentLibraryHash, libraryHash));
    const libraryHashes = [...new Set([libraryHash, ...aliases.map(row => row.aliasHash)])];
    for (const key of libraryHashes.flatMap(codeHash => [`billing:${codeHash}`, `credits:${codeHash}`]).sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    }
    const ownedCourses = userId
      ? await tx.select().from(coursesTable).where(eq(coursesTable.ownerId, userId))
      : [];
    const ownedCourseIds = ownedCourses.map(row => row.id);
    const [personalEduLectures, personalEduSources] = userId ? await Promise.all([
      tx.select({ id: eduLecturesTable.id, audioObjectKey: eduLecturesTable.audioObjectKey })
        .from(eduLecturesTable).where(eq(eduLecturesTable.createdBy, userId)),
      tx.select({ id: eduSourcesTable.id, objectKey: eduSourcesTable.objectKey })
        .from(eduSourcesTable).where(eq(eduSourcesTable.createdBy, userId)),
    ]) : [[], []];
    const personalLectureIds = userId ? await tx.select({ id: lecturesTable.id })
      .from(lecturesTable).where(or(
        eq(lecturesTable.createdBy, userId),
        ...(ownedCourseIds.length ? [inArray(lecturesTable.courseId, ownedCourseIds)] : []),
      )) : [];
    const ownedCourseLectureIds: string[] = [];
    const storageKeys = new Set<string>();
    // Freeze attachment mutations before collecting files that cascade with classrooms.
    // Student uploads use the same assignment lock, even when their library lock differs.
    if (ownedCourseIds.length) await tx.select({ id: eduAssignmentsTable.id }).from(eduAssignmentsTable)
      .where(inArray(eduAssignmentsTable.courseId, ownedCourseIds)).for("update");
    // Include student-owned work and submissions that will cascade with an owned classroom.
    const submissionFiles = await tx.select({ fileKey: eduSubmissionsTable.fileKey })
      .from(eduSubmissionsTable).where(or(
        ...(userId ? [eq(eduSubmissionsTable.studentId, userId)] : []),
        ...(ownedCourseIds.length ? [sql`${eduSubmissionsTable.assignmentId} in (
          select ${eduAssignmentsTable.id} from ${eduAssignmentsTable}
          where ${inArray(eduAssignmentsTable.courseId, ownedCourseIds)}
        )`] : []),
        sql`false`,
      ));
    for (const row of submissionFiles) addStorageKey(storageKeys, row.fileKey);
    for (const course of ownedCourses) {
      for (const key of [course.syllabusObjectPath, course.syllabusPendingObjectPath]) addStorageKey(storageKeys, key);
    }
    if (ownedCourseIds.length) {
      const [mediaLectures, mediaSources] = await Promise.all([
        tx.select({ id: eduLecturesTable.id, audioObjectKey: eduLecturesTable.audioObjectKey }).from(eduLecturesTable)
          .where(inArray(eduLecturesTable.courseId, ownedCourseIds)),
        tx.select({ objectKey: eduSourcesTable.objectKey }).from(eduSourcesTable)
          .where(inArray(eduSourcesTable.courseId, ownedCourseIds)),
      ]);
      ownedCourseLectureIds.push(...mediaLectures.map(row => row.id));
      for (const key of [
        ...mediaLectures.map(row => row.audioObjectKey), ...mediaSources.map(row => row.objectKey),
      ]) addStorageKey(storageKeys, key);
      // Material/assignment files are inventoried by the course BEFORE DELETE
      // trigger. Its worker validates the course namespace before removal.
    }
    for (const key of [...personalEduLectures.map(row => row.audioObjectKey), ...personalEduSources.map(row => row.objectKey)]) {
      addStorageKey(storageKeys, key);
    }
    const docs = classscribeLegacyDocumentsTable;
    const billingPaths = libraryHashes.flatMap(codeHash => [
      eq(docs.path, `private/classscribe-billing/accounts/${codeHash}`),
      eq(docs.path, `private/classscribe-billing/aliases/${codeHash}`),
      like(docs.path, `private/classscribe-billing/usage/${codeHash}/%`),
    ]);
    if (userId) {
      const affectedLectureIds = [...new Set([
        ...personalLectureIds.map(row => row.id),
        ...personalEduLectures.map(row => row.id),
        ...ownedCourseLectureIds,
      ])];
      const affectedConsentScopes = [
        ...(ownedCourseIds.length ? [inArray(classscribeConsentsTable.courseId, ownedCourseIds)] : []),
        ...(affectedLectureIds.length ? [inArray(classscribeConsentsTable.lectureId, affectedLectureIds)] : []),
      ];
      if (affectedConsentScopes.length) {
        await tx.delete(classscribeConsentsTable).where(or(...affectedConsentScopes));
      }
      await tx.delete(courseGradebooksTable).where(eq(courseGradebooksTable.userId, userId));
      await tx.delete(gradeScalesTable).where(eq(gradeScalesTable.userId, userId));
      await tx.delete(syllabusAssignmentCompletionsTable).where(eq(syllabusAssignmentCompletionsTable.userId, userId));
      await tx.delete(bookmarksTable).where(eq(bookmarksTable.userId, userId));
      await tx.delete(practiceAttemptsTable).where(eq(practiceAttemptsTable.userId, userId));
      await tx.delete(notesTable).where(eq(notesTable.userId, userId));
      await tx.delete(studyGuidesTable).where(eq(studyGuidesTable.userId, userId));
      await tx.delete(studyPlansTable).where(eq(studyPlansTable.userId, userId));
      await tx.delete(studyPlanImportsTable).where(eq(studyPlanImportsTable.userId, userId));
      await tx.delete(courseMembersTable).where(eq(courseMembersTable.userId, userId));
      await tx.delete(eduGroupMembersTable).where(eq(eduGroupMembersTable.userId, userId));
      await tx.update(courseCommentsTable).set({ authorName: "Former student", authorId: null })
        .where(eq(courseCommentsTable.authorId, userId));
      await tx.update(eduDiscussionTopicsTable).set({ creatorId: "deleted-former-student" })
        .where(eq(eduDiscussionTopicsTable.creatorId, userId));
      await tx.update(eduDiscussionRepliesTable).set({ creatorId: "deleted-former-student" })
        .where(eq(eduDiscussionRepliesTable.creatorId, userId));
      await tx.update(classscribeEduInstructorAuditTable).set({
        issuerUserId: "deleted-former-student", instructorUserId: "deleted-former-student",
      }).where(or(
        eq(classscribeEduInstructorAuditTable.issuerUserId, userId),
        eq(classscribeEduInstructorAuditTable.instructorUserId, userId),
      ));
      await tx.update(classscribeEduInstitutionAgreementsTable).set({ adminUserId: "deleted-former-student" })
        .where(eq(classscribeEduInstitutionAgreementsTable.adminUserId, userId));
      await tx.delete(eduDiscussionTopicsTable).where(eq(eduDiscussionTopicsTable.creatorId, userId));
      await tx.delete(eduDiscussionRepliesTable).where(eq(eduDiscussionRepliesTable.creatorId, userId));
      await tx.delete(eduSubmissionsTable).where(eq(eduSubmissionsTable.studentId, userId));
      await tx.delete(classscribeEduClientSessionsTable).where(eq(classscribeEduClientSessionsTable.userId, userId));
      await tx.delete(classscribeEduLicenseGrantsTable).where(eq(classscribeEduLicenseGrantsTable.userId, userId));
      await tx.delete(classscribeEduClientLicensesTable).where(eq(classscribeEduClientLicensesTable.ownerUserId, userId));
      if (personalLectureIds.length) await tx.delete(lecturesTable).where(inArray(
        lecturesTable.id, personalLectureIds.map(row => row.id),
      ));
      if (personalEduLectures.length) await tx.delete(eduLecturesTable).where(inArray(
        eduLecturesTable.id, personalEduLectures.map(row => row.id),
      ));
      if (personalEduSources.length) await tx.delete(eduSourcesTable).where(inArray(
        eduSourcesTable.id, personalEduSources.map(row => row.id),
      ));
      if (ownedCourseIds.length) {
        await tx.delete(coursesTable).where(and(
          eq(coursesTable.ownerId, userId), inArray(coursesTable.id, ownedCourseIds),
        ));
      }
      await tx.delete(classscribePrivacyProfilesTable).where(eq(classscribePrivacyProfilesTable.userId, userId));
      await tx.delete(classscribePrivacyRetentionWarningsTable).where(eq(classscribePrivacyRetentionWarningsTable.userId, userId));
    }
    const exactPaths = [
      `data/users/${libraryCode}/profile`, `members/${libraryCode}`, `revoked/${hash(libraryCode)}`,
      ...aliases.map(row => `revoked/${row.aliasHash}`),
      ...(userId ? [
        `private/library-links/accounts/${hash(userId)}`,
        `private/library-links/owners/${hash(libraryCode)}`,
      ] : []),
    ];
    const ownedDocs = await tx.select({ path: docs.path, data: docs.data }).from(docs).where(or(
      like(docs.path, `data/users/${escapeLike(libraryCode)}/%`),
      eq(docs.path, `private/ai-consents/${library.libraryHash}`),
      eq(docs.path, `members/${libraryCode}`),
      ...billingPaths,
      ...(userId ? [
        eq(docs.path, `private/library-links/accounts/${hash(userId)}`),
        eq(docs.path, `private/library-links/owners/${hash(libraryCode)}`),
      ] : []),
    ));
    const personalRows = ownedDocs.filter(row =>
      row.path === `private/ai-consents/${library.libraryHash}` ||
      row.path.startsWith(`data/users/${libraryCode}/`) ||
      libraryHashes.some(codeHash => row.path.startsWith(`private/classscribe-billing/accounts/${codeHash}`) ||
        row.path.startsWith(`private/classscribe-billing/aliases/${codeHash}`) ||
        row.path.startsWith(`private/classscribe-billing/usage/${codeHash}/`)));
    for (const row of personalRows) referencedObjectKeys(row.data, storageKeys);
    let stableProviderAppUserId = providerAppUserId;
    if (!stableProviderAppUserId) {
      const billingAccount = personalRows.find(row =>
        row.path === `private/classscribe-billing/accounts/${libraryHash}` && isRecord(row.data) &&
        typeof row.data.billingAccountId === "string");
      if (billingAccount && isRecord(billingAccount.data) && typeof billingAccount.data.billingAccountId === "string") {
        stableProviderAppUserId = billingAccount.data.billingAccountId;
      }
    }
    const personalPaths = personalRows.map(row => row.path);
    if (personalPaths.length) await tx.delete(docs).where(inArray(docs.path, personalPaths));
    for (const path of exactPaths) await tx.delete(docs).where(eq(docs.path, path));
    const shared = await tx.select({ path: docs.path, data: docs.data }).from(docs)
      .where(or(like(docs.path, "posts/%"), like(docs.path, "shared/%"), like(docs.path, "notebooks/%")));
    const ownSharedRows = shared.filter(row => isRecord(row.data) && row.data.by === libraryCode);
    for (const row of ownSharedRows) referencedObjectKeys(row.data, storageKeys);
    const ownSharedPaths = ownSharedRows.map(row => row.path);
    if (ownSharedPaths.length) await tx.delete(docs).where(inArray(docs.path, [...new Set(ownSharedPaths)]));
    const pendingCourseFiles = ownedCourseIds.length
      ? await tx.select({ courseId: eduCourseFileCleanupTable.courseId }).from(eduCourseFileCleanupTable)
        .where(inArray(eduCourseFileCleanupTable.courseId, ownedCourseIds))
      : [];
    const pendingProviders = [
      ...(userId ? ["clerk"] : []),
      "revenuecat",
      ...[...storageKeys].map(key => `storage:${key}`),
      ...[...new Set(pendingCourseFiles.map(row => row.courseId))].map(id => `edu-course-files:${id}`),
    ];
    // Retained financial totals are de-identified: remove free-form reasons,
    // source strings, provider event IDs, and metadata that could carry content.
    const retainedTransactions = await tx.select({
      id: classscribeCreditTransactionsTable.id,
      eventId: classscribeCreditTransactionsTable.eventId,
    }).from(classscribeCreditTransactionsTable)
      .where(inArray(classscribeCreditTransactionsTable.libraryHash, libraryHashes));
    for (const transaction of retainedTransactions) {
      await tx.update(classscribeCreditTransactionsTable).set({
        eventId: `privacy-${hash(transaction.eventId)}`,
        reason: "retained financial transaction",
        source: "privacy_retention",
        metadata: {},
      }).where(eq(classscribeCreditTransactionsTable.id, transaction.id));
    }
    await tx.delete(classscribeCreditActionsTable).where(inArray(classscribeCreditActionsTable.libraryHash, libraryHashes));
    // Close any durable provider grants while holding every library credits
    // lock above. Workers use this same credits:<libraryHash> lock and reject
    // tombstoned libraries before making provider changes.
    await tx.update(classscribeCreditProviderIntentsTable).set({
      status: "cancelled",
      errorCode: "credit_account_deleted",
      updatedAt: new Date(),
    }).where(and(
      inArray(classscribeCreditProviderIntentsTable.libraryHash, libraryHashes),
      inArray(classscribeCreditProviderIntentsTable.status, ["pending", "uncertain", "retryable"]),
    ));
    await tx.update(classscribeCreditSubscriptionPeriodsTable).set({
      highWaterPlan: null,
      status: "revoked",
      pendingEventId: null,
      pendingPaymentHash: null,
      pendingPlan: null,
      pendingAmount: null,
      pendingSource: null,
      revokedAt: new Date(),
      updatedAt: new Date(),
    }).where(inArray(classscribeCreditSubscriptionPeriodsTable.libraryHash, libraryHashes));
    await tx.delete(classscribePrivacyExportsTable).where(inArray(classscribePrivacyExportsTable.libraryHash, libraryHashes));
    await tx.delete(classscribeConsentsTable).where(inArray(classscribeConsentsTable.libraryHash, libraryHashes));
    await tx.delete(docs).where(inArray(docs.path, libraryHashes.map(codeHash => `private/ai-consents/${codeHash}`)));
    for (const codeHash of libraryHashes) {
      await tx.insert(classscribePrivacyTombstonesTable).values({
        libraryHash: codeHash, deletedUserHash: userId ? hash(userId) : null, legacyLibrary: !userId,
      }).onConflictDoNothing();
    }
    await tx.insert(docs).values({
      path: `revoked/${hash(libraryCode)}`,
      data: { deleted: true, deletedAt: new Date().toISOString() },
    }).onConflictDoNothing();
    await tx.insert(classscribePrivacyDeletionOutboxTable).values({
      id: randomUUID(), libraryHash, userId: userId || null,
      providerAppUserId: stableProviderAppUserId ?? null,
      providerProjectId: process.env.REVENUECAT_PROJECT_ID ?? null,
      pendingProviders,
    }).onConflictDoNothing();
  });
}

export default router;
