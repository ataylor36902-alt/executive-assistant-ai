import { Router, type IRouter, type Request, type Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { z } from "zod";
import { and, asc, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  academicDatesTable,
  bookmarksTable,
  classscribeConsentsTable,
  courseCommentsTable,
  courseMembersTable,
  courseModulesTable,
  coursesTable,
  db,
  lecturesTable,
  practiceAttemptsTable,
  syllabusDatesTable,
  syllabusAssignmentsTable,
  syllabusAssignmentCompletionsTable,
} from "@workspace/db";
import {
  ListCourseDatesParams,
  ListLectureDatesParams,
  UpdateAcademicDateBody,
  UpdateAcademicDateParams,
  AnalyzeLectureBody,
  AnalyzeLectureResponse,
  AnalyzeLectureParams,
  CreateCourseBody,
  CreateCourseCommentBody,
  CreateCourseCommentParams,
  CreateCourseInviteParams,
  CreateLectureBody,
  DeleteLectureParams,
  GetLectureParams,
  JoinCourseBody,
  ListCourseCommentsParams,
  ListCourseLecturesParams,
  TranscribeLectureBody,
  TranscribeLectureParams,
  UpdateCourseBody,
  UpdateCourseParams,
  UpdateLectureBody,
  UpdateLectureParams,
  CreateBookmarkBody,
  CreateBookmarkParams,
  DeleteBookmarkParams,
  SubmitPracticeAttemptBody,
  GetPracticeProgressResponse,
  SubmitPracticeAttemptResponse,
  SetSyllabusAssignmentCompletionBody,
  SetSyllabusAssignmentCompletionParams,
  PreviewScheduleImportBody,
  PreviewScheduleImportResponse,
  ConfirmScheduleImportBody,
  ConfirmScheduleImportResponse,
} from "@workspace/api-zod";
import type { CourseMeeting, ScheduleCourseMatch, ScheduleProposal } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { accessibleCourseIds, canAccessCourse } from "./course-access";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { calendarDate, normalizeSyllabusPreview } from "../lib/syllabus-proposals";
import { matchCoursework, personalAssignments, syllabusDateLinks, syllabusTitleKey } from "../lib/syllabus-coursework";
import { proposedWeights } from "../lib/grades";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { parseBuffer } from "music-metadata";
import {
  freeBillingIdentityForOwner,
  getLibraryBillingStatus,
  mergeFreeOwnerUsageIntoLibrary,
  finishTranscriptionUsage,
  releaseTranscriptionUsage,
  reserveTranscriptionUsage,
  BillingError,
} from "../lib/classscribe-billing";
import { getLinkedLibraryCode } from "./library-link";
import { getModernEffectivePlan } from "./modern-entitlements";
import { hasPrivacyConsent } from "../lib/classscribe-consents";
import { requirePrivacyLibrary } from "../lib/privacy-access";
import { getPrivacyAgeBand, publicAuthorName } from "../lib/privacy-minor";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

async function courseCommentAuthorName(
  req: Request,
  authorId: string | null,
  storedName: string,
): Promise<string> {
  if (!authorId) return storedName;
  const ageBand = await getPrivacyAgeBand(authorId);
  try {
    const user = await clerkClient.users.getUser(authorId);
    const fullName = [user.firstName, user.lastName]
      .filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
    const name = user.fullName?.trim() || fullName || user.username?.trim() || storedName;
    return publicAuthorName(ageBand, name);
  } catch (error) {
    req.log.warn({ err: error }, "Could not resolve course discussion author name");
    return publicAuthorName(ageBand, storedName);
  }
}

const inviteCode = () => crypto.randomBytes(9).toString("base64url").toUpperCase();
type ModernBillingIdentity = { libraryCode: string; linked: boolean };

async function modernBillingIdentity(
  accountId: string,
  warn?: (error: unknown) => void,
): Promise<ModernBillingIdentity> {
  try {
    const libraryCode = await getLinkedLibraryCode(accountId);
    if (libraryCode) return { libraryCode, linked: true };
  } catch (error) {
    warn?.(error);
  }
  return { libraryCode: freeBillingIdentityForOwner(accountId), linked: false };
}

const publicLecture = (lecture: typeof lecturesTable.$inferSelect, examFeaturesEnabled: boolean) => ({
  ...lecture,
  studyQuestions: examFeaturesEnabled ? lecture.studyQuestions : [],
  quizQuestions: examFeaturesEnabled
    ? lecture.quizQuestions.map(({ correctIndex: _correctIndex, ...question }) => question)
    : [],
});

async function planForRequest(req: Request, res: Response) {
  try {
    return await getModernEffectivePlan(getAuth(req).userId!);
  } catch (error) {
    req.log.error({ err: error }, "Could not verify modern ClassScribe plan");
    if (error instanceof BillingError) {
      res.status(error.httpStatus).json({ code: error.code, error: error.message });
    } else {
      res.status(503).json({ error: "Could not verify your ClassScribe plan right now. Please retry." });
    }
    return null;
  }
}

// Never return database-only fields (join secret, owner ID, private object paths or parsed text).
function publicCourse(course: typeof coursesTable.$inferSelect) {
  const { id, name, subject, term, color, createdAt, meetings } = course;
  return { id, name, subject, term, color, createdAt, meetings: meetings ?? [] };
}

async function memberCount(courseId: string, ownerId: string | null) {
  const [members] = await db.select({
    total: sql<number>`count(*)::int`,
    ownerPresent: sql<number>`count(*) filter (where ${courseMembersTable.userId} = ${ownerId})::int`,
  }).from(courseMembersTable).where(eq(courseMembersTable.courseId, courseId));
  return members.total + (ownerId && !members.ownerPresent ? 1 : 0);
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function canMutateLecture(userId: string, lecture: { courseId: string; createdBy: string | null }) {
  const [course] = await db.select({ ownerId: coursesTable.ownerId }).from(coursesTable)
    .where(and(eq(coursesTable.id, lecture.courseId), eq(coursesTable.eduEnabled, false)));
  return course?.ownerId === userId || lecture.createdBy === userId;
}

async function isCourseOwner(userId: string, courseId: string) {
  const [course] = await db.select({ ownerId: coursesTable.ownerId }).from(coursesTable)
    .where(and(eq(coursesTable.id, courseId), eq(coursesTable.eduEnabled, false)));
  return course?.ownerId === userId;
}

router.use("/courses/:id", async (req, res, next) => {
  if (req.params.id === "join") return next();
  if (!isUuid(String(req.params.id)) || !(await canAccessCourse(getAuth(req).userId!, String(req.params.id)))) {
    res.status(404).json({ error: "Course not found" }); return;
  }
  next();
});
router.use("/lectures/:id", async (req, res, next) => {
  if (!isUuid(String(req.params.id))) { res.status(404).json({ error: "Lecture not found" }); return; }
  const [lecture] = await db.select({ courseId: lecturesTable.courseId }).from(lecturesTable)
    .where(eq(lecturesTable.id, String(req.params.id)));
  if (!lecture || !(await canAccessCourse(getAuth(req).userId!, lecture.courseId))) {
    res.status(404).json({ error: "Lecture not found" }); return;
  }
  next();
});
router.use("/dates/:id", async (req, res, next) => {
  if (!isUuid(String(req.params.id))) { res.status(404).json({ error: "Date not found" }); return; }
  const [item] = await db.select({ courseId: academicDatesTable.courseId }).from(academicDatesTable)
    .where(eq(academicDatesTable.id, String(req.params.id)));
  if (!item || !(await canAccessCourse(getAuth(req).userId!, item.courseId))) {
    res.status(404).json({ error: "Date not found" }); return;
  }
  next();
});

async function ensureDemoData(userId: string) {
  const [anyAccessibleCourse] = await db.select({ id: coursesTable.id }).from(coursesTable)
    .leftJoin(courseMembersTable, and(
      eq(courseMembersTable.courseId, coursesTable.id),
      eq(courseMembersTable.userId, userId),
    )).where(or(eq(coursesTable.ownerId, userId), eq(courseMembersTable.userId, userId))).limit(1);
  if (anyAccessibleCourse) return;
  await db.transaction(async tx => {
    const [course] = await tx
      .insert(coursesTable)
      .values({
        name: "Foundations of Psychology",
        subject: "PSY 101",
        term: "Fall 2026",
        color: "#6558d3",
        inviteCode: inviteCode(),
        ownerId: userId,
      })
      .returning();
    await tx.insert(courseMembersTable).values({ courseId: course.id, userId });
    await tx.insert(lecturesTable).values({
      courseId: course.id,
      title: "Memory, Attention & Learning",
      professor: "Dr. Maya Chen",
      lectureDate: new Date(),
      durationSeconds: 3120,
      transcript:
        "Working memory has a limited capacity. Attention selects which information reaches that temporary workspace. Elaborative rehearsal connects new ideas to existing knowledge, making long-term retrieval more reliable.",
      summary:
        "Attention controls what enters working memory, while elaborative rehearsal helps encode durable long-term memories.",
      notes:
        "Connect new ideas to prior knowledge. Review material over spaced intervals rather than in one sitting.",
      keyPoints: [
        "Working memory has limited capacity.",
        "Attention determines what information is processed.",
        "Elaboration and spaced practice improve long-term retrieval.",
      ],
      definitions: [
        "Working memory — a limited system for temporarily holding and manipulating information.",
        "Elaborative rehearsal — connecting new material to knowledge already in memory.",
      ],
    });
  });
}

async function courseResponse(userId: string) {
  const ids = await accessibleCourseIds(userId);
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: coursesTable.id,
      isOwner: sql<boolean>`coalesce(${coursesTable.ownerId} = ${userId}, false)`,
      name: coursesTable.name,
      subject: coursesTable.subject,
      term: coursesTable.term,
      color: coursesTable.color,
      meetings: coursesTable.meetings,
      createdAt: coursesTable.createdAt,
      lectureCount: sql<number>`count(distinct ${lecturesTable.id})::int`,
      memberCount: sql<number>`(select count(*) from ${courseMembersTable} where ${courseMembersTable.courseId} = ${coursesTable.id})::int
        + case when ${coursesTable.ownerId} is not null and not exists
          (select 1 from ${courseMembersTable} where ${courseMembersTable.courseId} = ${coursesTable.id}
            and ${courseMembersTable.userId} = ${coursesTable.ownerId}) then 1 else 0 end`,
    })
    .from(coursesTable)
    .leftJoin(lecturesTable, eq(lecturesTable.courseId, coursesTable.id))
    .where(inArray(coursesTable.id, ids))
    .groupBy(coursesTable.id)
    .orderBy(asc(coursesTable.createdAt));
  return rows;
}

const scheduleDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const scheduleTypes = ["Lecture", "Lab", "Discussion", "Seminar", "Recitation", "Office hours"] as const;
const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const isValidScheduleTime = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};
const normalizeCourseKey = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

router.post("/schedule/import-preview", async (req, res): Promise<void> => {
  if (typeof req.body?.contentBase64 === "string" && req.body.contentBase64.length > 11184812) {
    res.status(413).json({ error: "Schedule files must be no larger than 8 MB" }); return;
  }
  const parsed = PreviewScheduleImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { text = "", filename, mimeType, contentBase64 } = parsed.data;
  let sourceText = text.trim();
  let imageData: string | undefined;
  if (contentBase64) {
    if (!mimeType || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      res.status(415).json({ error: "Choose a PDF or JPEG, PNG, or WebP schedule image" }); return;
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      res.status(400).json({ error: "The uploaded file is not valid base64 data" }); return;
    }
    const fileBytes = Buffer.from(contentBase64, "base64");
    if (!fileBytes.length || fileBytes.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: "Schedule files must be no larger than 8 MB" }); return;
    }
    if (mimeType === "application/pdf") {
      try { sourceText = [sourceText, await extractPdfText(fileBytes)].filter(Boolean).join("\n\n").slice(0, 30000); }
      catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "Unable to read PDF text" }); return; }
    } else {
      const signatures: Record<string, boolean> = {
        "image/jpeg": fileBytes[0] === 0xff && fileBytes[1] === 0xd8,
        "image/png": fileBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "image/webp": fileBytes.toString("ascii", 0, 4) === "RIFF" && fileBytes.toString("ascii", 8, 12) === "WEBP",
      };
      if (!signatures[mimeType]) { res.status(415).json({ error: "Uploaded image contents do not match the selected image type" }); return; }
      imageData = `data:${mimeType};base64,${fileBytes.toString("base64")}`;
    }
  }
  if (!sourceText && !imageData) { res.status(400).json({ error: "Paste schedule text or select a PDF or image first" }); return; }
  try {
    const userContent = imageData
      ? [
          { type: "text" as const, text: `Extract all course meetings from this schedule${filename ? ` file (${filename})` : ""}. ${sourceText ? `Also consider these pasted details:\n${sourceText}` : ""}` },
          { type: "image_url" as const, image_url: { url: imageData } },
        ]
      : sourceText.slice(0, 30000);
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      store: false,
      response_format: { type: "json_object" },
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content: `Extract a student's recurring weekly class schedule. Return JSON only: {"courses":[{"name":"full course name","subject":"course code or catalog label","term":"explicit semester and year, or empty string when not stated","meetings":[{"days":["Mon","Wed"],"start":"09:00","end":"09:50","location":"room","type":"Lecture"}]}]}. Use 24-hour HH:MM times and day abbreviations Mon,Tue,Wed,Thu,Fri,Sat,Sun. Types must be Lecture, Lab, Discussion, Seminar, Recitation, or Office hours. Capture each distinct meeting, including labs and discussions. Do not invent missing details: omit a meeting if its days or start time are unclear, use empty location when absent and Lecture when type is absent. Do not return a course without at least one valid meeting. Limit to 40 courses and 20 meetings each.`,
        },
        { role: "user", content: userContent },
      ],
    });
    const raw = JSON.parse(completion.choices[0]?.message.content ?? "{}");
    if (!Array.isArray(raw?.courses)) { res.status(422).json({ error: "No readable courses were found in that schedule" }); return; }
    const ids = await accessibleCourseIds(getAuth(req).userId!);
    const currentCourses = ids.length ? await db.select().from(coursesTable).where(inArray(coursesTable.id, ids)) : [];
    const extractedProposals: ScheduleProposal[] = raw.courses.slice(0, 40).flatMap((item: any) => {
      if (!item || typeof item.name !== "string" || !item.name.trim() ||
          typeof item.subject !== "string" || !item.subject.trim() || !Array.isArray(item.meetings)) return [];
      const validRawMeetings = item.meetings.slice(0, 20).filter((meeting: any) => {
        const days = Array.isArray(meeting?.days)
          ? meeting.days.filter((day: unknown) => scheduleDays.includes(day as typeof scheduleDays[number]))
          : [];
        return days.length > 0 && isValidScheduleTime(meeting?.start) && isValidScheduleTime(meeting?.end) &&
          timeToMinutes(meeting.end) > timeToMinutes(meeting.start);
      });
      const meetings: CourseMeeting[] = validRawMeetings.map((meeting: any) => ({
        days: scheduleDays.filter(day => meeting.days.includes(day)),
        start: meeting.start,
        end: meeting.end,
        location: typeof meeting.location === "string" ? meeting.location.slice(0, 160) : "",
        type: scheduleTypes.includes(meeting.type) ? meeting.type : "Lecture",
      }));
      if (!meetings.length) return [];
      const subjectKey = normalizeCourseKey(item.subject);
      const term = typeof item.term === "string" ? item.term.trim().slice(0, 80) : "";
      const matchingCourses: ScheduleCourseMatch[] = currentCourses
        .filter(course => normalizeCourseKey(course.subject) === subjectKey)
        .sort((a, b) => a.term.localeCompare(b.term) || a.name.localeCompare(b.name))
        .slice(0, 20)
        .map(course => ({
          courseId: course.id,
          name: course.name,
          subject: course.subject,
          term: course.term,
          meetings: course.meetings ?? [],
          ownerWritable: course.ownerId === getAuth(req).userId,
        }));
      const sameTermCourses = term
        ? matchingCourses.filter(course => normalizeCourseKey(course.term) === normalizeCourseKey(term))
        : [];
      const existing = sameTermCourses.length === 1 ? currentCourses.find(course => course.id === sameTermCourses[0].courseId) : undefined;
      return [{
        name: item.name.trim().slice(0, 160),
        subject: item.subject.trim().slice(0, 80),
        term,
        meetings,
        courseId: existing?.id ?? null,
        existingName: existing?.name ?? null,
        existingTerm: existing?.term ?? null,
        existingMeetingCount: existing?.meetings?.length ?? 0,
        existingMeetings: existing?.meetings ?? [],
        ownerWritable: existing ? existing.ownerId === getAuth(req).userId : true,
        requiresExplicitMatchChoice: matchingCourses.length > 0 && !existing,
        matchingCourses,
      }];
    });
    const groupedProposals = new Map<string, ScheduleProposal>();
    for (const proposal of extractedProposals) {
      const key = proposal.courseId ?? `${normalizeCourseKey(proposal.subject)}:${normalizeCourseKey(proposal.term)}`;
      const current = groupedProposals.get(key);
      if (!current) { groupedProposals.set(key, proposal); continue; }
      for (const meeting of proposal.meetings) {
        const matching = current.meetings.find(item => item.start === meeting.start && item.end === meeting.end &&
          item.location === meeting.location && item.type === meeting.type);
        if (matching) matching.days = scheduleDays.filter(day => matching.days.includes(day) || meeting.days.includes(day));
        else if (current.meetings.length < 20) current.meetings.push(meeting);
      }
    }
    const proposals = [...groupedProposals.values()];
    if (!proposals.length) { res.status(422).json({ error: "No valid class meetings were found. Each meeting needs a recognized weekday, a real 24-hour start time, and an end time later than the start. Try clearer schedule text or a sharper image." }); return; }
    res.json(PreviewScheduleImportResponse.parse({ courses: proposals }));
  } catch (error) {
    req.log.error({ err: error }, "Schedule import preview failed");
    res.status(503).json({ error: "Could not analyze the schedule right now. Please try again." });
  }
});

