import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
import { db, lecturesTable, notesTable } from "@workspace/db";
import {
  CreateNoteBody,
  CreateNoteResponse,
  ListNotesResponse,
  GetNoteResponse,
  UpdateNoteBody,
} from "@workspace/api-zod";
import { canAccessCourse } from "./course-access";

const router: IRouter = Router();
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function validateLinks(userId: string, courseId?: string | null, lectureId?: string | null) {
  if (courseId && (!isUuid(courseId) || !(await canAccessCourse(userId, courseId)))) return false;
  if (lectureId) {
    if (!isUuid(lectureId)) return false;
    const [lecture] = await db.select({ courseId: lecturesTable.courseId }).from(lecturesTable)
      .where(eq(lecturesTable.id, lectureId));
    if (!lecture || !(await canAccessCourse(userId, lecture.courseId)) || (courseId && lecture.courseId !== courseId)) return false;
  }
  return true;
}

router.get("/notes", async (req, res) => {
  const userId = getAuth(req).userId!;
  const notes = await db.select().from(notesTable).where(eq(notesTable.userId, userId)).orderBy(desc(notesTable.updatedAt));
  res.json(ListNotesResponse.parse(notes));
});

router.get("/notes/:id", async (req, res) => {
  const [note] = await db.select().from(notesTable)
    .where(and(eq(notesTable.id, String(req.params.id)), eq(notesTable.userId, getAuth(req).userId!)));
  if (!note) { res.status(404).json({ error: "Note not found" }); return; }
  res.json(GetNoteResponse.parse(note));
});

router.post("/notes", async (req, res) => {
  const parsed = CreateNoteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = getAuth(req).userId!;
  if (!(await validateLinks(userId, parsed.data.courseId, parsed.data.lectureId))) {
    res.status(404).json({ error: "Linked course or lecture not found" }); return;
  }
  const [note] = await db.insert(notesTable).values({
    userId, title: parsed.data.title, markdownBody: parsed.data.markdownBody,
    courseId: parsed.data.courseId ?? null, lectureId: parsed.data.lectureId ?? null,
    pinned: parsed.data.pinned ?? false, prevBody: parsed.data.prevBody ?? null,
  }).returning();
  res.status(201).json(CreateNoteResponse.parse(note));
});

router.patch("/notes/:id", async (req, res) => {
  const parsed = UpdateNoteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const userId = getAuth(req).userId!;
  const [existing] = await db.select().from(notesTable)
    .where(and(eq(notesTable.id, String(req.params.id)), eq(notesTable.userId, userId)));
  if (!existing) { res.status(404).json({ error: "Note not found" }); return; }
  const courseId = parsed.data.courseId === undefined ? existing.courseId : parsed.data.courseId;
  const lectureId = parsed.data.lectureId === undefined ? existing.lectureId : parsed.data.lectureId;
  if (!(await validateLinks(userId, courseId, lectureId))) {
    res.status(404).json({ error: "Linked course or lecture not found" }); return;
  }
  const update = {
    ...parsed.data,
    ...(parsed.data.markdownBody !== undefined && parsed.data.prevBody === undefined
      ? { prevBody: existing.markdownBody }
      : {}),
    updatedAt: new Date(),
  };
  const [note] = await db.update(notesTable).set({
    ...update,
  }).where(and(eq(notesTable.id, existing.id), eq(notesTable.userId, userId))).returning();
  res.json(GetNoteResponse.parse(note));
});

router.delete("/notes/:id", async (req, res) => {
  const deleted = await db.delete(notesTable).where(
    and(eq(notesTable.id, String(req.params.id)), eq(notesTable.userId, getAuth(req).userId!)),
  ).returning({ id: notesTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Note not found" }); return; }
  res.status(204).send();
});

export default router;