import { Router, type IRouter, type Request, type Response, type RequestHandler } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { queueSubmissionFileCleanup, cleanSubmissionFiles } from "../lib/edu-submission-files";
import { eduExpiryWarning } from "../lib/edu-expiry-warning";
import {
  db,
  coursesTable,
  courseMembersTable,
  eduAnnouncementsTable,
  eduMaterialsTable,
  eduAssignmentsTable,
  eduSubmissionsTable,
  classscribePrivacyDeletionOutboxTable,
  classscribeEduLicenseGrantsTable,
  classscribeEduInstitutionAgreementsTable,
  classscribeEduInstructorAuditTable,
  activeInstitutionCondition,
  classscribeEduClientLicensesTable,
  classscribeEduClientSessionsTable,
  classscribeEduClientFailedAttemptsTable,
  classscribeEduCourseLicenseBindingsTable,
} from "@workspace/db";
import {
  fingerprintEduRateLimitScope,
  verifyEduClientPin,
} from "../lib/classscribe-edu-client-credentials.js";
import {
  ListEduCoursesResponse,
  CreateEduCourseBody,
  CreateEduCourseResponse,
  JoinEduCourseBody,
  JoinEduCourseResponse,
  GetEduCourseParams,
  GetEduCourseResponse,
  CreateEduCourseInviteParams,
  CreateEduCourseInviteResponse,
  RotateEduCourseInviteParams,
  RotateEduCourseInviteResponse,
  CreateEduAnnouncementParams,
  CreateEduAnnouncementBody,
  CreateEduAnnouncementResponse,
  UpdateEduAnnouncementParams,
  UpdateEduAnnouncementBody,
  UpdateEduAnnouncementResponse,
  DeleteEduAnnouncementParams,
  CreateEduMaterialParams,
  CreateEduMaterialBody,
  CreateEduMaterialResponse,
  UpdateEduMaterialParams,
  UpdateEduMaterialBody,
  UpdateEduMaterialResponse,
  DeleteEduMaterialParams,
  CreateEduAssignmentParams,
  CreateEduAssignmentBody,
  CreateEduAssignmentResponse,
  UpdateEduAssignmentParams,
  UpdateEduAssignmentBody,
  UpdateEduAssignmentResponse,
  DeleteEduAssignmentParams,
  SubmitEduAssignmentParams,
  SubmitEduAssignmentBody,
  SubmitEduAssignmentResponse,
  ListEduSubmissionsParams,
  ListEduSubmissionsResponse,
  GradeEduSubmissionParams,
  GradeEduSubmissionBody,
  GradeEduSubmissionResponse,
  ActivateEduAccessBody,
  ActivateEduAccessResponse,
  GetEduAccessResponse,
  ApproveEduInstructorBody,
  ApproveEduInstructorResponse,
  GetEduSchoolResponse,
  UpdateEduExpiryWarningBody,
  UpdateEduExpiryWarningResponse,
  GetEduInstructorHistoryQueryParams,
  GetEduInstructorHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const fileStorage = new ObjectStorageService();
const MAX_COURSE_FILE = 10 * 1024 * 1024;
const COURSE_FILE_TYPES: Record<string, { extension: string; signature: (buffer: Buffer) => boolean }> = {
  "application/pdf": { extension: ".pdf", signature: b => b.subarray(0, 5).toString("ascii") === "%PDF-" },
  "text/plain": { extension: ".txt", signature: b => b.length > 0 && !b.includes(0) && !b.toString("utf8").includes("\ufffd") },
  "image/png": { extension: ".png", signature: b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  "image/jpeg": { extension: ".jpg", signature: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { extension: ".docx", signature: b => b.subarray(0, 4).toString("binary") === "PK\u0003\u0004" },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": { extension: ".pptx", signature: b => b.subarray(0, 4).toString("binary") === "PK\u0003\u0004" },
};
function courseUpload(body: unknown): { filename: string; mimeType: string; buffer: Buffer } | undefined {
  if (!body || typeof body !== "object") return;
  const { filename, mimeType, data } = body as Record<string, unknown>;
  if (typeof filename !== "string" || !filename.trim() || filename.length > 180 ||
    /[\\/\r\n\u0000-\u001f]/.test(filename) || typeof mimeType !== "string" ||
    !Object.hasOwn(COURSE_FILE_TYPES, mimeType) || typeof data !== "string" ||
    !data.length || data.length > Math.ceil(MAX_COURSE_FILE * 4 / 3) + 8 ||
    data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(data) ||
    !filename.toLowerCase().endsWith(COURSE_FILE_TYPES[mimeType].extension)) return;
  const buffer = Buffer.from(data, "base64");
  if (!buffer.length || buffer.length > MAX_COURSE_FILE || buffer.toString("base64") !== data ||
    !COURSE_FILE_TYPES[mimeType].signature(buffer)) return;
  return { filename: filename.trim(), mimeType, buffer };
}
function publicFileRow<T extends { fileKey: string | null }>(row: T): Omit<T, "fileKey"> {
  const { fileKey: _key, ...safe } = row;
  return safe;
}
async function removeCourseFile(key: string) {
  // Keys are generated on the server and never supplied by a caller.
  try {
    const file = await fileStorage.getObjectEntityFile(`/objects/${key}`);
    await file.delete();
  } catch (error) {
    // A retry after a successful object delete but failed DB write must still be able to remove the row.
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
}
async function serveCourseFile(req: Request, res: Response, key: string, filename: string, mimeType: string) {
  try {
    const file = await fileStorage.getObjectEntityFile(`/objects/${key}`);
    const asciiFilename = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader("Cache-Control", "private, no-store");
    file.createReadStream().on("error", error => {
      req.log.error({ err: error }, "EDU course file stream failed");
      if (!res.headersSent) res.status(503).end(); else res.destroy(error);
    }).pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "EDU course file download failed");
    res.status(503).json({ error: "Course file is temporarily unavailable." });
  }
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const makeInviteCode = () => randomBytes(9).toString("base64url").toUpperCase();
const EDU_LICENSE_REQUIRED = {
  code: "edu_license_required",
  error: "An approved EDU license agreement is required to create or manage EDU courses.",
} as const;
const EDU_CREDENTIALS_REQUIRED = {
  code: "edu_credentials_required",
  error: "Verify your EDU license number and client PIN for this Clerk session.",
} as const;
const PIN_ATTEMPT_LIMIT = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const DUMMY_PIN_HASH = `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`;

type ClerkSessionAuth = {
  userId: string | null;
  sessionId: string | null;
};

async function clerkSessionExpiration(req: Request): Promise<Date | undefined> {
  const auth = getAuth(req) as ClerkSessionAuth;
  if (!auth.userId || !auth.sessionId) return undefined;
  const session = await clerkClient.sessions.getSession(auth.sessionId);
  if (session.id !== auth.sessionId || session.userId !== auth.userId || session.status !== "active" ||
    !Number.isFinite(session.expireAt)) return undefined;
  const expiresAt = new Date(session.expireAt);
  return Number.isFinite(expiresAt.getTime()) ? expiresAt : undefined;
}

async function verifiedEduSession(req: Request) {
  const auth = getAuth(req) as ClerkSessionAuth;
  const sessionExpiresAt = await clerkSessionExpiration(req);
  if (!auth.userId || !auth.sessionId || !sessionExpiresAt || sessionExpiresAt <= new Date()) return undefined;
  const now = new Date();
  const [session] = await db.select({
    userId: classscribeEduClientSessionsTable.userId,
    sessionId: classscribeEduClientSessionsTable.clerkSessionId,
    agreementRef: classscribeEduClientSessionsTable.signedAgreementRef,
    expiresAt: classscribeEduClientSessionsTable.expiresAt,
    licenseExpiresAt: classscribeEduClientLicensesTable.expiresAt,
    licenseAgreementRef: classscribeEduClientLicensesTable.signedAgreementRef,
    ownerUserId: classscribeEduClientLicensesTable.ownerUserId,
    grantAgreementRef: classscribeEduLicenseGrantsTable.signedAgreementRef,
  }).from(classscribeEduClientSessionsTable)
    .innerJoin(classscribeEduClientLicensesTable, eq(
      classscribeEduClientLicensesTable.id,
      classscribeEduClientSessionsTable.licenseId,
    ))
    .innerJoin(classscribeEduLicenseGrantsTable, and(
      eq(classscribeEduLicenseGrantsTable.userId, classscribeEduClientLicensesTable.ownerUserId),
      eq(classscribeEduLicenseGrantsTable.signedAgreementRef, classscribeEduClientLicensesTable.signedAgreementRef),
      lte(classscribeEduLicenseGrantsTable.approvedAt, now),
      gt(classscribeEduLicenseGrantsTable.expiresAt, now),
      isNull(classscribeEduLicenseGrantsTable.revokedAt),
      activeInstitutionCondition(now),
    ))
    .where(and(
      eq(classscribeEduClientSessionsTable.userId, auth.userId),
      eq(classscribeEduClientSessionsTable.clerkSessionId, auth.sessionId),
      eq(classscribeEduClientSessionsTable.signedAgreementRef, classscribeEduClientLicensesTable.signedAgreementRef),
      gt(classscribeEduClientSessionsTable.expiresAt, now),
      gt(classscribeEduClientLicensesTable.expiresAt, now),
      isNull(classscribeEduClientLicensesTable.revokedAt),
    )).limit(1);
  if (!session || session.expiresAt > sessionExpiresAt ||
    session.licenseExpiresAt <= now || session.agreementRef !== session.licenseAgreementRef ||
    session.agreementRef !== session.grantAgreementRef) return undefined;
  return { userId: auth.userId, sessionId: auth.sessionId, agreementRef: session.agreementRef };
}

/**
 * Shared /edu guard. Mount before all EDU routers (including feature routers):
 * it exempts only GET /access and POST /activate, and requires a verified
 * license session on every other path.
 */
export const requireEduCredential: RequestHandler = async (req, res, next) => {
  if ((req.method === "GET" && req.path === "/access") ||
    (req.method === "POST" && req.path === "/activate")) {
    next();
    return;
  }
  try {
    const session = await verifiedEduSession(req);
    if (!session) {
      res.status(403).json(EDU_CREDENTIALS_REQUIRED);
      return;
    }
    res.locals.eduAgreementRef = session.agreementRef;
    (req as Request & { eduAgreementRef?: string }).eduAgreementRef = session.agreementRef;
    next();
  } catch (error) {
    req.log.error({ err: error }, "EDU credential session verification failed");
    res.status(503).json({ error: "EDU credential verification is temporarily unavailable. Please retry." });
  }
};

/** Confirms an operator grant is active for the exact agreement reference. */
export async function hasActiveEduLicenseForAgreement(
  ownerUserId: string,
  agreementRef: string,
  at = new Date(),
): Promise<boolean> {
  const [grant] = await db.select({ userId: classscribeEduLicenseGrantsTable.userId })
    .from(classscribeEduLicenseGrantsTable)
    .where(and(
      eq(classscribeEduLicenseGrantsTable.userId, ownerUserId),
      eq(classscribeEduLicenseGrantsTable.signedAgreementRef, agreementRef),
      lte(classscribeEduLicenseGrantsTable.approvedAt, at),
      gt(classscribeEduLicenseGrantsTable.expiresAt, at),
      isNull(classscribeEduLicenseGrantsTable.revokedAt),
      activeInstitutionCondition(at),
    )).limit(1);
  return Boolean(grant);
}

/** Checks both the immutable course binding and its owner's active grant. */
export async function eduCourseMatchesVerifiedAgreement(
  req: Request,
  courseId: string,
  ownerUserId: string,
): Promise<boolean> {
  const agreementRef = resAgreementRef(req);
  if (!agreementRef) return false;
  const [binding] = await db.select({
    agreementRef: classscribeEduCourseLicenseBindingsTable.signedAgreementRef,
  }).from(coursesTable)
    .innerJoin(classscribeEduCourseLicenseBindingsTable, eq(
      classscribeEduCourseLicenseBindingsTable.courseId,
      coursesTable.id,
    ))
    .where(and(
      eq(coursesTable.id, courseId),
      eq(coursesTable.ownerId, ownerUserId),
      eq(coursesTable.eduEnabled, true),
      eq(classscribeEduCourseLicenseBindingsTable.signedAgreementRef, agreementRef),
    )).limit(1);
  return Boolean(binding && await hasActiveEduLicenseForAgreement(ownerUserId, agreementRef));
}

function resAgreementRef(req: Request): string | undefined {
  // Set by the shared credential middleware after exact session verification.
  return (req as Request & { eduAgreementRef?: string }).eduAgreementRef;
}

/**
 * Enforces the immutable agreement provenance for every course-scoped EDU
 * route. Mount centrally before all EDU routers; course membership/ownership
 * remains the responsibility of each route.
 */
export const requireEduCourseAgreement: RequestHandler = async (req, res, next) => {
  const courseId: unknown = req.params.id;
  const activeAgreement = resAgreementRef(req);
  if (typeof courseId !== "string" || !uuidPattern.test(courseId) || !activeAgreement) {
    res.status(404).json({ error: "EDU course not found" });
    return;
  }
  try {
    const [course] = await db.select({
      ownerId: coursesTable.ownerId,
      agreementRef: classscribeEduCourseLicenseBindingsTable.signedAgreementRef,
    }).from(coursesTable)
      .innerJoin(classscribeEduCourseLicenseBindingsTable, eq(
        classscribeEduCourseLicenseBindingsTable.courseId,
        coursesTable.id,
      ))
      .where(and(
        eq(coursesTable.id, courseId),
        eq(coursesTable.eduEnabled, true),
      )).limit(1);
    if (!course || !course.ownerId || course.agreementRef !== activeAgreement) {
      res.status(404).json({ error: "EDU course not found" });
      return;
    }
    if (!(await hasActiveEduLicenseForAgreement(course.ownerId, course.agreementRef))) {
      if (course.ownerId === getAuth(req).userId) {
        res.status(403).json(EDU_LICENSE_REQUIRED);
      } else {
        res.status(404).json({ error: "EDU course not found" });
      }
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "EDU course agreement verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
  }
};

async function persistFailedEduAttempt(scopeHashes: string[], now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const lockUntil = new Date(now.getTime() + LOCKOUT_MS);
  for (const scopeHash of scopeHashes) {
    await db.insert(classscribeEduClientFailedAttemptsTable).values({
      scopeHash, attemptCount: 1, windowStartedAt: now, lockedUntil: null, updatedAt: now,
    }).onConflictDoUpdate({
      target: classscribeEduClientFailedAttemptsTable.scopeHash,
      set: {
        attemptCount: sql`case when ${classscribeEduClientFailedAttemptsTable.windowStartedAt} <= ${windowStart}
          then 1 else ${classscribeEduClientFailedAttemptsTable.attemptCount} + 1 end`,
        windowStartedAt: sql`case when ${classscribeEduClientFailedAttemptsTable.windowStartedAt} <= ${windowStart}
          then ${now} else ${classscribeEduClientFailedAttemptsTable.windowStartedAt} end`,
        lockedUntil: sql`case when (
          case when ${classscribeEduClientFailedAttemptsTable.windowStartedAt} <= ${windowStart}
            then 1 else ${classscribeEduClientFailedAttemptsTable.attemptCount} + 1 end
        ) >= ${PIN_ATTEMPT_LIMIT} then ${lockUntil}
          when ${classscribeEduClientFailedAttemptsTable.lockedUntil} > ${now}
            then ${classscribeEduClientFailedAttemptsTable.lockedUntil} else null end`,
        updatedAt: now,
      },
    });
  }
}

async function eduAttemptLocked(scopeHashes: string[], now: Date): Promise<boolean> {
  const [locked] = await db.select({ scopeHash: classscribeEduClientFailedAttemptsTable.scopeHash })
    .from(classscribeEduClientFailedAttemptsTable)
    .where(and(
      sql`${classscribeEduClientFailedAttemptsTable.scopeHash} in (${sql.join(scopeHashes.map(hash => sql`${hash}`), sql`, `)})`,
      gt(classscribeEduClientFailedAttemptsTable.lockedUntil, now),
    )).limit(1);
  return Boolean(locked);
}

// Every route with a course :id passes this check before its handler, including
// assignment submission, grading, roster, and invite operations.
router.param("id", async (req, res, next, rawId) => {
  const courseId = String(rawId);
  if (!uuidPattern.test(courseId)) {
    res.status(404).json({ error: "EDU course not found" });
    return;
  }
  const userId = getAuth(req).userId!;
  try {
    const [course] = await db.select({
      id: coursesTable.id,
      ownerId: coursesTable.ownerId,
      memberId: courseMembersTable.userId,
      agreementRef: classscribeEduCourseLicenseBindingsTable.signedAgreementRef,
    }).from(coursesTable).leftJoin(courseMembersTable, and(
      eq(courseMembersTable.courseId, coursesTable.id),
      eq(courseMembersTable.userId, userId),
    )).innerJoin(classscribeEduCourseLicenseBindingsTable, eq(
      classscribeEduCourseLicenseBindingsTable.courseId,
      coursesTable.id,
    )).where(and(
      eq(coursesTable.id, courseId),
      eq(coursesTable.eduEnabled, true),
    )).limit(1);
    if (!course || (course.ownerId !== userId && !course.memberId)) {
      res.status(404).json({ error: "EDU course not found" });
      return;
    }
    const activeAgreement = resAgreementRef(req);
    if (!activeAgreement || course.agreementRef !== activeAgreement) {
      res.status(404).json({ error: "EDU course not found" });
      return;
    }
    if (course.ownerId === userId) {
      if (!activeAgreement || !(await hasActiveEduLicenseForAgreement(userId, activeAgreement))) {
        res.status(403).json(EDU_LICENSE_REQUIRED);
        return;
      }
    } else if (!course.ownerId || !activeAgreement ||
      !(await hasActiveEduLicenseForAgreement(course.ownerId, activeAgreement))) {
      // Do not reveal that an unlicensed owner's course or records exist.
      res.status(404).json({ error: "EDU course not found" });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "EDU license access verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
  }
});

type EduCourseAccess = {
  id: string;
  name: string;
  subject: string;
  term: string;
  ownerId: string | null;
  role: "instructor" | "student";
};

async function accessibleEduCourse(userId: string, courseId: string): Promise<EduCourseAccess | undefined> {
  if (!uuidPattern.test(courseId)) return undefined;
  const [course] = await db.select({
    id: coursesTable.id,
    name: coursesTable.name,
    subject: coursesTable.subject,
    term: coursesTable.term,
    ownerId: coursesTable.ownerId,
  }).from(coursesTable)
    .leftJoin(courseMembersTable, and(
      eq(courseMembersTable.courseId, coursesTable.id),
      eq(courseMembersTable.userId, userId),
    ))
    .where(and(
      eq(coursesTable.id, courseId),
      eq(coursesTable.eduEnabled, true),
      or(eq(coursesTable.ownerId, userId), eq(courseMembersTable.userId, userId)),
    )).limit(1);
  return course ? { ...course, role: course.ownerId === userId ? "instructor" : "student" } : undefined;
}

async function ownedEduCourse(userId: string, courseId: string): Promise<EduCourseAccess | undefined> {
  if (!uuidPattern.test(courseId)) return undefined;
  const [course] = await db.select({
    id: coursesTable.id,
    name: coursesTable.name,
    subject: coursesTable.subject,
    term: coursesTable.term,
    ownerId: coursesTable.ownerId,
  }).from(coursesTable).where(and(
    eq(coursesTable.id, courseId),
    eq(coursesTable.eduEnabled, true),
    eq(coursesTable.ownerId, userId),
  )).limit(1);
  return course ? { ...course, role: "instructor" } : undefined;
}

function parseDueAt(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return undefined;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function validWebUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function invalid(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

async function verifiedDisplayNames(req: Request, userIds: string[]) {
  const uniqueIds = [...new Set(userIds)];
  const names = await Promise.all(uniqueIds.map(async userId => {
    try {
      const user = await clerkClient.users.getUser(userId);
      const fullName = user.fullName?.trim();
      const firstLast = [user.firstName, user.lastName].filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
      return [userId, fullName || firstLast || user.username?.trim() || userId] as const;
    } catch (error) {
      req.log.warn({ err: error }, "Could not resolve EDU member display name from Clerk");
      return [userId, userId] as const;
    }
  }));
  return new Map(names);
}

router.post("/edu/activate", async (req, res): Promise<void> => {
  const auth = getAuth(req) as ClerkSessionAuth;
  let sessionExpiresAt: Date | undefined;
  try {
    sessionExpiresAt = await clerkSessionExpiration(req);
  } catch (error) {
    req.log.error({ err: error }, "Clerk session expiration verification failed during EDU activation");
    res.status(503).json({ error: "EDU session verification is temporarily unavailable. Please retry." });
    return;
  }
  if (!auth.userId || !auth.sessionId || !sessionExpiresAt || sessionExpiresAt <= new Date()) {
    res.status(401).json({ error: "A valid Clerk session is required to activate EDU access." });
    return;
  }
  const body = ActivateEduAccessBody.safeParse(req.body);
  if (!body.success) { invalid(res, "Provide a valid EDU license number and client PIN."); return; }
  const licenseNumber = body.data.licenseNumber;
  const clientPin = body.data.clientPin;
  const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
  const scopeHashes = [
    fingerprintEduRateLimitScope(`account:${auth.userId}:${licenseNumber}`),
    fingerprintEduRateLimitScope(`ip:${ipAddress}`),
  ];
  const now = new Date();
  try {
    if (await eduAttemptLocked(scopeHashes, now)) {
      res.status(429).json({ code: "edu_credentials_locked", error: "EDU credential verification is temporarily locked. Try again later." });
      return;
    }
    const validLicenseNumber = /^EDU-[A-F0-9]{24}$/.test(licenseNumber);
    const [license] = validLicenseNumber
      ? await db.select().from(classscribeEduClientLicensesTable)
        .where(and(
          eq(classscribeEduClientLicensesTable.licenseNumber, licenseNumber),
          gt(classscribeEduClientLicensesTable.expiresAt, now),
          isNull(classscribeEduClientLicensesTable.revokedAt),
        )).limit(1)
      : [];
    const pinFormatValid = /^\d{8,12}$/.test(clientPin);
    const pinMatches = await verifyEduClientPin(
      pinFormatValid ? clientPin : "00000000",
      license?.pinHash ?? DUMMY_PIN_HASH,
    );
    const [grant] = license
      ? await db.select().from(classscribeEduLicenseGrantsTable).where(and(
        eq(classscribeEduLicenseGrantsTable.userId, license.ownerUserId),
        eq(classscribeEduLicenseGrantsTable.signedAgreementRef, license.signedAgreementRef),
        lte(classscribeEduLicenseGrantsTable.approvedAt, now),
        gt(classscribeEduLicenseGrantsTable.expiresAt, now),
        isNull(classscribeEduLicenseGrantsTable.revokedAt),
        activeInstitutionCondition(now),
      )).limit(1)
      : [];
    if (!license || !pinFormatValid || !pinMatches || !grant) {
      await persistFailedEduAttempt(scopeHashes, now);
      res.status(403).json({ code: "edu_credentials_invalid", error: "The EDU license number or client PIN is invalid or inactive." });
      return;
    }
    await db.delete(classscribeEduClientFailedAttemptsTable)
      .where(sql`${classscribeEduClientFailedAttemptsTable.scopeHash} in (${sql.join(scopeHashes.map(hash => sql`${hash}`), sql`, `)})`);
    const expiresAt = new Date(Math.min(
      sessionExpiresAt.getTime(),
      license.expiresAt.getTime(),
      grant.expiresAt.getTime(),
    ));
    await db.insert(classscribeEduClientSessionsTable).values({
      licenseId: license.id,
      userId: auth.userId,
      clerkSessionId: auth.sessionId,
      signedAgreementRef: license.signedAgreementRef,
      expiresAt,
    }).onConflictDoUpdate({
      target: [classscribeEduClientSessionsTable.userId, classscribeEduClientSessionsTable.clerkSessionId],
      set: {
        licenseId: license.id,
        signedAgreementRef: license.signedAgreementRef,
        expiresAt,
        createdAt: now,
      },
    });
    res.json(ActivateEduAccessResponse.parse({ verified: true, expiresAt: expiresAt.toISOString() }));
  } catch (error) {
    req.log.error({ err: error }, "EDU client credential activation failed");
    res.status(503).json({ error: "EDU credential verification is temporarily unavailable. Please retry." });
  }
});

router.get("/edu/access", async (req, res): Promise<void> => {
  try {
    const session = await verifiedEduSession(req);
    const canCreateCourse = Boolean(session &&
      await hasActiveEduLicenseForAgreement(session.userId, session.agreementRef));
    const canManageSchool = Boolean(session && canCreateCourse &&
      await activeSchoolAdministrator(session.userId, session.agreementRef));
    res.json(GetEduAccessResponse.parse({
      canCreateCourse,
      canJoinLicensedCourse: Boolean(session),
      needsCredentials: !session,
      canManageSchool,
    }));
  } catch (error) {
    req.log.error({ err: error }, "EDU access status verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
  }
});

async function activeSchoolAdministrator(userId: string, agreementRef: string) {
  const now = new Date();
  const [school] = await db.select().from(classscribeEduInstitutionAgreementsTable).where(and(
    eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, agreementRef),
    eq(classscribeEduInstitutionAgreementsTable.adminUserId, userId),
    lte(classscribeEduInstitutionAgreementsTable.verifiedAt, now),
    gt(classscribeEduInstitutionAgreementsTable.expiresAt, now),
    isNull(classscribeEduInstitutionAgreementsTable.revokedAt),
  )).limit(1);
  return school;
}

async function schoolForRequest(req: Request, res: Response) {
  const userId = getAuth(req).userId;
  const ref = resAgreementRef(req);
  const school = userId && ref && await activeSchoolAdministrator(userId, ref);
  if (!school || !userId || !(await hasActiveEduLicenseForAgreement(userId, ref!))) {
    res.status(403).json({ error: "An active school administrator agreement is required." });
    return undefined;
  }
  return school;
}

function publicInstructor(grant: typeof classscribeEduLicenseGrantsTable.$inferSelect) {
  return {
    userId: grant.userId, signedAgreementRef: grant.signedAgreementRef,
    issuerUserId: grant.issuerUserId!, approvedAt: grant.approvedAt,
    expiresAt: grant.expiresAt, revokedAt: grant.revokedAt,
  };
}

router.get("/edu/school", async (req, res): Promise<void> => {
  const school = await schoolForRequest(req, res);
  if (!school) return;
  const instructors = await db.select().from(classscribeEduLicenseGrantsTable).where(and(
    eq(classscribeEduLicenseGrantsTable.signedAgreementRef, school.signedAgreementRef),
    eq(classscribeEduLicenseGrantsTable.issuerUserId, school.adminUserId),
    ne(classscribeEduLicenseGrantsTable.userId, school.adminUserId),
  )).orderBy(asc(classscribeEduLicenseGrantsTable.approvedAt));
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetEduSchoolResponse.parse({
    signedAgreementRef: school.signedAgreementRef, adminUserId: school.adminUserId,
    verifiedAt: school.verifiedAt, expiresAt: school.expiresAt,
    expiryWarning: eduExpiryWarning(school),
    instructors: instructors.map(publicInstructor),
  }));
});

router.patch("/edu/school/expiry-warning", async (req, res): Promise<void> => {
  const school = await schoolForRequest(req, res);
  if (!school) return;
  const input = UpdateEduExpiryWarningBody.strict().safeParse(req.body);
  if (!input.success) { invalid(res, "Provide an enabled boolean only."); return; }
  const updated = await db.transaction(async tx => {
    const now = new Date();
    const [locked] = await tx.select().from(classscribeEduInstitutionAgreementsTable).where(and(
      eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, school.signedAgreementRef),
      eq(classscribeEduInstitutionAgreementsTable.adminUserId, school.adminUserId),
      lte(classscribeEduInstitutionAgreementsTable.verifiedAt, now),
      gt(classscribeEduInstitutionAgreementsTable.expiresAt, now),
      isNull(classscribeEduInstitutionAgreementsTable.revokedAt),
    )).for("update");
    if (!locked) return undefined;
    const [admin] = await tx.select().from(classscribeEduLicenseGrantsTable).where(and(
      eq(classscribeEduLicenseGrantsTable.userId, school.adminUserId),
      eq(classscribeEduLicenseGrantsTable.signedAgreementRef, school.signedAgreementRef),
      isNull(classscribeEduLicenseGrantsTable.revokedAt),
      gt(classscribeEduLicenseGrantsTable.expiresAt, now),
    )).for("update");
    if (!admin) return undefined;
    const [saved] = await tx.update(classscribeEduInstitutionAgreementsTable)
      .set({ expiryWarningEnabled: input.data.enabled })
      .where(eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, locked.signedAgreementRef))
      .returning();
    return saved;
  });
  if (!updated) {
    res.status(403).json({ error: "School agreement is no longer active." }); return;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.json(UpdateEduExpiryWarningResponse.parse(eduExpiryWarning(updated)));
});

router.get("/edu/school/instructor-history", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const school = await schoolForRequest(req, res);
    if (!school) return;
    // Reject repeated/object query parameters before the generated scalar coercion.
    if ((req.query.limit !== undefined && typeof req.query.limit !== "string") ||
      (req.query.cursor !== undefined && typeof req.query.cursor !== "string")) {
      invalid(res, "Invalid history pagination parameters."); return;
    }
    const input = GetEduInstructorHistoryQueryParams.safeParse(req.query);
    if (!input.success) { invalid(res, "Invalid history pagination parameters."); return; }
    const { limit, cursor } = input.data;
    const audit = classscribeEduInstructorAuditTable;
    if (cursor) {
      const [anchor] = await db.select({ id: audit.id }).from(audit).where(and(
        eq(audit.id, cursor),
        eq(audit.signedAgreementRef, school.signedAgreementRef),
      )).limit(1);
      if (!anchor) { invalid(res, "Invalid history cursor."); return; }
    }
    // Compare in PostgreSQL to preserve sub-millisecond timestamp precision.
    // The UUID breaks ties and keeps pages stable when new events are appended.
    const rows = await db.select({
      id: audit.id, issuerUserId: audit.issuerUserId, instructorUserId: audit.instructorUserId,
      action: audit.action, occurredAt: audit.occurredAt, expiresAt: audit.expiresAt,
    }).from(audit).where(and(
      eq(audit.signedAgreementRef, school.signedAgreementRef),
      cursor ? sql`(${audit.occurredAt}, ${audit.id}) < (
        select occurred_at, id from classscribe_edu_instructor_audit
        where id = ${cursor}::uuid and signed_agreement_ref = ${school.signedAgreementRef}
      )` : undefined,
    )).orderBy(desc(audit.occurredAt), desc(audit.id)).limit(limit + 1);
    const events = rows.slice(0, limit);
    res.json(GetEduInstructorHistoryResponse.parse({
      signedAgreementRef: school.signedAgreementRef, events,
      nextCursor: rows.length > limit ? events[events.length - 1].id : null,
    }));
  } catch (error) {
    req.log.error({ err: error }, "EDU instructor history failed");
    res.status(503).json({ error: "Could not load instructor history. Retry later." });
  }
});

router.post("/edu/school/instructors", async (req, res): Promise<void> => {
  const school = await schoolForRequest(req, res);
  if (!school) return;
  const input = ApproveEduInstructorBody.safeParse(req.body);
  if (!input.success || input.data.userId === school.adminUserId) {
    invalid(res, "Provide a different existing instructor's exact Clerk user ID."); return;
  }
  try {
    const user = await clerkClient.users.getUser(input.data.userId);
    if (user.id !== input.data.userId) { invalid(res, "Clerk account did not match."); return; }
  } catch (error) {
    req.log.warn({ err: error }, "EDU instructor account lookup failed");
    res.status(503).json({ error: "Could not verify the instructor account with Clerk. Retry later." }); return;
  }
  try {
    const grant = await db.transaction(async tx => {
      const now = new Date();
      const [locked] = await tx.select().from(classscribeEduInstitutionAgreementsTable).where(and(
        eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, school.signedAgreementRef),
        eq(classscribeEduInstitutionAgreementsTable.adminUserId, school.adminUserId),
        lte(classscribeEduInstitutionAgreementsTable.verifiedAt, now),
        gt(classscribeEduInstitutionAgreementsTable.expiresAt, now),
        isNull(classscribeEduInstitutionAgreementsTable.revokedAt),
      )).for("update");
      if (!locked) throw new Error("school_inactive");
      const [admin] = await tx.select().from(classscribeEduLicenseGrantsTable).where(and(
        eq(classscribeEduLicenseGrantsTable.userId, school.adminUserId),
        eq(classscribeEduLicenseGrantsTable.signedAgreementRef, school.signedAgreementRef),
        lte(classscribeEduLicenseGrantsTable.approvedAt, now),
        gt(classscribeEduLicenseGrantsTable.expiresAt, now),
        isNull(classscribeEduLicenseGrantsTable.revokedAt),
      )).limit(1);
      if (!admin) throw new Error("school_inactive");
      const [existing] = await tx.select().from(classscribeEduLicenseGrantsTable)
        .where(eq(classscribeEduLicenseGrantsTable.userId, input.data.userId)).for("update");
      if (existing && (existing.signedAgreementRef !== school.signedAgreementRef ||
        existing.issuerUserId !== school.adminUserId)) throw new Error("instructor_other_agreement");
      if (existing && !existing.revokedAt && existing.expiresAt > now) throw new Error("instructor_already_active");
      const expiresAt = new Date(Math.min(locked.expiresAt.getTime(), admin.expiresAt.getTime()));
      const [approved] = existing
        ? await tx.update(classscribeEduLicenseGrantsTable).set({
          approvedAt: now, expiresAt, revokedAt: null,
        }).where(eq(classscribeEduLicenseGrantsTable.userId, input.data.userId)).returning()
        : await tx.insert(classscribeEduLicenseGrantsTable).values({
          userId: input.data.userId, signedAgreementRef: school.signedAgreementRef,
          issuerUserId: school.adminUserId, approvedAt: now, expiresAt,
        }).returning();
      await tx.insert(classscribeEduInstructorAuditTable).values({
        signedAgreementRef: school.signedAgreementRef, issuerUserId: school.adminUserId,
        instructorUserId: input.data.userId, action: "approved", occurredAt: now, expiresAt,
      });
      return approved;
    });
    res.status(201).json(ApproveEduInstructorResponse.parse(publicInstructor(grant)));
  } catch (error) {
    if (error instanceof Error && error.message === "instructor_other_agreement") {
      res.status(409).json({ error: "This account has an EDU grant under another agreement." }); return;
    }
    if (error instanceof Error && error.message === "instructor_already_active") {
      res.status(409).json({ error: "This instructor is already approved." }); return;
    }
    if (error instanceof Error && error.message === "school_inactive") {
      res.status(403).json({ error: "School agreement is no longer active." }); return;
    }
    req.log.error({ err: error }, "EDU instructor approval failed");
    res.status(503).json({ error: "Could not approve the instructor. Retry later." });
  }
});

router.delete("/edu/school/instructors/:userId", async (req, res): Promise<void> => {
  const school = await schoolForRequest(req, res);
  if (!school) return;
  if (!/^user_[A-Za-z0-9]{10,64}$/.test(req.params.userId) || req.params.userId === school.adminUserId) {
    res.status(404).json({ error: "Instructor not found." }); return;
  }
  try {
    const revoked = await db.transaction(async tx => {
      const now = new Date();
      const [locked] = await tx.select().from(classscribeEduInstitutionAgreementsTable).where(and(
        eq(classscribeEduInstitutionAgreementsTable.signedAgreementRef, school.signedAgreementRef),
        eq(classscribeEduInstitutionAgreementsTable.adminUserId, school.adminUserId),
        gt(classscribeEduInstitutionAgreementsTable.expiresAt, now),
        isNull(classscribeEduInstitutionAgreementsTable.revokedAt),
      )).for("update");
      if (!locked) return false;
      const [grant] = await tx.update(classscribeEduLicenseGrantsTable).set({ revokedAt: now }).where(and(
        eq(classscribeEduLicenseGrantsTable.userId, req.params.userId),
        eq(classscribeEduLicenseGrantsTable.signedAgreementRef, school.signedAgreementRef),
        eq(classscribeEduLicenseGrantsTable.issuerUserId, school.adminUserId),
        isNull(classscribeEduLicenseGrantsTable.revokedAt),
      )).returning();
      if (!grant) return false;
      await tx.insert(classscribeEduInstructorAuditTable).values({
        signedAgreementRef: school.signedAgreementRef, issuerUserId: school.adminUserId,
        instructorUserId: grant.userId, action: "revoked", occurredAt: now,
      });
      return true;
    });
    if (!revoked) { res.status(404).json({ error: "Active instructor not found in this school." }); return; }
    res.sendStatus(204);
  } catch (error) {
    req.log.error({ err: error }, "EDU instructor revocation failed");
    res.status(503).json({ error: "Could not revoke the instructor. Retry later." });
  }
});

router.get("/edu/courses", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const accessCheckedAt = new Date();
  const activeAgreement = resAgreementRef(req);
  let rows: Array<{
    id: string;
    name: string;
    subject: string;
    term: string;
    ownerId: string | null;
    memberId: string | null;
    memberCount: number;
  }>;
  try {
    rows = await db.select({
      id: coursesTable.id,
      name: coursesTable.name,
      subject: coursesTable.subject,
      term: coursesTable.term,
      ownerId: coursesTable.ownerId,
      memberId: courseMembersTable.userId,
      memberCount: sql<number>`(select count(*) from ${courseMembersTable} m where m.course_id = ${coursesTable.id})::int
        + case when ${coursesTable.ownerId} is not null and not exists
          (select 1 from ${courseMembersTable} owner_member where owner_member.course_id = ${coursesTable.id}
            and owner_member.user_id = ${coursesTable.ownerId}) then 1 else 0 end`,
    }).from(coursesTable).innerJoin(classscribeEduCourseLicenseBindingsTable, and(
      eq(classscribeEduCourseLicenseBindingsTable.courseId, coursesTable.id),
      eq(classscribeEduCourseLicenseBindingsTable.signedAgreementRef, activeAgreement ?? ""),
    )).innerJoin(classscribeEduLicenseGrantsTable, and(
      eq(classscribeEduLicenseGrantsTable.userId, coursesTable.ownerId),
      eq(classscribeEduLicenseGrantsTable.signedAgreementRef, classscribeEduCourseLicenseBindingsTable.signedAgreementRef),
      lte(classscribeEduLicenseGrantsTable.approvedAt, accessCheckedAt),
      gt(classscribeEduLicenseGrantsTable.expiresAt, accessCheckedAt),
      isNull(classscribeEduLicenseGrantsTable.revokedAt),
      activeInstitutionCondition(accessCheckedAt),
    )).leftJoin(courseMembersTable, and(
      eq(courseMembersTable.courseId, coursesTable.id),
      eq(courseMembersTable.userId, userId),
    )).where(and(
      eq(coursesTable.eduEnabled, true),
      or(eq(coursesTable.ownerId, userId), eq(courseMembersTable.userId, userId)),
    )).orderBy(asc(coursesTable.createdAt));
  } catch (error) {
    req.log.error({ err: error }, "EDU course list license verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
    return;
  }
  const courses = rows.map(({ ownerId, memberId: _memberId, ...course }) => ({
      ...course,
      role: ownerId === userId ? "instructor" as const : "student" as const,
  }));
  res.json(ListEduCoursesResponse.parse({ courses }));
});

router.post("/edu/courses", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const agreementRef = resAgreementRef(req);
  try {
    if (!agreementRef || !(await hasActiveEduLicenseForAgreement(userId, agreementRef))) {
      res.status(403).json(EDU_LICENSE_REQUIRED); return;
    }
  } catch (error) {
    req.log.error({ err: error }, "EDU course creation license verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
    return;
  }
  const body = CreateEduCourseBody.safeParse(req.body);
  if (!body.success) { invalid(res, body.error.message); return; }
  if (!body.data.name.trim()) { invalid(res, "Course name cannot be blank"); return; }
  const [course] = await db.transaction(async tx => {
    const [created] = await tx.insert(coursesTable).values({
      name: body.data.name.trim(),
      subject: body.data.subject?.trim() ?? "",
      term: body.data.term?.trim() ?? "",
      color: "#6558d3",
      inviteCode: makeInviteCode(),
      ownerId: userId,
      eduEnabled: true,
    }).returning();
    await tx.insert(classscribeEduCourseLicenseBindingsTable).values({
      courseId: created.id,
      signedAgreementRef: agreementRef!,
    });
    await tx.insert(courseMembersTable).values({ courseId: created.id, userId }).onConflictDoNothing();
    return [created];
  });
  res.status(201).json(CreateEduCourseResponse.parse({
    course: { id: course.id, name: course.name, subject: course.subject, term: course.term, ownerId: course.ownerId },
  }));
});

router.post("/edu/join", async (req, res): Promise<void> => {
  const body = JoinEduCourseBody.safeParse(req.body);
  if (!body.success) { invalid(res, body.error.message); return; }
  const agreementRef = resAgreementRef(req);
  if (!agreementRef) { res.status(404).json({ error: "EDU invite code not found" }); return; }
  let course: {
    id: string;
    name: string;
    subject: string;
    term: string;
    ownerId: string | null;
  } | undefined;
  try {
    [course] = await db.select({
      id: coursesTable.id,
      name: coursesTable.name,
      subject: coursesTable.subject,
      term: coursesTable.term,
      ownerId: coursesTable.ownerId,
    }).from(coursesTable)
      .innerJoin(classscribeEduCourseLicenseBindingsTable, and(
        eq(classscribeEduCourseLicenseBindingsTable.courseId, coursesTable.id),
        eq(classscribeEduCourseLicenseBindingsTable.signedAgreementRef, agreementRef),
      ))
      .innerJoin(classscribeEduLicenseGrantsTable, and(
        eq(classscribeEduLicenseGrantsTable.userId, coursesTable.ownerId),
        eq(classscribeEduLicenseGrantsTable.signedAgreementRef, classscribeEduCourseLicenseBindingsTable.signedAgreementRef),
        lte(classscribeEduLicenseGrantsTable.approvedAt, new Date()),
        gt(classscribeEduLicenseGrantsTable.expiresAt, new Date()),
        isNull(classscribeEduLicenseGrantsTable.revokedAt),
        activeInstitutionCondition(new Date()),
      ))
      .where(and(
        eq(coursesTable.inviteCode, body.data.inviteCode.trim().toUpperCase()),
        eq(coursesTable.eduEnabled, true),
      )).limit(1);
  } catch (error) {
    req.log.error({ err: error }, "EDU invite owner license verification failed");
    res.status(503).json({ error: "EDU access verification is temporarily unavailable. Please retry." });
    return;
  }
  if (!course) { res.status(404).json({ error: "EDU invite code not found" }); return; }
  const userId = getAuth(req).userId!;
  await db.insert(courseMembersTable).values({ courseId: course.id, userId }).onConflictDoNothing();
  res.json(JoinEduCourseResponse.parse({
    course: { id: course.id, name: course.name, subject: course.subject, term: course.term, ownerId: course.ownerId },
  }));
});

router.get("/edu/courses/:id", async (req, res): Promise<void> => {
  const params = GetEduCourseParams.safeParse(req.params);
  const course = params.success ? await accessibleEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const [announcements, materials, assignments] = await Promise.all([
    db.select().from(eduAnnouncementsTable).where(eq(eduAnnouncementsTable.courseId, course.id)).orderBy(desc(eduAnnouncementsTable.createdAt)),
    db.select().from(eduMaterialsTable).where(eq(eduMaterialsTable.courseId, course.id)).orderBy(desc(eduMaterialsTable.createdAt)),
    db.select().from(eduAssignmentsTable).where(eq(eduAssignmentsTable.courseId, course.id)).orderBy(asc(eduAssignmentsTable.createdAt)),
  ]);
  const userId = getAuth(req).userId!;
  const mySubmissions = course.role === "student" && assignments.length
    ? await db.select().from(eduSubmissionsTable).where(and(
      eq(eduSubmissionsTable.studentId, userId),
      sql`${eduSubmissionsTable.assignmentId} in (${sql.join(assignments.map(a => sql`${a.id}`), sql`, `)})`,
    ))
    : [];
  const submissionByAssignment = new Map(mySubmissions.map(item => [item.assignmentId, item]));
  const roster = course.role === "instructor"
    ? await db.select({ userId: courseMembersTable.userId }).from(courseMembersTable)
      .where(and(eq(courseMembersTable.courseId, course.id), ne(courseMembersTable.userId, course.ownerId ?? "")))
    : undefined;
  const rosterNames = roster ? await verifiedDisplayNames(req, roster.map(member => member.userId)) : undefined;
  res.json(GetEduCourseResponse.parse({
    course: { id: course.id, name: course.name, subject: course.subject, term: course.term, ownerId: course.ownerId },
    role: course.role,
    ...(roster ? { roster: roster.map(member => ({ ...member, name: rosterNames?.get(member.userId) ?? member.userId })) } : {}),
    announcements,
    materials: materials.map(publicFileRow),
    assignments: assignments.map(({ courseId: _courseId, ...assignment }) => {
       const submission = submissionByAssignment.get(assignment.id);
      return {
         ...publicFileRow(assignment),
        ...(submission ? { mySubmission: {
          id: submission.id, text: submission.text, score: submission.score,
          feedback: submission.feedback, submittedAt: submission.submittedAt,
          filename: submission.filename, mimeType: submission.mimeType, sizeBytes: submission.sizeBytes,
        } } : {}),
      };
    }),
  }));
});

router.post("/edu/courses/:id/invite", async (req, res): Promise<void> => {
  const params = CreateEduCourseInviteParams.safeParse(req.params);
  const course = params.success ? await ownedEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const [row] = await db.select({ inviteCode: coursesTable.inviteCode }).from(coursesTable)
    .where(and(eq(coursesTable.id, course.id), eq(coursesTable.ownerId, getAuth(req).userId!)));
  res.json(CreateEduCourseInviteResponse.parse({ inviteCode: row.inviteCode }));
});

router.post("/edu/courses/:id/invite/rotate", async (req, res): Promise<void> => {
  const params = RotateEduCourseInviteParams.safeParse(req.params);
  const course = params.success ? await ownedEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const [rotated] = await db.update(coursesTable).set({ inviteCode: makeInviteCode() }).where(and(
    eq(coursesTable.id, course.id),
    eq(coursesTable.ownerId, getAuth(req).userId!),
    eq(coursesTable.eduEnabled, true),
  )).returning({ inviteCode: coursesTable.inviteCode });
  if (!rotated) { res.status(404).json({ error: "EDU course not found" }); return; }
  res.json(RotateEduCourseInviteResponse.parse({ inviteCode: rotated.inviteCode }));
});

router.post("/edu/courses/:id/announcements", async (req, res): Promise<void> => {
  const params = CreateEduAnnouncementParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "EDU course not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const body = CreateEduAnnouncementBody.safeParse(req.body);
  if (!body.success || !body.data.title.trim()) { invalid(res, body.success ? "Announcement title cannot be blank" : body.error.message); return; }
  const [announcement] = await db.insert(eduAnnouncementsTable).values({
    courseId: course.id, title: body.data.title.trim(), body: body.data.body,
  }).returning();
  res.status(201).json(CreateEduAnnouncementResponse.parse({ announcement }));
});

router.patch("/edu/courses/:id/announcements/:itemId", async (req, res): Promise<void> => {
  const params = UpdateEduAnnouncementParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Announcement not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "Announcement not found" }); return; }
  const [existing] = await db.select({ id: eduAnnouncementsTable.id }).from(eduAnnouncementsTable).where(and(
    eq(eduAnnouncementsTable.id, params.data.itemId), eq(eduAnnouncementsTable.courseId, course.id),
  ));
  if (!existing) { res.status(404).json({ error: "Announcement not found" }); return; }
  const body = UpdateEduAnnouncementBody.safeParse(req.body);
  if (!body.success || !Object.keys(body.data).length || (body.data.title !== undefined && !body.data.title.trim())) {
    invalid(res, "Invalid announcement update"); return;
  }
  const update = { ...body.data, ...(body.data.title !== undefined ? { title: body.data.title.trim() } : {}) };
  const [announcement] = await db.update(eduAnnouncementsTable).set(update).where(and(
    eq(eduAnnouncementsTable.id, params.data.itemId), eq(eduAnnouncementsTable.courseId, course.id),
  )).returning();
  if (!announcement) { res.status(404).json({ error: "Announcement not found" }); return; }
  res.json(UpdateEduAnnouncementResponse.parse({ announcement }));
});