router.post("/schedule/import-confirm", async (req, res): Promise<void> => {
  const parsed = ConfirmScheduleImportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = getAuth(req).userId!;
  const { courses: proposals, replaceExisting } = parsed.data;
  const courseIds = proposals.flatMap(proposal => proposal.courseId ? [proposal.courseId] : []);
  if (new Set(courseIds).size !== courseIds.length) {
    res.status(400).json({ error: "Each existing course can only be selected once" }); return;
  }
  if (proposals.some(proposal => proposal.meetings.some(meeting => timeToMinutes(meeting.end) <= timeToMinutes(meeting.start)))) {
    res.status(400).json({ error: "Meeting end times must be later than start times" }); return;
  }
  try {
    const savedCount = await db.transaction(async tx => {
      const owned = courseIds.length
        ? await tx.select().from(coursesTable).where(and(
          inArray(coursesTable.id, courseIds),
          eq(coursesTable.ownerId, userId),
          eq(coursesTable.eduEnabled, false),
        ))
        : [];
      if (owned.length !== courseIds.length) throw new Error("COURSE_OWNERSHIP");
      const ownedById = new Map(owned.map(course => [course.id, course]));
      if (proposals.some(proposal => proposal.courseId && (ownedById.get(proposal.courseId)?.meetings?.length ?? 0) > 0) && !replaceExisting) {
        throw new Error("MEETINGS_EXIST");
      }
      for (const proposal of proposals) {
        if (proposal.courseId) {
          await tx.update(coursesTable).set({ meetings: proposal.meetings }).where(and(
            eq(coursesTable.id, proposal.courseId),
            eq(coursesTable.ownerId, userId),
            eq(coursesTable.eduEnabled, false),
          ));
        } else {
          const [created] = await tx.insert(coursesTable).values({
            name: proposal.name,
            subject: proposal.subject,
            term: proposal.term,
            color: proposal.color,
            inviteCode: inviteCode(),
            ownerId: userId,
            meetings: proposal.meetings,
          }).returning();
          await tx.insert(courseMembersTable).values({ courseId: created.id, userId });
        }
      }
      return proposals.length;
    });
    res.json(ConfirmScheduleImportResponse.parse({ savedCount }));
  } catch (error) {
    if (error instanceof Error && error.message === "COURSE_OWNERSHIP") {
      res.status(403).json({ error: "Only the owner can edit a shared course schedule. Remove that course or ask its owner." }); return;
    }
    if (error instanceof Error && error.message === "MEETINGS_EXIST") {
      res.status(409).json({ error: "One or more courses already have meetings. Confirm replacement explicitly or remove those courses from the import." }); return;
    }
    req.log.error({ err: error }, "Schedule import confirmation failed");
    res.status(503).json({ error: "Unable to save the reviewed schedule. Please try again." });
  }
});

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  await ensureDemoData(userId);
  const ids = await accessibleCourseIds(userId);
  const courses = ids.length;
  const [{ lectures, seconds }] = await db
    .select({
      lectures: count(),
      seconds: sql<number>`coalesce(sum(${lecturesTable.durationSeconds}), 0)::int`,
    })
    .from(lecturesTable)
    .where(inArray(lecturesTable.courseId, ids));
  res.json({
    courseCount: courses,
    lectureCount: lectures,
    studyMinutes: Math.round(seconds / 60),
    upcomingItems: [],
  });
});

