import { createHash } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { eq, like } from "drizzle-orm";
import {
  ListStudentGradesBody,
  ListStudentGradesResponse,
  SaveStudentGradebookBody,
  SaveStudentGradebookResponse,
  type StudentGradebook,
  type StudentGradebookInput,
  type StudentGradeCourse,
} from "@workspace/api-zod";
import { classscribeLegacyDocumentsTable, db } from "@workspace/db";
import { BillingError, getLibraryBillingStatus } from "../lib/classscribe-billing";
import { isRecord, validUid } from "../lib/classscribe-legacy-access";
import { analyzeStudentGradebook, summarizeStudentGrades } from "../lib/student-grades";
import { assertPrivacyLibraryActive, lockPrivacyLibraryWrite } from "../lib/privacy-access";

const router: IRouter = Router();
const documentPath = classscribeLegacyDocumentsTable.path;
const MAX_BODY_BYTES = 100_000;
const itemKeys = ["id", "assignmentId", "title", "type", "earned", "possible", "date"];
const gradebookKeys = ["courseId", "credits", "weights", "items", "finalPercent", "version"];
const weightKeys = ["assignment", "project", "quiz", "test"];
const revokedPath = (uid: string): string =>
  `revoked/${createHash("sha256").update(uid).digest("hex")}`;
const coursePath = (uid: string, id: string): string => `data/users/${uid}/lib/courses/${id}`;
const assignmentPath = (uid: string, id: string): string => `data/users/${uid}/lib/assignments/${id}`;
const gradebookPath = (uid: string, id: string): string => `data/users/${uid}/lib/gradebooks/${id}`;
const gradebookPrefix = (uid: string): string => `data/users/${uid}/lib/gradebooks/`;

function requestSize(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch { return Number.POSITIVE_INFINITY; }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validIsoDay(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateGradebook(value: unknown): value is StudentGradebookInput {
  if (!SaveStudentGradebookBody.safeParse({ gradebook: value }).success ||
    !isRecord(value) || !hasOnlyKeys(value, gradebookKeys) ||
    !/^[A-Za-z0-9_.~:-]{1,160}$/.test(String(value.courseId ?? "")) ||
    value.courseId === "." || value.courseId === "..") return false;
  if (value.weights !== null) {
    const weights = value.weights;
    if (!isRecord(weights) || !hasOnlyKeys(weights, weightKeys) ||
      weightKeys.some((key) => typeof weights[key] !== "number")) return false;
    const sum = weightKeys.reduce((total, key) => total + (weights as Record<string, number>)[key], 0);
    if (Math.abs(sum - 100) > 0.001) return false;
  }
  if (!Array.isArray(value.items) || value.items.length > 100) return false;
  const itemIds = new Set<string>();
  const assignmentIds = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || !hasOnlyKeys(item, itemKeys) ||
      typeof item.id !== "string" || !item.id.trim() || item.id.length > 160 ||
      itemIds.has(item.id) ||
      (item.assignmentId !== undefined && (typeof item.assignmentId !== "string" ||
        !/^[A-Za-z0-9_.~:-]{1,160}$/.test(item.assignmentId) ||
        item.assignmentId === "." || item.assignmentId === ".." || assignmentIds.has(item.assignmentId))) ||
      typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 ||
      !["assignment", "project", "quiz", "test"].includes(String(item.type)) ||
      typeof item.possible !== "number" || !Number.isFinite(item.possible) || item.possible <= 0 ||
      (item.earned !== null && (typeof item.earned !== "number" ||
        !Number.isFinite(item.earned) || item.earned < 0 || item.earned > item.possible)) ||
      (item.date !== undefined && item.date !== null && !validIsoDay(item.date))) return false;
    itemIds.add(item.id);
    if (typeof item.assignmentId === "string") assignmentIds.add(item.assignmentId);
  }
  return true;
}

function normalizeGradebook(gradebook: StudentGradebookInput | StudentGradebook): StudentGradebook {
  return {
    ...gradebook,
    items: gradebook.items.map((item) => ({
      ...item,
      date: item.date ?? null,
    })),
  };
}

function unauthorized(res: Response): void {
  res.status(403).json({ code: "not_granted", error: "An active Student or Pro plan is required." });
}

async function authorizePaidLibrary(uid: string): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    const status = await getLibraryBillingStatus(uid);
    return status.plan === "student" || status.plan === "pro" ? "allowed" : "denied";
  } catch (error) {
    if (error instanceof BillingError && error.httpStatus === 403) return "denied";
    return "unavailable";
  }
}