router.delete("/edu/courses/:id/announcements/:itemId", async (req, res): Promise<void> => {
  const params = DeleteEduAnnouncementParams.safeParse(req.params);
  const course = params.success ? await ownedEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!params.success || !course) { res.status(404).json({ error: "Announcement not found" }); return; }
  const [deleted] = await db.delete(eduAnnouncementsTable).where(and(
    eq(eduAnnouncementsTable.id, params.data.itemId), eq(eduAnnouncementsTable.courseId, course.id),
  )).returning({ id: eduAnnouncementsTable.id });
  if (!deleted) { res.status(404).json({ error: "Announcement not found" }); return; }
  res.sendStatus(204);
});

router.post("/edu/courses/:id/materials", async (req, res): Promise<void> => {
  const params = CreateEduMaterialParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "EDU course not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const body = CreateEduMaterialBody.safeParse(req.body);
  if (!body.success || !body.data.title.trim() || !validWebUrl(body.data.url)) { invalid(res, "Invalid web material link"); return; }
  const [material] = await db.insert(eduMaterialsTable).values({
    courseId: course.id, title: body.data.title.trim(), url: body.data.url,
    description: body.data.description ?? null,
  }).returning();
   res.status(201).json(CreateEduMaterialResponse.parse({ material: publicFileRow(material) }));
});