router.get("/dashboard/glance", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const plan = await planForRequest(req, res);
  if (!plan) return;
  const ids = await accessibleCourseIds(userId);
  if (!ids.length) { res.json({ dueSoon: [], recentPracticeSets: [], recentBookmarks: [] }); return; }
  const courses = await db.select({ id: coursesTable.id, name: coursesTable.name })
    .from(coursesTable).where(inArray(coursesTable.id, ids));
  const names = new Map(courses.map(c => [c.id, c.name]));
  const lectureDates = await db.select().from(academicDatesTable)
    .where(and(inArray(academicDatesTable.courseId, ids), eq(academicDatesTable.confirmed, true)));
  const syllabusDates = await db.select().from(syllabusDatesTable)
    .where(and(inArray(syllabusDatesTable.courseId, ids), eq(syllabusDatesTable.confirmed, true)));
  const now = new Date();
  const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const dueSoon = [
    ...lectureDates.filter(d => d.dueDate).map(d => ({ id: d.id, courseId: d.courseId, courseName: names.get(d.courseId) ?? "", title: d.title, kind: d.kind, dueDate: d.dueDate!, source: "lecture" as const })),
    ...syllabusDates.map(d => ({ id: d.id, courseId: d.courseId, courseName: names.get(d.courseId) ?? "", title: d.title, kind: d.kind, dueDate: d.dueDate, source: "syllabus" as const })),
  ].filter(item => {
    const due = new Date(`${item.dueDate}T00:00:00Z`);
    return due >= new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`) && due <= cutoff;
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 50);
  const practice = await db.select({
    lectureId: lecturesTable.id, lectureTitle: lecturesTable.title, courseId: lecturesTable.courseId,
    analyzedAt: lecturesTable.analyzedAt, studyQuestions: lecturesTable.studyQuestions,
  }).from(lecturesTable).where(and(inArray(lecturesTable.courseId, ids), sql`${lecturesTable.analyzedAt} is not null`))
    .orderBy(desc(lecturesTable.analyzedAt)).limit(5);
  const recentPracticeSets = practice.filter(p => p.analyzedAt).map(p => ({
    ...p,
    studyQuestions: plan === "free" ? [] : p.studyQuestions,
    courseName: names.get(p.courseId) ?? "",
    analyzedAt: p.analyzedAt!,
  }));
  const recentBookmarks = await db.select({
    id: bookmarksTable.id, lectureId: bookmarksTable.lectureId, lectureTitle: lecturesTable.title,
    courseId: lecturesTable.courseId, courseName: coursesTable.name, excerpt: bookmarksTable.excerpt, createdAt: bookmarksTable.createdAt,
  }).from(bookmarksTable).innerJoin(lecturesTable, eq(bookmarksTable.lectureId, lecturesTable.id))
    .innerJoin(coursesTable, eq(lecturesTable.courseId, coursesTable.id))
    .where(and(eq(bookmarksTable.userId, userId), inArray(lecturesTable.courseId, ids)))
    .orderBy(desc(bookmarksTable.createdAt)).limit(5);
  res.json({ dueSoon, recentPracticeSets, recentBookmarks });
});

router.get("/practice/progress", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const plan = await planForRequest(req, res);
  if (!plan) return;
  if (plan === "free") { res.status(403).json({ error: "Practice is available with a Student or Pro plan." }); return; }
  const ids = await accessibleCourseIds(userId);
  if (!ids.length) { res.json(GetPracticeProgressResponse.parse({ answered: 0, correct: 0, topics: [], lectures: [] })); return; }
  const rows = await db.select({
    attempt: practiceAttemptsTable,
    lectureTitle: lecturesTable.title,
    courseName: coursesTable.name,
  }).from(practiceAttemptsTable)
    .innerJoin(lecturesTable, and(
      eq(lecturesTable.id, practiceAttemptsTable.lectureId),
      eq(lecturesTable.courseId, practiceAttemptsTable.courseId),
    ))
    .innerJoin(coursesTable, eq(coursesTable.id, practiceAttemptsTable.courseId))
    .where(and(eq(practiceAttemptsTable.userId, userId), inArray(practiceAttemptsTable.courseId, ids)))
    .orderBy(desc(practiceAttemptsTable.createdAt));
  const topics = new Map<string, { courseId: string; courseName: string; topic: string; answered: number; correct: number; lectureIds: Set<string> }>();
  const lectures = new Map<string, { lectureId: string; courseId: string; title: string; answered: number; correct: number }>();
  for (const { attempt, lectureTitle, courseName } of rows) {
    const key = JSON.stringify([attempt.courseId, attempt.topic.toLowerCase()]);
    const topic = topics.get(key) ?? { courseId: attempt.courseId, courseName, topic: attempt.topic, answered: 0, correct: 0, lectureIds: new Set<string>() };
    topic.answered++; topic.correct += Number(attempt.correct); topic.lectureIds.add(attempt.lectureId); topics.set(key, topic);
    const lecture = lectures.get(attempt.lectureId) ?? { lectureId: attempt.lectureId, courseId: attempt.courseId, title: lectureTitle, answered: 0, correct: 0 };
    lecture.answered++; lecture.correct += Number(attempt.correct); lectures.set(attempt.lectureId, lecture);
  }
  res.json(GetPracticeProgressResponse.parse({
    answered: rows.length, correct: rows.filter(row => row.attempt.correct).length,
    topics: [...topics.values()].map(({ lectureIds, ...topic }) => ({ ...topic, lectureCount: lectureIds.size }))
      .sort((a, b) => a.correct / a.answered - b.correct / b.answered || b.answered - a.answered),
    lectures: [...lectures.values()],
  }));
});

async function ownedCourse(userId: string, id: string) {
  const [course] = await db.select().from(coursesTable).where(and(
    eq(coursesTable.id, id),
    eq(coursesTable.ownerId, userId),
    eq(coursesTable.eduEnabled, false),
  ));
  return course;
}
async function extractPdfText(bytes: Buffer) {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("Invalid PDF signature");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText({ first: 100 });
    if (!result.text.trim()) throw new Error("PDF contains no extractable text");
    return result.text.trim().slice(0, 100000);
  } finally {
    await parser.destroy();
  }
}
function validQuote(text: string, quote: string) {
  return quote.length > 0 && text.includes(quote);
}
function dateString(value: Date | string | null) {
  return calendarDate(value);
}
function isRealCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

router.post("/courses/:id/syllabus/upload", async (req, res): Promise<void> => {
  const { GetSyllabusParams } = await import("@workspace/api-zod");
  const params = GetSyllabusParams.safeParse(req.params);
  const userId = getAuth(req).userId!;
  const mimeType = String(req.headers["content-type"] ?? "").split(";")[0];
  const rawFilename = req.headers["x-filename"];
  let filename = "";
  try {
    filename = typeof rawFilename === "string" ? decodeURIComponent(rawFilename) : "";
  } catch {
    res.status(400).json({ error: "Invalid encoded syllabus filename" }); return;
  }
  if (!params.success || !Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > 10485760 ||
      !["application/pdf", "text/plain"].includes(mimeType) || !filename || filename.length > 255) {
    res.status(400).json({ error: "Send a PDF or UTF-8 text body (max 10MB) and an encoded X-Filename header" }); return;
  }
  if (!(await ownedCourse(userId, params.data.id))) { res.status(403).json({ error: "Only the course owner can upload a syllabus" }); return; }
  try {
    const objectPath = `/objects/syllabi/${params.data.id}/${crypto.randomUUID()}`;
    await objectStorage.uploadObject(objectPath, req.body, mimeType);
    await db.update(coursesTable).set({ syllabusPendingObjectPath: objectPath, syllabusPendingFilename: filename, syllabusPendingMimeType: mimeType, syllabusPendingParsedText: null, syllabusPendingGradeWeights: null }).where(eq(coursesTable.id, params.data.id));
    res.json({ courseId: params.data.id, filename, mimeType, uploadedAt: null, dates: [], modules: [], assignments: [] });
  } catch (error) { req.log.error({ err: error }, "Syllabus upload URL failed"); res.status(503).json({ error: "Unable to prepare syllabus upload; please retry" }); }
});

router.post("/courses/:id/syllabus/preview", async (req, res): Promise<void> => {
  const { PreviewSyllabusParams, PreviewSyllabusResponse } = await import("@workspace/api-zod");
  const params = PreviewSyllabusParams.safeParse(req.params);
  const userId = getAuth(req).userId!;
  if (!params.success) { res.status(400).json({ error: "Invalid course" }); return; }
  const course = await ownedCourse(userId, params.data.id);
  if (!course?.syllabusPendingObjectPath || !course.syllabusPendingMimeType) { res.status(409).json({ error: "Upload a syllabus before previewing it" }); return; }
  try {
    const metadata = await objectStorage.getObjectMetadata(course.syllabusPendingObjectPath);
    if (metadata.size > 10485760) { res.status(413).json({ error: "Syllabus exceeds the 10MB limit" }); return; }
    if (!["application/pdf", "text/plain"].includes(metadata.contentType) || metadata.contentType !== course.syllabusPendingMimeType) { res.status(415).json({ error: "Uploaded object type is not allowed" }); return; }
    const [bytes] = await metadata.file.download({ validation: false });
    const text = course.syllabusPendingMimeType === "text/plain"
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 100000)
      : await extractPdfText(bytes);
    if (!text.trim()) { res.status(422).json({ error: "The syllabus contains no extractable text" }); return; }
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna", store: false, response_format: { type: "json_object" }, max_completion_tokens: 8192,
      messages: [
        { role: "system", content: "Extract a syllabus course plan. Return JSON {proposedName:string,proposedSubject:string,proposedTerm:string,dates:{title:string,kind:'assignment'|'exam',dueDate:string|null,sourceText:string}[],modules:{title:string,sourceText:string}[],assignments:{title:string,type:'homework'|'reading'|'quiz'|'exam'|'project',dueDate:string|null,sourceText:string}[],gradingWeights:{category:string,weight:number,sourceText:string}[]}. Grading weights are percentages for explicit grading categories only (e.g. Exams 40%); never invent them or turn an individual assignment's possible points into a category weight. Modules are named units/sections in syllabus order. Assignments include explicit homework, readings, quizzes, exams and projects even without dates. dates includes ONLY explicitly dated assignments/exams; do not infer a date. Every sourceText must be an exact short quote from the syllabus supporting the item or weight. Dates must be real YYYY-MM-DD calendar dates or null. Do not invent items. Return empty arrays when absent." },
        { role: "user", content: text.slice(0, 100000) },
      ],
    });
    const rawProposal = JSON.parse(completion.choices[0]?.message.content ?? "{}");
    if (!rawProposal || !Array.isArray(rawProposal.dates) || !Array.isArray(rawProposal.modules) || !Array.isArray(rawProposal.assignments) ||
        rawProposal.dates.some((d: any) => d?.dueDate != null && !isRealCalendarDate(d.dueDate)) ||
        rawProposal.assignments.some((a: any) => a?.dueDate != null && !isRealCalendarDate(a.dueDate))) {
      res.status(502).json({ error: "Syllabus analysis returned an invalid date format; please retry" }); return;
    }
    const parsed = PreviewSyllabusResponse.parse(rawProposal);
    const { dates, modules, assignments } = normalizeSyllabusPreview(parsed, text);
    await db.update(coursesTable).set({ syllabusPendingParsedText: text, syllabusPendingGradeWeights: proposedWeights(rawProposal.gradingWeights, text) }).where(eq(coursesTable.id, course.id));
    res.json({ ...parsed, dates, modules, assignments });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) { res.status(409).json({ error: "Syllabus upload is not available yet; retry after uploading" }); return; }
    req.log.error({ err: error }, "Syllabus preview failed"); res.status(503).json({ error: "Unable to preview syllabus; please retry" });
  }
});

router.post("/courses/:id/syllabus/confirm", async (req, res): Promise<void> => {
  const { ConfirmSyllabusParams, ConfirmSyllabusBody, ConfirmSyllabusResponse } = await import("@workspace/api-zod");
  const params = ConfirmSyllabusParams.safeParse(req.params); const body = ConfirmSyllabusBody.safeParse(req.body);
  const userId = getAuth(req).userId!;
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid syllabus confirmation" }); return; }
  const course = await ownedCourse(userId, params.data.id);
  if (!course) { res.status(403).json({ error: "Only the course owner can confirm a syllabus" }); return; }
  if (!course.syllabusPendingObjectPath || !course.syllabusPendingParsedText) { res.status(409).json({ error: "Preview the pending syllabus before confirming it" }); return; }
  const text = course.syllabusPendingParsedText ?? "";
  const rawDates = Array.isArray(req.body?.selectedDates) ? req.body.selectedDates : [];
  const rawAssignments = Array.isArray(req.body?.selectedAssignments) ? req.body.selectedAssignments : [];
  if (rawDates.some((d: any) => d?.dueDate != null && !isRealCalendarDate(d.dueDate)) ||
      rawAssignments.some((a: any) => a?.dueDate != null && !isRealCalendarDate(a.dueDate))) {
    res.status(400).json({ error: "Dates must use exact YYYY-MM-DD format" }); return;
  }
  if (body.data.selectedDates.some(d => !d.dueDate || !validQuote(text, d.sourceText))) { res.status(400).json({ error: "Each selected date needs a valid date and exact source quote" }); return; }
  if ((body.data.selectedModules ?? []).some(m => !m.title.trim() || !validQuote(text, m.sourceText)) ||
      (body.data.selectedAssignments ?? []).some(a => !a.title.trim() || !validQuote(text, a.sourceText))) {
    res.status(400).json({ error: "Each selected item needs a title and exact source quote" }); return;
  }
  // Coursework selection is independent of date tracking: only dates selected in the
  // dedicated dates list become confirmed due dates. Collapse whitespace to match
  // coursework identity matching, but do not guess when either side has duplicates.
  const datesByTitle = new Map<string, typeof body.data.selectedDates>();
  for (const date of body.data.selectedDates) {
    const key = syllabusTitleKey(date.title);
    datesByTitle.set(key, [...(datesByTitle.get(key) ?? []), date]);
  }
  const assignmentsByTitle = new Map<string, number[]>();
  (body.data.selectedAssignments ?? []).forEach((assignment, index) => {
    const key = syllabusTitleKey(assignment.title);
    assignmentsByTitle.set(key, [...(assignmentsByTitle.get(key) ?? []), index]);
  });
  const confirmedDueDates = new Map<string, string>();
  for (const [key, dates] of datesByTitle) {
    if (dates.length === 1 && assignmentsByTitle.get(key)?.length === 1) {
      confirmedDueDates.set(key, dateString(dates[0].dueDate)!);
    }
  }
  const result = await db.transaction(async tx => {
    if (!course.syllabusPendingObjectPath || !course.syllabusPendingFilename || !course.syllabusPendingMimeType) throw new Error("No pending syllabus upload");
    const [updated] = await tx.update(coursesTable).set({
      name: body.data.name, subject: body.data.subject, term: body.data.term,
      syllabusObjectPath: course.syllabusPendingObjectPath,
      syllabusFilename: course.syllabusPendingFilename,
      syllabusMimeType: course.syllabusPendingMimeType,
      syllabusGradeWeights: course.syllabusPendingGradeWeights ?? [],
      syllabusPendingObjectPath: null, syllabusPendingFilename: null, syllabusPendingMimeType: null,
      syllabusPendingGradeWeights: null,
      syllabusPendingParsedText: null, syllabusParsedText: course.syllabusPendingParsedText,
      syllabusUploadedAt: new Date(),
    }).where(eq(coursesTable.id, course.id)).returning();
    await tx.delete(syllabusDatesTable).where(eq(syllabusDatesTable.courseId, course.id));
    if (body.data.selectedDates.length) await tx.insert(syllabusDatesTable).values(body.data.selectedDates.map(d => ({ courseId: course.id, title: d.title, kind: d.kind, dueDate: dateString(d.dueDate)!, sourceText: d.sourceText, confirmed: true })));
    if (body.data.selectedModules !== undefined) {
      await tx.delete(courseModulesTable).where(eq(courseModulesTable.courseId, course.id));
      if (body.data.selectedModules.length) await tx.insert(courseModulesTable).values(body.data.selectedModules.map((m, position) => ({ courseId: course.id, title: m.title.trim(), sourceText: m.sourceText, position })));
    }
    if (body.data.selectedAssignments !== undefined) {
      const previous = await tx.select().from(syllabusAssignmentsTable).where(eq(syllabusAssignmentsTable.courseId, course.id));
      const next = body.data.selectedAssignments.map((a, position) => ({
        courseId: course.id, title: a.title.trim(), type: a.type, sourceText: a.sourceText, position,
        dueDate: confirmedDueDates.get(syllabusTitleKey(a.title)) ?? null,
      }));
      const matches = matchCoursework(previous, next);
      const matchedIds = new Set(matches.values());
      const removed = previous.filter(item => !matchedIds.has(item.id)).map(item => item.id);
      if (removed.length) await tx.delete(syllabusAssignmentsTable).where(inArray(syllabusAssignmentsTable.id, removed));
      for (const [index, id] of matches) {
        await tx.update(syllabusAssignmentsTable).set(next[index]).where(eq(syllabusAssignmentsTable.id, id));
      }
      const added = next.filter((_, index) => !matches.has(index));
      if (added.length) await tx.insert(syllabusAssignmentsTable).values(added);
    }
    const dates = await tx.select().from(syllabusDatesTable).where(eq(syllabusDatesTable.courseId, course.id));
    const modules = await tx.select().from(courseModulesTable).where(eq(courseModulesTable.courseId, course.id)).orderBy(asc(courseModulesTable.position));
    const assignments = await tx.select().from(syllabusAssignmentsTable).where(eq(syllabusAssignmentsTable.courseId, course.id)).orderBy(asc(syllabusAssignmentsTable.position));
    return { course: updated, dates, modules, assignments };
  });
  res.json({ courseId: result.course.id, filename: result.course.syllabusFilename, mimeType: result.course.syllabusMimeType, uploadedAt: result.course.syllabusUploadedAt, dates: syllabusDateLinks(result.dates, result.assignments), modules: result.modules, assignments: await personalAssignments(result.assignments, userId) });
});

router.get("/courses/:id/syllabus", async (req, res): Promise<void> => {
  const course = await db.select().from(coursesTable).where(eq(coursesTable.id, String(req.params.id))).then(r => r[0]);
  if (!course || !(await canAccessCourse(getAuth(req).userId!, course.id))) { res.status(404).json({ error: "Course not found" }); return; }
  const dates = await db.select().from(syllabusDatesTable).where(eq(syllabusDatesTable.courseId, course.id));
  const modules = await db.select().from(courseModulesTable).where(eq(courseModulesTable.courseId, course.id)).orderBy(asc(courseModulesTable.position));
  const assignments = await db.select().from(syllabusAssignmentsTable).where(eq(syllabusAssignmentsTable.courseId, course.id)).orderBy(asc(syllabusAssignmentsTable.position));
  res.json({ courseId: course.id, filename: course.syllabusFilename, mimeType: course.syllabusMimeType, uploadedAt: course.syllabusUploadedAt, dates: syllabusDateLinks(dates, assignments), modules, assignments: await personalAssignments(assignments, getAuth(req).userId!) });
});

router.get("/syllabus/assignments", async (req, res): Promise<void> => {
  const ids = await accessibleCourseIds(getAuth(req).userId!);
  if (!ids.length) { res.json([]); return; }
  const rows = await db.select({ assignment: syllabusAssignmentsTable, courseName: coursesTable.name })
    .from(syllabusAssignmentsTable).innerJoin(coursesTable, eq(syllabusAssignmentsTable.courseId, coursesTable.id))
    .where(inArray(syllabusAssignmentsTable.courseId, ids))
    .orderBy(asc(coursesTable.name), asc(syllabusAssignmentsTable.position));
  const personal = await personalAssignments(rows.map(row => row.assignment), getAuth(req).userId!);
  res.json(personal.map((assignment, i) => ({ ...assignment, courseName: rows[i].courseName })));
});

router.put("/syllabus/assignments/:id/completion", async (req, res): Promise<void> => {
  const params = SetSyllabusAssignmentCompletionParams.safeParse(req.params);
  const body = SetSyllabusAssignmentCompletionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid completion request" }); return; }
  const userId = getAuth(req).userId!;
  const [assignment] = await db.select({ courseId: syllabusAssignmentsTable.courseId })
    .from(syllabusAssignmentsTable).where(eq(syllabusAssignmentsTable.id, params.data.id));
  if (!assignment || !(await canAccessCourse(userId, assignment.courseId))) {
    res.status(404).json({ error: "Coursework not found" }); return;
  }
  const where = and(eq(syllabusAssignmentCompletionsTable.userId, userId), eq(syllabusAssignmentCompletionsTable.assignmentId, params.data.id));
  if (body.data.completed) {
    await db.insert(syllabusAssignmentCompletionsTable).values({ userId, assignmentId: params.data.id })
      .onConflictDoNothing();
  } else {
    await db.delete(syllabusAssignmentCompletionsTable).where(where);
  }
  res.json({ completed: body.data.completed });
});

router.get("/syllabus/modules", async (req, res): Promise<void> => {
  const ids = await accessibleCourseIds(getAuth(req).userId!);
  if (!ids.length) { res.json([]); return; }
  const rows = await db.select({ module: courseModulesTable, courseName: coursesTable.name })
    .from(courseModulesTable).innerJoin(coursesTable, eq(courseModulesTable.courseId, coursesTable.id))
    .where(inArray(courseModulesTable.courseId, ids))
    .orderBy(asc(coursesTable.name), asc(courseModulesTable.position));
  res.json(rows.map(row => ({ ...row.module, courseName: row.courseName })));
});

router.get("/courses/:id/syllabus/file", async (req, res): Promise<void> => {
  const course = await db.select().from(coursesTable).where(eq(coursesTable.id, String(req.params.id))).then(r => r[0]);
  if (!course || !(await canAccessCourse(getAuth(req).userId!, course.id))) { res.status(404).json({ error: "Course not found" }); return; }
  if (!course.syllabusObjectPath) { res.status(404).json({ error: "Syllabus file not found" }); return; }
  try {
    const metadata = await objectStorage.getObjectMetadata(course.syllabusObjectPath);
    if (metadata.size > 10485760 || !["application/pdf", "text/plain"].includes(metadata.contentType) || metadata.contentType !== course.syllabusMimeType) { res.status(415).json({ error: "Stored syllabus file is invalid" }); return; }
    const file = metadata.file;
    res.type(course.syllabusMimeType ?? "application/octet-stream");
    Readable.from(file.createReadStream()).pipe(res);
  } catch (error) { req.log.warn({ err: error }, "Syllabus file unavailable"); res.status(404).json({ error: "Syllabus file not found" }); }
});

router.get("/courses", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  await ensureDemoData(userId);
  res.json(await courseResponse(userId));
});

router.post("/courses", async (req, res): Promise<void> => {
  const parsed = CreateCourseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getAuth(req).userId!;
  const billingIdentity = await modernBillingIdentity(userId, (error) =>
    req.log.warn({ err: error }, "Linked library unavailable; applying Free course limit"),
  );
  let billingStatus: Awaited<ReturnType<typeof getLibraryBillingStatus>>;
  try {
    billingStatus = await getLibraryBillingStatus(billingIdentity.libraryCode);
  } catch (error) {
    if (error instanceof BillingError) {
      res.status(error.httpStatus).json({ code: error.code, error: error.message });
      return;
    }
    throw error;
  }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`modern-course-create:${userId}`}, 0))`);
    const [ownedCount] = await tx.select({ total: count() }).from(coursesTable)
      .where(and(eq(coursesTable.ownerId, userId), eq(coursesTable.eduEnabled, false)));
    const planIsCurrent = billingStatus.plan !== "free" &&
      typeof billingStatus.periodEnd === "string" &&
      Number.isFinite(Date.parse(billingStatus.periodEnd)) &&
      Date.parse(billingStatus.periodEnd) > Date.now();
    const plan = planIsCurrent ? billingStatus.plan : "free";
    const courseLimit = planIsCurrent ? billingStatus.courseLimit : 3;
    if (courseLimit !== null && ownedCount.total >= courseLimit) {
      return { course: undefined, plan, courseLimit };
    }
    const [created] = await tx.insert(coursesTable)
      .values({ ...parsed.data, inviteCode: inviteCode(), ownerId: userId }).returning();
    await tx.insert(courseMembersTable).values({ courseId: created.id, userId });
    return { course: created, plan, courseLimit };
  });
  if (!result.course) {
    res.status(402).json({
      code: "plan_limit",
      error: "Free includes up to 3 courses. Upgrade your plan to create more.",
      billing: {
        plan: result.plan,
        courseLimit: result.courseLimit,
      },
    });
    return;
  }
  const course = result.course;
  res.status(201).json({ ...publicCourse(course), isOwner: true, lectureCount: 0, memberCount: 1 });
});

