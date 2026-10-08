import { createHash } from "node:crypto";
import { Router } from "express";
import { eq, like, sql } from "drizzle-orm";
import { db, classscribeLegacyDocumentsTable as documents } from "@workspace/db";
import { ConfirmLibrarySyllabusBody } from "@workspace/api-zod";
import { isRecord, validUid } from "../lib/classscribe-legacy-access";
import { lockPrivacyLibraryWrite } from "../lib/privacy-access";
import { BillingError, enforceLegacyCourseLimit, revalidateExpiredStripeEntitlement } from "../lib/classscribe-billing";

const router = Router();
const titleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

router.post("/syllabus/confirm", async (req, res): Promise<void> => {
  const uid = req.get("X-CS-User")?.trim() ?? "";
  if (!validUid(uid)) { res.status(403).json({ code: "not_granted", error: "Not allowed" }); return; }
  const parsed = ConfirmLibrarySyllabusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid syllabus confirmation" }); return; }
  const input = parsed.data;
  const selected = new Set(input.selectedDates);
  if (selected.size !== input.selectedDates.length ||
    input.assignments.some(a => !a.title.trim() || (a.due !== "" && !validDate(a.due))) ||
    input.selectedDates.some(i => !input.assignments[i]?.due)) {
    res.status(400).json({ error: "Select valid coursework dates using YYYY-MM-DD" }); return;
  }
  try {
    await revalidateExpiredStripeEntitlement(uid);
    const result = await db.transaction(async tx => {
      await lockPrivacyLibraryWrite(tx, uid);
      // Serialize confirms and course-limit checks for the same library.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`course-limit:${uid}`}))`);
      const revokedPath = `revoked/${createHash("sha256").update(uid).digest("hex")}`;
      const [revoked] = await tx.select().from(documents).where(eq(documents.path, revokedPath)).limit(1);
      if (revoked) throw new BillingError(403, "not_granted", "This sync code has been replaced");
      const root = `data/users/${uid}/lib`;
      const coursePath = `${root}/courses/${input.courseId}`;
      const [row] = await tx.select().from(documents).where(eq(documents.path, coursePath)).limit(1);
      const previous = isRecord(row?.data) ? row.data : null;
      const previousConfirmation = isRecord(previous?.syllabusConfirmation) ? previous.syllabusConfirmation : null;
      const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const stored = await tx.select().from(documents).where(like(documents.path, `${root}/assignments/%`));
      const coursework = stored.map(r => r.data).filter(isRecord).filter(a => a.courseId === input.courseId);
      if (previousConfirmation?.importId === input.importId) {
        if (previousConfirmation.fingerprint !== fingerprint) throw new BillingError(409, "conflict", "This confirmation was already saved with different selections. Reopen the syllabus import.");
        return { course: previous!, assignments: coursework.filter(a => a.syllabusImportId === input.importId)
          .sort((a, b) => Number(a.syllabusPosition) - Number(b.syllabusPosition)) };
      }
      if (input.existing && !previous) throw new BillingError(409, "conflict", "Course not found. Import the syllabus again.");
      if (!input.existing && previous) throw new BillingError(409, "conflict", "Course already exists. Import the syllabus again.");
      if (previous?.ex) throw new BillingError(403, "not_granted", "Example content is read-only.");
      if (!(await enforceLegacyCourseLimit(tx, uid, coursePath))) {
        throw new BillingError(402, "plan_limit", "The Free plan includes 3 courses. Upgrade to Student for unlimited courses.");
      }
      const counts = new Map<string, number>(), dateCounts = new Map<string, number>();
      for (const a of [...coursework, ...input.assignments]) {
        if (typeof a.title === "string") counts.set(titleKey(a.title), (counts.get(titleKey(a.title)) ?? 0) + 1);
      }
      input.assignments.forEach((a, i) => {
        if (selected.has(i)) dateCounts.set(titleKey(a.title), (dateCounts.get(titleKey(a.title)) ?? 0) + 1);
      });
      const assignments = input.assignments.map((a, i) => {
        const confirmed = selected.has(i) && counts.get(titleKey(a.title)) === 1 && dateCounts.get(titleKey(a.title)) === 1;
        return { id: createHash("sha256").update(`${input.courseId}:${input.importId}:${i}`).digest("hex").slice(0, 32),
          courseId: input.courseId, title: a.title.trim(), type: a.type, due: confirmed ? a.due : "",
          done: false, dateConfirmed: confirmed, ex: false, source: "syllabus", syllabusImportId: input.importId, syllabusPosition: i };
      });
      const syllabusDates = input.assignments.flatMap((a, i) => selected.has(i) ? [{
        id: `${input.importId}-${i}`, title: a.title.trim(), due: a.due,
        linkStatus: counts.get(titleKey(a.title))! > 1 || dateCounts.get(titleKey(a.title))! > 1 ? "ambiguous" : "linked",
      }] : []);
      const course = { ...(previous ?? { id: input.courseId, ...input.course, color: 0, created: Date.now() }),
        modules: input.modules, syllabusDates, syllabusConfirmation: { importId: input.importId, fingerprint } };
      for (const [path, data] of [[coursePath, course], ...assignments.map(a => [`${root}/assignments/${a.id}`, a])] as [string, Record<string, unknown>][]) {
        await tx.insert(documents).values({ path, data }).onConflictDoUpdate({
          target: documents.path, set: { data, updatedAt: new Date() },
        });
      }
      return { course, assignments };
    });
    // Reply only once every course/date/coursework write has committed.
    res.json(result);
  } catch (error) {
    if (error instanceof BillingError) { res.status(error.httpStatus).json({ code: error.code, error: error.message }); return; }
    if (error instanceof Error && "status" in error && error.status === 410) {
      res.status(410).json({ code: "not_granted", error: error.message }); return;
    }
    req.log.error({ err: error }, "Syllabus confirmation failed");
    res.status(503).json({ code: "unavailable", error: "Could not confirm the syllabus. Try again." });
  }
});

export default router;