router.post("/edu/courses/:id/materials/uploads", async (req, res): Promise<void> => {
  const course = await ownedEduCourse(getAuth(req).userId!, req.params.id);
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const file = courseUpload(req.body);
  const title = req.body?.title, description = req.body?.description;
  if (!file || typeof title !== "string" || !title.trim() || title.length > 200 ||
    (description !== undefined && (typeof description !== "string" || description.length > 4000))) {
    invalid(res, "Choose a PDF, TXT, PNG, JPG, DOCX, or PPTX file no larger than 10 MB with a title."); return;
  }
  const key = `edu-files/${course.id}/materials/${randomUUID()}`;
  try {
    await fileStorage.uploadObject(key, file.buffer, file.mimeType);
    const [material] = await db.insert(eduMaterialsTable).values({
      courseId: course.id, title: title.trim(), description: description || null, url: "",
      fileKey: key, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.buffer.length,
    }).returning();
    res.status(201).json(CreateEduMaterialResponse.parse({ material: publicFileRow(material) }));
  } catch (error) {
    await removeCourseFile(key).catch(cleanupError => req.log.error({ err: cleanupError }, "EDU orphaned material cleanup failed"));
    req.log.error({ err: error }, "EDU material upload failed");
    res.status(503).json({ error: "Could not save the course file. Please retry." });
  }
});