router.patch("/courses/:id", async (req, res): Promise<void> => {
  const params = UpdateCourseParams.safeParse(req.params);
  const body = UpdateCourseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid course update" });
    return;
  }
  const [owned] = await db.select({ id: coursesTable.id }).from(coursesTable)
    .where(and(eq(coursesTable.id, params.data.id), eq(coursesTable.ownerId, getAuth(req).userId!)));
  if (!owned) { res.status(403).json({ error: "Only the course owner can edit settings" }); return; }
  const [course] = await db
    .update(coursesTable)
    .set(body.data)
    .where(eq(coursesTable.id, params.data.id))
    .returning();
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  const lectures = await db
    .select({ value: count() })
    .from(lecturesTable)
    .where(eq(lecturesTable.courseId, course.id));
  res.json({ ...publicCourse(course), isOwner: true, lectureCount: lectures[0].value, memberCount: await memberCount(course.id, course.ownerId) });
});

router.get("/courses/:id/lectures", async (req, res): Promise<void> => {
  const params = ListCourseLecturesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const plan = await planForRequest(req, res);
  if (!plan) return;
  res.json(
    await db
      .select()
      .from(lecturesTable)
      .where(eq(lecturesTable.courseId, params.data.id))
       .orderBy(desc(lecturesTable.lectureDate)).then(rows => rows.map(row => publicLecture(row, plan !== "free"))),
  );
});