async function loadCourseGradebooks(uid: string): Promise<StudentGradeCourse[]> {
  return db.transaction(async (tx) => {
    await assertPrivacyLibraryActive(tx, uid);
    const [revoked] = await tx.select({ path: documentPath })
      .from(classscribeLegacyDocumentsTable).where(eq(documentPath, revokedPath(uid))).limit(1);
    if (revoked) throw new Error("This sync code has been replaced.");
    const savedRows = await tx.select({ path: documentPath, data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(like(documentPath, `${gradebookPrefix(uid)}%`))
      .limit(5_000);
    const books: StudentGradeCourse[] = [];
    for (const row of savedRows.filter((item) => item.path.startsWith(gradebookPrefix(uid)))) {
      const courseId = row.path.slice(gradebookPrefix(uid).length);
      if (!courseId || courseId.includes("/")) continue;
      const [course] = await tx.select({ path: documentPath })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(documentPath, coursePath(uid, courseId))).limit(1);
      if (!course) continue;
      if (!isRecord(row.data) || !validateGradebook(row.data)) {
        throw new Error("Stored gradebook data is invalid.");
      }
      if (row.data.courseId !== courseId) throw new Error("Stored gradebook course does not match its library path.");
      const gradebook = normalizeGradebook(row.data);
      books.push({ gradebook, analysis: analyzeStudentGradebook(gradebook) });
    }
    return books.sort((left, right) => left.gradebook.courseId.localeCompare(right.gradebook.courseId));
  });
}

router.post("/student/grades/list", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const uid = req.get("X-CS-User")?.trim() ?? "";
  if (!validUid(uid)) { unauthorized(res); return; }
  if (!isRecord(req.body) || Object.keys(req.body).length !== 0 ||
    !ListStudentGradesBody.safeParse(req.body).success || requestSize(req.body) > MAX_BODY_BYTES) {
    res.status(400).json({ error: "The list request body must be an empty object." });
    return;
  }
  const access = await authorizePaidLibrary(uid);
  if (access === "denied") { unauthorized(res); return; }
  if (access === "unavailable") {
    req.log.warn("Paid plan verification unavailable for student grade list");
    res.status(503).json({ code: "unavailable", error: "Paid plan verification is temporarily unavailable." });
    return;
  }
  try {
    const courses = await loadCourseGradebooks(uid);
    res.json(ListStudentGradesResponse.parse({ courses, summary: summarizeStudentGrades(courses) }));
  } catch (error) {
    if (error instanceof Error && error.message.includes("sync code has been replaced")) {
      unauthorized(res);
      return;
    }
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Student gradebooks could not be read");
    res.status(500).json({ error: "Student gradebooks could not be read." });
  }
});

router.post("/student/grades/save", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const uid = req.get("X-CS-User")?.trim() ?? "";
  if (!validUid(uid)) { unauthorized(res); return; }
  if (!isRecord(req.body) || !hasOnlyKeys(req.body, ["gradebook"]) ||
    !SaveStudentGradebookBody.safeParse(req.body).success ||
    requestSize(req.body) > MAX_BODY_BYTES || !validateGradebook(req.body.gradebook)) {
    res.status(400).json({ error: "The gradebook contains invalid data." });
    return;
  }
  const gradebook = req.body.gradebook;
  const access = await authorizePaidLibrary(uid);
  if (access === "denied") { unauthorized(res); return; }
  if (access === "unavailable") {
    req.log.warn("Paid plan verification unavailable for student grade save");
    res.status(503).json({ code: "unavailable", error: "Paid plan verification is temporarily unavailable." });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      await lockPrivacyLibraryWrite(tx, uid);
      const [revoked] = await tx.select({ path: documentPath })
        .from(classscribeLegacyDocumentsTable).where(eq(documentPath, revokedPath(uid))).limit(1);
      if (revoked) return { kind: "denied" as const };
      const [course] = await tx.select({ path: documentPath })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(documentPath, coursePath(uid, gradebook.courseId))).limit(1);
      if (!course) return { kind: "missing_course" as const };
      const path = gradebookPath(uid, gradebook.courseId);
      const [saved] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable).where(eq(documentPath, path)).limit(1);
      if (saved && (!isRecord(saved.data) || !validateGradebook(saved.data))) {
        return { kind: "invalid_stored" as const };
      }
      const previous = saved?.data as StudentGradebookInput | undefined;
      const currentVersion = previous?.version ?? 0;
      if (gradebook.version !== currentVersion) return { kind: "conflict" as const };
      for (const item of gradebook.items) {
        if (!item.assignmentId) continue;
        const prior = previous?.items.find((old) => old.assignmentId === item.assignmentId);
        if (prior && prior.id !== item.id) return { kind: "invalid_link" as const };
        if (!prior) {
          const [source] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
            .from(classscribeLegacyDocumentsTable)
            .where(eq(documentPath, assignmentPath(uid, item.assignmentId))).limit(1);
          if (!isRecord(source?.data) || source.data.courseId !== gradebook.courseId || source.data.ex === true)
            return { kind: "invalid_link" as const };
        }
      }
      const next = normalizeGradebook({
        ...gradebook,
        version: currentVersion + 1,
      });
      await tx.insert(classscribeLegacyDocumentsTable).values({ path, data: next })
        .onConflictDoUpdate({ target: documentPath, set: { data: next, updatedAt: new Date() } });
      return { kind: "saved" as const };
    });
    if (result.kind === "denied") { unauthorized(res); return; }
    if (result.kind === "missing_course") {
      res.status(404).json({ error: "Course not found in this sync-code library." });
      return;
    }
    if (result.kind === "invalid_stored") {
      res.status(500).json({ error: "Stored gradebook data is invalid." });
      return;
    }
    if (result.kind === "conflict") {
      res.status(409).json({ error: "This gradebook changed elsewhere. Refresh it and try again." });
      return;
    }
    if (result.kind === "invalid_link") {
      res.status(400).json({ error: "The linked assignment is not in this course and library, or already has another score." });
      return;
    }
    const courses = await loadCourseGradebooks(uid);
    res.json(SaveStudentGradebookResponse.parse({ courses, summary: summarizeStudentGrades(courses) }));
  } catch (error) {
    if (error instanceof Error && error.message.includes("sync code has been replaced")) {
      unauthorized(res);
      return;
    }
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Student gradebook could not be saved");
    res.status(500).json({ error: "Student gradebook could not be saved." });
  }
});

export default router;