router.get("/edu/courses/:id/materials/:itemId/file", async (req, res): Promise<void> => {
  const course = await accessibleEduCourse(getAuth(req).userId!, req.params.id);
  if (!course || !uuidPattern.test(req.params.itemId)) { res.status(404).json({ error: "Material not found" }); return; }
  const [row] = await db.select().from(eduMaterialsTable).where(and(eq(eduMaterialsTable.id, req.params.itemId), eq(eduMaterialsTable.courseId, course.id)));
  if (!row?.fileKey || !row.filename || !row.mimeType) { res.status(404).json({ error: "Material not found" }); return; }
  await serveCourseFile(req, res, row.fileKey, row.filename, row.mimeType);
});

router.patch("/edu/courses/:id/materials/:itemId", async (req, res): Promise<void> => {
  const params = UpdateEduMaterialParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Material not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "Material not found" }); return; }
   const [existing] = await db.select({ id: eduMaterialsTable.id, fileKey: eduMaterialsTable.fileKey }).from(eduMaterialsTable).where(and(
    eq(eduMaterialsTable.id, params.data.itemId), eq(eduMaterialsTable.courseId, course.id),
  ));
  if (!existing) { res.status(404).json({ error: "Material not found" }); return; }
  const body = UpdateEduMaterialBody.safeParse(req.body);
  if (!body.success || !Object.keys(body.data).length ||
    (body.data.title !== undefined && !body.data.title.trim()) ||
     (body.data.url !== undefined && (Boolean(existing.fileKey) || !validWebUrl(body.data.url)))) {
    invalid(res, "Invalid material update"); return;
  }
  const [material] = await db.update(eduMaterialsTable).set({
    ...body.data,
    ...(body.data.title !== undefined ? { title: body.data.title.trim() } : {}),
  }).where(and(eq(eduMaterialsTable.id, params.data.itemId), eq(eduMaterialsTable.courseId, course.id))).returning();
  if (!material) { res.status(404).json({ error: "Material not found" }); return; }
   res.json(UpdateEduMaterialResponse.parse({ material: publicFileRow(material) }));
});