router.get("/courses/:id/dates", async (req, res): Promise<void> => {
  const params = ListCourseDatesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid course" }); return; }
  res.json(await db.select().from(academicDatesTable)
    .where(eq(academicDatesTable.courseId, params.data.id))
    .orderBy(asc(academicDatesTable.dueDate)));
});

router.get("/lectures/:id/dates", async (req, res): Promise<void> => {
  const params = ListLectureDatesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid lecture" }); return; }
  res.json(await db.select().from(academicDatesTable)
    .where(eq(academicDatesTable.lectureId, params.data.id))
    .orderBy(asc(academicDatesTable.dueDate)));
});

router.get("/bookmarks", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const ids = await accessibleCourseIds(userId);
  if (!ids.length) { res.json([]); return; }
  const rows = await db.select({
    id: bookmarksTable.id, lectureId: bookmarksTable.lectureId, lectureTitle: lecturesTable.title,
    courseId: lecturesTable.courseId, courseName: coursesTable.name, excerpt: bookmarksTable.excerpt, createdAt: bookmarksTable.createdAt,
  }).from(bookmarksTable).innerJoin(lecturesTable, eq(bookmarksTable.lectureId, lecturesTable.id))
    .innerJoin(coursesTable, eq(lecturesTable.courseId, coursesTable.id))
    .where(and(eq(bookmarksTable.userId, userId), inArray(lecturesTable.courseId, ids))).orderBy(desc(bookmarksTable.createdAt));
  res.json(rows);
});

router.post("/lectures/:id/bookmarks", async (req, res): Promise<void> => {
  const params = CreateBookmarkParams.safeParse(req.params);
  const body = CreateBookmarkBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid bookmark" }); return; }
  const [lecture] = await db.select({ id: lecturesTable.id, courseId: lecturesTable.courseId }).from(lecturesTable).where(eq(lecturesTable.id, params.data.id));
  if (!lecture || !(await canAccessCourse(getAuth(req).userId!, lecture.courseId))) { res.status(404).json({ error: "Lecture not found" }); return; }
  const [bookmark] = await db.insert(bookmarksTable).values({ userId: getAuth(req).userId!, lectureId: lecture.id, excerpt: body.data.excerpt }).returning();
  const [result] = await db.select({
    id: bookmarksTable.id, lectureId: bookmarksTable.lectureId, lectureTitle: lecturesTable.title,
    courseId: lecturesTable.courseId, courseName: coursesTable.name, excerpt: bookmarksTable.excerpt, createdAt: bookmarksTable.createdAt,
  }).from(bookmarksTable).innerJoin(lecturesTable, eq(bookmarksTable.lectureId, lecturesTable.id))
    .innerJoin(coursesTable, eq(lecturesTable.courseId, coursesTable.id)).where(eq(bookmarksTable.id, bookmark.id));
  res.status(201).json(result);
});

router.delete("/bookmarks/:id", async (req, res): Promise<void> => {
  const params = DeleteBookmarkParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid bookmark" }); return; }
  const deleted = await db.delete(bookmarksTable).where(and(eq(bookmarksTable.id, params.data.id), eq(bookmarksTable.userId, getAuth(req).userId!))).returning();
  if (!deleted.length) { res.status(404).json({ error: "Bookmark not found" }); return; }
  res.sendStatus(204);
});

router.patch("/dates/:id", async (req, res): Promise<void> => {
  const params = UpdateAcademicDateParams.safeParse(req.params);
  const body = UpdateAcademicDateBody.safeParse(req.body);
  const rawDate = req.body?.dueDate;
  if (!params.success || !body.success || !Object.keys(body.data).length ||
      (body.data.confirmed === true && body.data.dueDate === null) ||
      (body.success && body.data.title !== undefined && !body.data.title.trim()) ||
      (rawDate != null && (typeof rawDate !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) ||
        body.data.dueDate?.toISOString().slice(0, 10) !== rawDate))) {
    res.status(400).json({ error: "Invalid date update" }); return;
  }
  const [existing] = await db.select().from(academicDatesTable).where(eq(academicDatesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Date not found" }); return; }
  if (!(await isCourseOwner(getAuth(req).userId!, existing.courseId))) {
    res.status(403).json({ error: "Only the course owner can edit academic dates" }); return;
  }
  if (body.data.confirmed === true && !(body.data.dueDate ?? existing.dueDate)) {
    res.status(400).json({ error: "Choose a date before confirming" }); return;
  }
  const dueDate = body.data.dueDate === undefined ? undefined : body.data.dueDate?.toISOString().slice(0, 10) ?? null;
  const [updated] = await db.update(academicDatesTable)
    .set({ title: body.data.title, dueDate,
      confirmed: dueDate === null ? false : body.data.confirmed ?? (dueDate !== undefined ? false : existing.confirmed) })
    .where(eq(academicDatesTable.id, params.data.id)).returning();
  res.json(updated);
});

router.post("/lectures", async (req, res): Promise<void> => {
  const parsed = CreateLectureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await canAccessCourse(getAuth(req).userId!, parsed.data.courseId))) {
    res.status(404).json({ error: "Course not found" }); return;
  }
  const [lecture] = await db
    .insert(lecturesTable)
    .values({ ...parsed.data, createdBy: getAuth(req).userId!, lectureDate: new Date(parsed.data.lectureDate) })
    .returning();
  res.status(201).json(lecture);
});

router.get("/lectures/:id", async (req, res): Promise<void> => {
  const params = GetLectureParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [lecture] = await db.select().from(lecturesTable).where(eq(lecturesTable.id, params.data.id));
  if (!lecture || !(await canAccessCourse(getAuth(req).userId!, lecture.courseId))) {
    res.status(404).json({ error: "Lecture not found" });
    return;
  }
  const plan = await planForRequest(req, res);
  if (!plan) return;
  res.json(publicLecture(lecture, plan !== "free"));
});

router.post("/lectures/:id/practice-attempts", async (req, res): Promise<void> => {
  const body = SubmitPracticeAttemptBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid practice answer" }); return; }
  const [lecture] = await db.select().from(lecturesTable).where(eq(lecturesTable.id, String(req.params.id)));
  if (!lecture || !(await canAccessCourse(getAuth(req).userId!, lecture.courseId))) {
    res.status(404).json({ error: "Lecture not found" }); return;
  }
  const plan = await planForRequest(req, res);
  if (!plan) return;
  if (plan === "free") { res.status(403).json({ error: "Practice is available with a Student or Pro plan." }); return; }
  const question = lecture.quizQuestions.find(q => q.id === body.data.questionId);
  if (!question) { res.status(409).json({ error: "Question is no longer in the saved set. Reload the lecture." }); return; }
  if (body.data.selectedIndex >= question.options.length) { res.status(400).json({ error: "Invalid option" }); return; }
  const [attempt] = await db.insert(practiceAttemptsTable).values({
    userId: getAuth(req).userId!, courseId: lecture.courseId, lectureId: lecture.id,
    questionId: question.id, topic: question.topic,
    selectedIndex: body.data.selectedIndex, correct: body.data.selectedIndex === question.correctIndex,
  }).returning();
  res.status(201).json(SubmitPracticeAttemptResponse.parse({
    id: attempt.id, lectureId: lecture.id, questionId: question.id,
    selectedIndex: attempt.selectedIndex, correctIndex: question.correctIndex,
    correct: attempt.correct, createdAt: attempt.createdAt,
  }));
});

router.patch("/lectures/:id", async (req, res): Promise<void> => {
  const params = UpdateLectureParams.safeParse(req.params);
  const body = UpdateLectureBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid lecture update" });
    return;
  }
  const [existing] = await db.select().from(lecturesTable)
    .where(eq(lecturesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Lecture not found" });
    return;
  }
  if (!(await canMutateLecture(getAuth(req).userId!, existing))) {
    res.status(403).json({ error: "Only the course owner or lecture creator can edit this lecture" });
    return;
  }
  const [lecture] = await db.update(lecturesTable)
    .set(body.data)
    .where(eq(lecturesTable.id, params.data.id))
    .returning();
  if (!lecture) {
    res.status(404).json({ error: "Lecture not found" });
    return;
  }
  const plan = await planForRequest(req, res);
  if (!plan) return;
  res.json(publicLecture(lecture, plan !== "free"));
});