router.delete("/edu/courses/:id/materials/:itemId", async (req, res): Promise<void> => {
  const params = DeleteEduMaterialParams.safeParse(req.params);
  const course = params.success ? await ownedEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!params.success || !course) { res.status(404).json({ error: "Material not found" }); return; }
   const [existing] = await db.select().from(eduMaterialsTable).where(and(eq(eduMaterialsTable.id, params.data.itemId), eq(eduMaterialsTable.courseId, course.id)));
   if (!existing) { res.status(404).json({ error: "Material not found" }); return; }
   if (existing.fileKey) {
     try { await removeCourseFile(existing.fileKey); }
     catch (error) { req.log.error({ err: error }, "EDU material file removal failed"); res.status(503).json({ error: "Could not remove the file. Please retry." }); return; }
   }
   const [deleted] = await db.delete(eduMaterialsTable).where(and(
    eq(eduMaterialsTable.id, params.data.itemId), eq(eduMaterialsTable.courseId, course.id),
  )).returning({ id: eduMaterialsTable.id });
  if (!deleted) { res.status(404).json({ error: "Material not found" }); return; }
  res.sendStatus(204);
});

router.post("/edu/courses/:id/assignments", async (req, res): Promise<void> => {
  const params = CreateEduAssignmentParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "EDU course not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "EDU course not found" }); return; }
  const body = CreateEduAssignmentBody.safeParse(req.body);
  if (!body.success || !body.data.title.trim() || !body.data.instructions.trim()) {
    invalid(res, body.success ? "Assignment title and instructions cannot be blank" : body.error.message); return;
  }
  const hasDueAt = Object.hasOwn(req.body ?? {}, "dueAt");
  const dueAt = hasDueAt ? parseDueAt(req.body.dueAt) : undefined;
  if (hasDueAt && dueAt === undefined) { invalid(res, "dueAt must be a valid ISO date-time"); return; }
  const [assignment] = await db.insert(eduAssignmentsTable).values({
    courseId: course.id, title: body.data.title.trim(), instructions: body.data.instructions,
    points: body.data.points, ...(dueAt !== undefined ? { dueAt } : {}),
  }).returning();
  const { courseId: _courseId, ...publicAssignment } = assignment;
   res.status(201).json(CreateEduAssignmentResponse.parse({ assignment: publicFileRow(publicAssignment) }));
});