router.delete("/lectures/:id", async (req, res): Promise<void> => {
  const params = DeleteLectureParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db.select().from(lecturesTable)
    .where(eq(lecturesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Lecture not found" }); return; }
  if (!(await canMutateLecture(getAuth(req).userId!, existing))) {
    res.status(403).json({ error: "Only the course owner or lecture creator can delete this lecture" }); return;
  }
  let library: Awaited<ReturnType<typeof requirePrivacyLibrary>>;
  try {
    library = await requirePrivacyLibrary(req);
  } catch (error) {
    const status = error && typeof error === "object" &&
      "status" in error && typeof error.status === "number" ? error.status : 503;
    res.status(status).json({ error: "Could not verify your private library before deletion." });
    return;
  }
  const deleted = await db.transaction(async tx => {
    await tx.delete(classscribeConsentsTable)
      .where(eq(classscribeConsentsTable.lectureId, params.data.id));
    return tx.delete(lecturesTable).where(eq(lecturesTable.id, params.data.id)).returning();
  });
  if (!deleted.length) {
    res.status(404).json({ error: "Lecture not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/lectures/:id/transcribe", async (req, res): Promise<void> => {
  const params = TranscribeLectureParams.safeParse(req.params);
  const body = TranscribeLectureBody.extend({
    consentId: z.string().uuid(),
    sessionId: z.string().min(1).max(200),
  }).safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid audio recording" });
    return;
  }
  const [lecture] = await db.select().from(lecturesTable).where(eq(lecturesTable.id, params.data.id));
  if (!lecture) { res.status(404).json({ error: "Lecture not found" }); return; }
  if (!(await canMutateLecture(getAuth(req).userId!, lecture))) {
    res.status(403).json({ error: "Only the course owner or lecture creator can transcribe this lecture" }); return;
  }
  try {
    const library = await requirePrivacyLibrary(req);
    if (!await hasPrivacyConsent(
      library.libraryHash,
      body.data.consentId,
      body.data.sessionId,
      lecture.id,
      lecture.courseId,
    )) {
      res.status(409).json({
        code: "recording_consent_required",
        error: "Save current consent for this recording session, lecture, and course before submitting its audio.",
      });
      return;
    }
  } catch (error) {
    const status = error && typeof error === "object" &&
      "status" in error && typeof error.status === "number" ? error.status : 503;
    res.status(status).json({
      code: "privacy_library_unavailable",
      error: "Could not verify your private library before transcription.",
    });
    return;
  }
  const { audioBase64, fileName, mimeType } = body.data;
  if (
    !audioBase64 ||
    audioBase64.length > 36 * 1024 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(audioBase64)
  ) {
    res.status(400).json({ error: "Invalid audio recording" });
    return;
  }
  const bytes = Buffer.from(audioBase64, "base64");
  if (bytes.length > 25 * 1024 * 1024) {
    res.status(413).json({ error: "Recording is over 25 MB. Record in shorter parts." });
    return;
  }
  const audioMimeType = mimeType.split(";")[0].trim().toLowerCase();
  const allowedMime = new Set([
    "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav",
    "audio/webm", "audio/aac", "audio/x-caf", "audio/ogg",
  ]);
  if (!allowedMime.has(audioMimeType)) {
    res.status(400).json({ error: "Unsupported audio MIME type" });
    return;
  }
  let durationSeconds: number;
  try {
    const metadata = await parseBuffer(new Uint8Array(bytes), {
      mimeType: audioMimeType,
      size: bytes.byteLength,
    });
    const duration = metadata.format.duration;
    if (typeof duration !== "number" || !Number.isFinite(duration) ||
      duration <= 0 || duration > 12 * 60 * 60) {
      throw new Error("Audio duration is missing or out of range");
    }
    durationSeconds = Math.ceil(duration);
  } catch {
    res.status(400).json({
      error: "Could not read the recording duration. Export the recording again and retry.",
    });
    return;
  }

  const userId = getAuth(req).userId!;
  const billingIdentity = await modernBillingIdentity(userId, (error) =>
    req.log.warn({ err: error }, "Linked library unavailable; applying Free transcription limit"),
  );
  if (billingIdentity.linked) {
    await mergeFreeOwnerUsageIntoLibrary(userId, billingIdentity.libraryCode);
  }
  const transcriptionId = `modern-lecture:${params.data.id}:${crypto.randomUUID()}`;
  const reservation = await reserveTranscriptionUsage(
    billingIdentity.libraryCode,
    durationSeconds,
    transcriptionId,
  );
  if (!reservation.allowed) {
    if (reservation.limit === "inProgress") {
      res.status(409).json({ error: "This lecture is already being transcribed. Please retry shortly." });
      return;
    }
    res.status(402).json({
      code: "plan_limit",
      error: reservation.limit === "transcriptionCount"
        ? `You've reached your monthly transcription limit of ${reservation.status.transcriptionCountLimit}. Upgrade your plan or try again next month.`
        : `You've used all ${reservation.status.recordingHoursLimit} transcription hours for this month. Upgrade your plan or try again next month.`,
      billing: reservation.status,
    });
    return;
  }

  const safeName = /^[A-Za-z0-9_. -]{1,120}$/.test(fileName) ? fileName : "lecture.webm";
  const file = new File([new Uint8Array(bytes)], safeName, { type: audioMimeType });
  let transcriptionSaved = false;
  let transcript = "";
  try {
    const result = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      response_format: "json",
    });
    await db.update(lecturesTable)
      .set({ transcript: result.text })
      .where(eq(lecturesTable.id, params.data.id));
    await finishTranscriptionUsage(
      billingIdentity.libraryCode,
      transcriptionId,
      reservation.month,
    );
    transcriptionSaved = true;
    transcript = result.text;
  } catch (error) {
    req.log.error({ err: error }, "Modern lecture transcription failed");
  } finally {
    if (!transcriptionSaved) {
      try {
        const currentIdentity = await modernBillingIdentity(userId);
        if (currentIdentity.linked) {
          await mergeFreeOwnerUsageIntoLibrary(userId, currentIdentity.libraryCode);
          await releaseTranscriptionUsage(
            currentIdentity.libraryCode,
            transcriptionId,
            reservation.month,
          );
        } else {
          await releaseTranscriptionUsage(
            billingIdentity.libraryCode,
            transcriptionId,
            reservation.month,
          );
        }
      } catch (error) {
        req.log.error({ err: error }, "Could not release failed modern transcription reservation");
      }
    }
  }
  if (!transcriptionSaved) {
    res.status(503).json({ error: "Unable to transcribe this recording right now. Please retry." });
    return;
  }
  res.json({ transcript });
});

router.post("/lectures/:id/analyze", async (req, res): Promise<void> => {
  const params = AnalyzeLectureParams.safeParse(req.params);
  const body = AnalyzeLectureBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid lecture transcript" });
    return;
  }
  const [lecture] = await db.select().from(lecturesTable).where(eq(lecturesTable.id, params.data.id));
  if (!lecture) { res.status(404).json({ error: "Lecture not found" }); return; }
  if (!(await canMutateLecture(getAuth(req).userId!, lecture))) {
    res.status(403).json({ error: "Only the course owner or lecture creator can analyze this lecture" }); return;
  }
  const plan = await planForRequest(req, res);
  if (!plan) return;
  const examFeaturesEnabled = plan === "student" || plan === "pro";
  const completion = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    store: false,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          `Return JSON with summary:string, keyPoints:string[], definitions:string[], discussion:string[], studyQuestions:string[], quizQuestions:{topic:string,prompt:string,options:string[],correctIndex:number}[], dates:{title:string, kind:'assignment'|'exam', dueDate:string|null, sourceText:string}[]. ${
            examFeaturesEnabled
              ? "Generate useful studyQuestions and 2-5 multiple-choice quizQuestions from facts explicitly in the lecture, with exactly 4 distinct plausible options and one unambiguous correct answer. topic is a short concept name, reuse the same topic name for questions about the same concept. If the transcript does not support a reliable answer, omit that question; an empty quizQuestions array is valid."
              : "Generate a basic lecture summary, key points, definitions, and discussion only. Set studyQuestions and quizQuestions to empty arrays; do not generate exam or practice questions."
          } Extract only assignments and exams explicitly mentioned in the lecture. Resolve relative dates using the lecture date supplied by the user. dueDate must be YYYY-MM-DD, or null if the exact calendar day cannot be determined. sourceText is a short exact quote supporting each item. Do not guess missing dates. Base every claim only on the supplied lecture.`,
      },
      {
        role: "user",
        content: `Lecture date: ${lecture.lectureDate.toISOString().slice(0, 10)}. Explain at ${body.data.difficulty} level.\n\n${body.data.transcript}`,
      },
    ],
  });
   const raw = JSON.parse(completion.choices[0]?.message.content ?? "{}");
   type GeneratedQuestion = { topic: string; prompt: string; options: string[]; correctIndex: number };
   function validQuestion(q: unknown): q is GeneratedQuestion {
     if (typeof q !== "object" || q === null) return false;
     const item = q as Record<string, unknown>;
     return typeof item.topic === "string" && item.topic.trim().length > 0 && item.topic.length <= 120 &&
       typeof item.prompt === "string" && item.prompt.trim().length > 0 && item.prompt.length <= 1000 &&
       Array.isArray(item.options) && item.options.length === 4 &&
       item.options.every(o => typeof o === "string" && o.trim().length > 0 && o.length <= 500) &&
       Number.isInteger(item.correctIndex) && (item.correctIndex as number) >= 0 && (item.correctIndex as number) < 4;
   }
   if (!Array.isArray(raw.quizQuestions) || raw.quizQuestions.length > 10 || !raw.quizQuestions.every(validQuestion)) {
     res.status(502).json({ error: "Practice questions could not be generated. Please retry." }); return;
   }
   const generatedQuestions: GeneratedQuestion[] = examFeaturesEnabled ? raw.quizQuestions : [];
   const quizQuestions = generatedQuestions
     .filter(q => new Set(q.options.map(o => o.toLowerCase())).size === q.options.length)
     .map(q => ({ ...q, id: crypto.randomUUID() }));
   const parsedAnalysis = AnalyzeLectureResponse.parse({ ...raw, quizQuestions: quizQuestions.map(({ correctIndex: _correctIndex, ...q }) => q) });
   const analysis = {
    ...parsedAnalysis,
     studyQuestions: examFeaturesEnabled ? parsedAnalysis.studyQuestions : [],
     quizQuestions: examFeaturesEnabled ? parsedAnalysis.quizQuestions : [],
    dates: parsedAnalysis.dates.filter(item => item.title.trim() && item.sourceText.trim())
      .map(item => ({ ...item, dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null })),
  };
  await db.transaction(async tx => {
    await tx.update(lecturesTable).set({
      transcript: body.data.transcript,
      summary: analysis.summary,
      keyPoints: analysis.keyPoints,
      definitions: analysis.definitions,
      studyQuestions: analysis.studyQuestions,
       quizQuestions,
      analyzedAt: new Date(),
    }).where(eq(lecturesTable.id, params.data.id));
    await tx.delete(academicDatesTable).where(and(
      eq(academicDatesTable.lectureId, lecture.id),
      eq(academicDatesTable.confirmed, false),
    ));
    const confirmed = await tx.select().from(academicDatesTable).where(and(
      eq(academicDatesTable.lectureId, lecture.id),
      eq(academicDatesTable.confirmed, true),
    ));
    const dates = analysis.dates.filter(item => !confirmed.some(saved =>
      saved.kind === item.kind && saved.title.toLowerCase() === item.title.toLowerCase() && saved.dueDate === item.dueDate));
    if (dates.length) await tx.insert(academicDatesTable).values(dates.map(item => ({
      ...item, lectureId: lecture.id, courseId: lecture.courseId,
    })));
  });
  res.json(analysis);
});

router.get("/courses/:id/comments", async (req, res): Promise<void> => {
  const params = ListCourseCommentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await canAccessCourse(getAuth(req).userId!, params.data.id))) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  const comments = await db
    .select()
    .from(courseCommentsTable)
    .where(eq(courseCommentsTable.courseId, params.data.id))
    .orderBy(asc(courseCommentsTable.createdAt));
  res.json(await Promise.all(comments.map(async comment => ({
    ...comment,
    authorName: await courseCommentAuthorName(req, comment.authorId, comment.authorName),
  }))));
});

router.post("/courses/:id/comments", async (req, res): Promise<void> => {
  const params = CreateCourseCommentParams.safeParse(req.params);
  const body = CreateCourseCommentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid discussion message" });
    return;
  }
  const authorId = getAuth(req).userId;
  if (!authorId || !(await canAccessCourse(authorId, params.data.id))) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  const authorName = await courseCommentAuthorName(req, authorId, body.data.authorName);
  const [comment] = await db
    .insert(courseCommentsTable)
    .values({ courseId: params.data.id, authorId, authorName, content: body.data.content })
    .returning();
  res.status(201).json(comment);
});

router.post("/courses/:id/invite", async (req, res): Promise<void> => {
  const params = CreateCourseInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [course] = await db.select().from(coursesTable).where(and(
    eq(coursesTable.id, params.data.id), eq(coursesTable.ownerId, getAuth(req).userId!),
  ));
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json({ code: course.inviteCode });
});

router.post("/courses/join", async (req, res): Promise<void> => {
  const body = JoinCourseBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [course] = await db
    .select()
    .from(coursesTable)
    .where(and(
      eq(coursesTable.inviteCode, body.data.code.toUpperCase()),
      eq(coursesTable.eduEnabled, false),
    ));
  if (!course) {
    res.status(404).json({ error: "Invite code not found" });
    return;
  }
  await db.insert(courseMembersTable).values({ courseId: course.id, userId: getAuth(req).userId! }).onConflictDoNothing();
  const [{ value }] = await db
    .select({ value: count() })
    .from(lecturesTable)
    .where(eq(lecturesTable.courseId, course.id));
  res.json({ ...publicCourse(course), isOwner: course.ownerId === getAuth(req).userId, lectureCount: value, memberCount: await memberCount(course.id, course.ownerId) });
});

export default router;