router.patch("/edu/courses/:id/assignments/:itemId", async (req, res): Promise<void> => {
  const params = UpdateEduAssignmentParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Assignment not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "Assignment not found" }); return; }
  const [existing] = await db.select({ id: eduAssignmentsTable.id }).from(eduAssignmentsTable).where(and(
    eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id),
  ));
  if (!existing) { res.status(404).json({ error: "Assignment not found" }); return; }
  const body = UpdateEduAssignmentBody.safeParse(req.body);
  if (!body.success || !Object.keys(body.data).length ||
    (body.data.title !== undefined && !body.data.title.trim()) ||
    (body.data.instructions !== undefined && !body.data.instructions.trim())) {
    invalid(res, "Invalid assignment update"); return;
  }
  const hasDueAt = Object.hasOwn(req.body ?? {}, "dueAt");
  const dueAt = hasDueAt ? parseDueAt(req.body.dueAt) : undefined;
  if (hasDueAt && dueAt === undefined) { invalid(res, "dueAt must be a valid ISO date-time"); return; }
  const { dueAt: _rawDueAt, ...fields } = body.data;
  if (body.data.points !== undefined) {
    const conflictingGrades = await db.select({ score: eduSubmissionsTable.score }).from(eduSubmissionsTable)
      .where(and(
        eq(eduSubmissionsTable.assignmentId, params.data.itemId),
        sql`${eduSubmissionsTable.score} is not null`,
        gt(eduSubmissionsTable.score, body.data.points),
      )).limit(1);
    if (conflictingGrades.length) { invalid(res, "Assignment points cannot be lower than an existing score"); return; }
  }
  const [assignment] = await db.update(eduAssignmentsTable).set({
    ...fields,
    ...(body.data.title !== undefined ? { title: body.data.title.trim() } : {}),
    ...(hasDueAt ? { dueAt: dueAt ?? null } : {}),
  }).where(and(eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id))).returning();
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  const { courseId: _courseId, ...publicAssignment } = assignment;
   res.json(UpdateEduAssignmentResponse.parse({ assignment: publicFileRow(publicAssignment) }));
});

router.post("/edu/courses/:id/assignments/:itemId/attachment", async (req, res): Promise<void> => {
  const course = await ownedEduCourse(getAuth(req).userId!, req.params.id);
  if (!course || !uuidPattern.test(req.params.itemId)) { res.status(404).json({ error: "Assignment not found" }); return; }
  const [assignment] = await db.select().from(eduAssignmentsTable).where(and(eq(eduAssignmentsTable.id, req.params.itemId), eq(eduAssignmentsTable.courseId, course.id)));
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  if (assignment.fileKey) { res.status(409).json({ error: "Remove the current attachment before uploading another." }); return; }
  const file = courseUpload(req.body);
  if (!file) { invalid(res, "Choose a PDF, TXT, PNG, JPG, DOCX, or PPTX file no larger than 10 MB."); return; }
  const key = `edu-files/${course.id}/assignments/${randomUUID()}`;
  try {
    await fileStorage.uploadObject(key, file.buffer, file.mimeType);
    const [updated] = await db.update(eduAssignmentsTable).set({
      fileKey: key, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.buffer.length,
    }).where(and(eq(eduAssignmentsTable.id, assignment.id), eq(eduAssignmentsTable.courseId, course.id), isNull(eduAssignmentsTable.fileKey))).returning();
    if (!updated) {
      await removeCourseFile(key);
      res.status(409).json({ error: "The assignment changed. Refresh and retry." }); return;
    }
    const { courseId: _courseId, ...publicAssignment } = updated;
    res.json(UpdateEduAssignmentResponse.parse({ assignment: publicFileRow(publicAssignment) }));
  } catch (error) {
    await removeCourseFile(key).catch(cleanupError => req.log.error({ err: cleanupError }, "EDU orphaned attachment cleanup failed"));
    req.log.error({ err: error }, "EDU assignment attachment upload failed");
    res.status(503).json({ error: "Could not save the attachment. Please retry." });
  }
});

router.get("/edu/courses/:id/assignments/:itemId/file", async (req, res): Promise<void> => {
  const course = await accessibleEduCourse(getAuth(req).userId!, req.params.id);
  if (!course || !uuidPattern.test(req.params.itemId)) { res.status(404).json({ error: "Assignment not found" }); return; }
  const [row] = await db.select().from(eduAssignmentsTable).where(and(eq(eduAssignmentsTable.id, req.params.itemId), eq(eduAssignmentsTable.courseId, course.id)));
  if (!row?.fileKey || !row.filename || !row.mimeType) { res.status(404).json({ error: "Assignment not found" }); return; }
  await serveCourseFile(req, res, row.fileKey, row.filename, row.mimeType);
});

router.delete("/edu/courses/:id/assignments/:itemId/attachment", async (req, res): Promise<void> => {
  const course = await ownedEduCourse(getAuth(req).userId!, req.params.id);
  if (!course || !uuidPattern.test(req.params.itemId)) { res.status(404).json({ error: "Assignment not found" }); return; }
  const [row] = await db.select().from(eduAssignmentsTable).where(and(eq(eduAssignmentsTable.id, req.params.itemId), eq(eduAssignmentsTable.courseId, course.id)));
  if (!row?.fileKey) { res.status(404).json({ error: "Attachment not found" }); return; }
  try { await removeCourseFile(row.fileKey); }
  catch (error) { req.log.error({ err: error }, "EDU attachment removal failed"); res.status(503).json({ error: "Could not remove the attachment. Please retry." }); return; }
  await db.update(eduAssignmentsTable).set({ fileKey: null, filename: null, mimeType: null, sizeBytes: null })
    .where(and(eq(eduAssignmentsTable.id, row.id), eq(eduAssignmentsTable.courseId, course.id), eq(eduAssignmentsTable.fileKey, row.fileKey)));
  res.sendStatus(204);
});

router.delete("/edu/courses/:id/assignments/:itemId", async (req, res): Promise<void> => {
  const params = DeleteEduAssignmentParams.safeParse(req.params);
  const course = params.success ? await ownedEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!params.success || !course) { res.status(404).json({ error: "Assignment not found" }); return; }
  const result = await db.transaction(async tx => {
    const [assignment] = await tx.select().from(eduAssignmentsTable).where(and(
      eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id),
    )).for("update");
    if (!assignment) return;
    const submissions = await tx.select().from(eduSubmissionsTable)
      .where(eq(eduSubmissionsTable.assignmentId, assignment.id));
    const cleanup = [];
    for (const key of [assignment.fileKey, ...submissions.map(s => s.fileKey)]) {
      if (key) cleanup.push(await queueSubmissionFileCleanup(tx, key));
    }
    await tx.delete(eduAssignmentsTable).where(eq(eduAssignmentsTable.id, assignment.id));
    return cleanup;
  });
  if (!result) { res.status(404).json({ error: "Assignment not found" }); return; }
  const cleanupPending = await cleanSubmissionFiles(result);
  if (cleanupPending) req.log.warn("Deleted EDU assignment files queued for cleanup");
  res.sendStatus(204);
});

router.post("/edu/courses/:id/assignments/:itemId/submission", async (req, res): Promise<void> => {
  const params = SubmitEduAssignmentParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Assignment not found" }); return; }
  const userId = getAuth(req).userId!;
  const course = await accessibleEduCourse(userId, params.data.id);
  if (!course || course.role !== "student") { res.status(404).json({ error: "Assignment not found" }); return; }
  const [assignment] = await db.select({ id: eduAssignmentsTable.id }).from(eduAssignmentsTable).where(and(
    eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id),
  ));
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  const body = SubmitEduAssignmentBody.safeParse(req.body);
  if (!body.success) { invalid(res, body.error.message); return; }
  const hasAttachment = Object.hasOwn(req.body, "attachment");
  const file = hasAttachment && req.body.attachment !== null ? courseUpload(req.body.attachment) : undefined;
  if (hasAttachment && req.body.attachment !== null && !file) {
    invalid(res, "Choose a PDF, TXT, PNG, JPG, DOCX, or PPTX file no larger than 10 MB."); return;
  }
  const key = file ? `edu/submissions/${course.id}/${assignment.id}/${randomUUID()}` : undefined;
  let reservation: Awaited<ReturnType<typeof queueSubmissionFileCleanup>> | undefined;
  let committed = false;
  try {
    const result = await db.transaction(async tx => {
      // The same lock is used by grading and assignment deletion. Serializing here also
      // prevents simultaneous first submissions/replacements from orphaning each other's files.
      const [lockedAssignment] = await tx.select().from(eduAssignmentsTable).where(and(
        eq(eduAssignmentsTable.id, assignment.id), eq(eduAssignmentsTable.courseId, course.id),
      )).for("update");
      if (!lockedAssignment) return { error: 404 as const };
      const [existing] = await tx.select().from(eduSubmissionsTable).where(and(
        eq(eduSubmissionsTable.assignmentId, assignment.id), eq(eduSubmissionsTable.studentId, userId),
      )).for("update");
      if (existing && existing.score !== null) return { error: 409 as const };
      if (!body.data.text.trim() && !file && !(existing?.fileKey && !hasAttachment)) return { error: 400 as const };
      if (file && key) {
        // This reservation is committed independently before bytes, so even a process
        // crash during upload leaves a durable cleanup path. The old file stays intact.
        reservation = await queueSubmissionFileCleanup(db, key, true);
        await fileStorage.uploadObject(key, file.buffer, file.mimeType);
      }
      const cleanup = [];
      if (hasAttachment && existing?.fileKey) cleanup.push(await queueSubmissionFileCleanup(tx, existing.fileKey));
      const fields = {
        text: body.data.text,
        ...(hasAttachment ? {
          fileKey: key ?? null, filename: file?.filename ?? null,
          mimeType: file?.mimeType ?? null, sizeBytes: file?.buffer.length ?? null,
        } : {}),
      };
      const [submission] = existing
        ? await tx.update(eduSubmissionsTable).set(fields).where(eq(eduSubmissionsTable.id, existing.id)).returning()
        : await tx.insert(eduSubmissionsTable).values({ assignmentId: assignment.id, studentId: userId, ...fields }).returning();
      if (reservation) await tx.delete(classscribePrivacyDeletionOutboxTable)
        .where(eq(classscribePrivacyDeletionOutboxTable.id, reservation.id));
      return { submission, cleanup };
    });
    if (result.error !== undefined) {
      res.status(result.error).json({ error: result.error === 409 ? "This submission has already been graded"
        : result.error === 400 ? "Add a response or attach a file." : "Assignment not found" }); return;
    }
    committed = true;
    const cleanupPending = await cleanSubmissionFiles(result.cleanup);
    res.json(SubmitEduAssignmentResponse.parse({ submission: publicFileRow(result.submission), cleanupPending }));
  } catch (error) {
    if (reservation && !committed) {
      // A lost COMMIT reply is ambiguous. Its reservation disappears only with the
      // successful row write, so never delete bytes from a possibly committed save.
      try {
        const pending = await db.select().from(classscribePrivacyDeletionOutboxTable)
          .where(eq(classscribePrivacyDeletionOutboxTable.id, reservation.id));
        await cleanSubmissionFiles(pending);
      } catch (cleanupError) {
        req.log.error({ err: cleanupError }, "EDU failed upload cleanup remains queued");
      }
    }
    req.log.error({ err: error }, "EDU submission save failed");
    res.status(503).json({ error: "Could not confirm your submission was saved. Reopen your submission before retrying." });
  }
});

router.delete("/edu/courses/:id/assignments/:itemId/submission", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const params = SubmitEduAssignmentParams.safeParse(req.params);
  const course = params.success ? await accessibleEduCourse(userId, params.data.id) : undefined;
  if (!course || course.role !== "student" || !params.success) { res.status(404).json({ error: "Submission not found" }); return; }
  const result = await db.transaction(async tx => {
    const [assignment] = await tx.select().from(eduAssignmentsTable).where(and(
      eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id),
    )).for("update");
    if (!assignment) return { error: 404 as const };
    const [submission] = await tx.select().from(eduSubmissionsTable).where(and(
      eq(eduSubmissionsTable.assignmentId, assignment.id), eq(eduSubmissionsTable.studentId, userId),
    )).for("update");
    if (!submission) return { error: 404 as const };
    if (submission.score !== null) return { error: 409 as const };
    const cleanup = submission.fileKey ? [await queueSubmissionFileCleanup(tx, submission.fileKey)] : [];
    await tx.delete(eduSubmissionsTable).where(eq(eduSubmissionsTable.id, submission.id));
    return { cleanup };
  });
  if (result.error !== undefined) {
    res.status(result.error).json({ error: result.error === 409 ? "This submission has already been graded" : "Submission not found" }); return;
  }
  res.json({ cleanupPending: await cleanSubmissionFiles(result.cleanup) });
});

router.get("/edu/courses/:id/assignments/:itemId/submissions/:submissionId/file", async (req, res): Promise<void> => {
  const params = GradeEduSubmissionParams.safeParse(req.params);
  const userId = getAuth(req).userId!;
  const course = params.success ? await accessibleEduCourse(userId, params.data.id) : undefined;
  if (!params.success || !course) { res.status(404).json({ error: "Submission file not found" }); return; }
  const [row] = await db.select({ submission: eduSubmissionsTable }).from(eduSubmissionsTable)
    .innerJoin(eduAssignmentsTable, eq(eduAssignmentsTable.id, eduSubmissionsTable.assignmentId))
    .where(and(
      eq(eduAssignmentsTable.courseId, course.id), eq(eduAssignmentsTable.id, params.data.itemId),
      eq(eduSubmissionsTable.id, params.data.submissionId),
      ...(course.role === "student" ? [eq(eduSubmissionsTable.studentId, userId)] : []),
    ));
  if (!row?.submission.fileKey || !row.submission.filename || !row.submission.mimeType) {
    res.status(404).json({ error: "Submission file not found" }); return;
  }
  await serveCourseFile(req, res, row.submission.fileKey, row.submission.filename, row.submission.mimeType);
});

router.get("/edu/courses/:id/assignments/:itemId/submissions", async (req, res): Promise<void> => {
  const params = ListEduSubmissionsParams.safeParse(req.params);
  const course = params.success ? await ownedEduCourse(getAuth(req).userId!, params.data.id) : undefined;
  if (!course || !params.success) { res.status(404).json({ error: "Assignment not found" }); return; }
  const [assignment] = await db.select({ id: eduAssignmentsTable.id }).from(eduAssignmentsTable).where(and(
    eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id),
  ));
  if (!assignment) { res.status(404).json({ error: "Assignment not found" }); return; }
  const submissions = await db.select().from(eduSubmissionsTable).where(eq(eduSubmissionsTable.assignmentId, assignment.id))
    .orderBy(asc(eduSubmissionsTable.submittedAt));
  const studentNames = await verifiedDisplayNames(req, submissions.map(submission => submission.studentId));
  res.json(ListEduSubmissionsResponse.parse({ submissions: submissions.map(submission => ({
    id: submission.id, text: submission.text, score: submission.score,
    feedback: submission.feedback, submittedAt: submission.submittedAt,
    filename: submission.filename, mimeType: submission.mimeType, sizeBytes: submission.sizeBytes,
    studentId: submission.studentId, studentName: studentNames.get(submission.studentId) ?? submission.studentId,
  })) }));
});

router.patch("/edu/courses/:id/assignments/:itemId/submissions/:submissionId", async (req, res): Promise<void> => {
  const params = GradeEduSubmissionParams.safeParse(req.params);
  if (!params.success) { res.status(404).json({ error: "Submission not found" }); return; }
  const course = await ownedEduCourse(getAuth(req).userId!, params.data.id);
  if (!course) { res.status(404).json({ error: "Submission not found" }); return; }
  const [assignment] = await db.select({ id: eduAssignmentsTable.id, points: eduAssignmentsTable.points }).from(eduAssignmentsTable)
    .where(and(eq(eduAssignmentsTable.id, params.data.itemId), eq(eduAssignmentsTable.courseId, course.id)));
  if (!assignment) { res.status(404).json({ error: "Submission not found" }); return; }
  const [existingSubmission] = await db.select({ id: eduSubmissionsTable.id }).from(eduSubmissionsTable).where(and(
    eq(eduSubmissionsTable.id, params.data.submissionId),
    eq(eduSubmissionsTable.assignmentId, assignment.id),
  ));
  if (!existingSubmission) { res.status(404).json({ error: "Submission not found" }); return; }
  const body = GradeEduSubmissionBody.safeParse(req.body);
  if (!body.success) { invalid(res, body.error.message); return; }
  if (body.data.score > assignment.points) { invalid(res, "Score cannot exceed assignment points"); return; }
  const submission = await db.transaction(async tx => {
    const [lockedAssignment] = await tx.select().from(eduAssignmentsTable).where(and(
      eq(eduAssignmentsTable.id, assignment.id), eq(eduAssignmentsTable.courseId, course.id),
    )).for("update");
    if (!lockedAssignment || body.data.score > lockedAssignment.points) return undefined;
    const [updated] = await tx.update(eduSubmissionsTable).set({
    score: body.data.score, feedback: body.data.feedback,
  }).where(and(
    eq(eduSubmissionsTable.id, params.data.submissionId),
    eq(eduSubmissionsTable.assignmentId, assignment.id),
    )).returning();
    return updated;
  });
  if (!submission) { res.status(404).json({ error: "Submission not found" }); return; }
  res.json(GradeEduSubmissionResponse.parse({ submission: {
    id: submission.id, text: submission.text, score: submission.score,
    feedback: submission.feedback, submittedAt: submission.submittedAt,
    filename: submission.filename, mimeType: submission.mimeType, sizeBytes: submission.sizeBytes,
  } }));
});

export default router;