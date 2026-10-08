import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, desc, eq } from "drizzle-orm";
import { db, studyPlanImportsTable, studyPlansTable } from "@workspace/db";
import {
  CreateStudyPlanBody, CreateStudyPlanResponse, DeleteStudyPlanParams,
  ImportStudyPlansBody, ImportStudyPlansResponse, ListStudyPlansResponse,
  UpdateStudyPlanBody, UpdateStudyPlanParams, UpdateStudyPlanResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/study-plans", async (req, res): Promise<void> => {
  const rows = await db.select().from(studyPlansTable)
    .where(eq(studyPlansTable.userId, getAuth(req).userId!))
    .orderBy(desc(studyPlansTable.createdAt), desc(studyPlansTable.id));
  res.json(ListStudyPlansResponse.parse(rows));
});

router.post("/study-plans", async (req, res): Promise<void> => {
  const parsed = CreateStudyPlanBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.text.trim()) {
    res.status(400).json({ error: "Enter a study task (up to 500 characters)." }); return;
  }
  const [row] = await db.insert(studyPlansTable).values({
    userId: getAuth(req).userId!, text: parsed.data.text.trim(),
  }).returning();
  res.status(201).json(CreateStudyPlanResponse.parse(row));
});

router.post("/study-plans/import", async (req, res): Promise<void> => {
  const parsed = ImportStudyPlansBody.safeParse(req.body);
  if (!parsed.success || parsed.data.tasks.some(task => !task.text.trim())) {
    res.status(400).json({ error: "Invalid local study tasks." }); return;
  }
  const userId = getAuth(req).userId!;
  const { source, tasks } = parsed.data;
  // A transaction and unique legacy identity make partial/repeated imports safe.
  await db.transaction(async tx => {
    for (const task of tasks) {
      const claimed = await tx.insert(studyPlanImportsTable).values({
        userId, source, legacyId: task.id,
      }).onConflictDoNothing().returning({ id: studyPlanImportsTable.id });
      if (!claimed.length) continue;
      await tx.insert(studyPlansTable).values({
        userId, text: task.text.trim(), completed: task.completed,
        legacySource: source, legacyId: task.id,
      });
    }
  });
  const rows = await db.select().from(studyPlansTable).where(eq(studyPlansTable.userId, userId))
    .orderBy(desc(studyPlansTable.createdAt), desc(studyPlansTable.id));
  res.json(ImportStudyPlansResponse.parse(rows));
});

router.patch("/study-plans/:id", async (req, res): Promise<void> => {
  const params = UpdateStudyPlanParams.safeParse(req.params);
  const body = UpdateStudyPlanBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid study task update." }); return;
  }
  const [row] = await db.update(studyPlansTable).set({ completed: body.data.completed })
    .where(and(eq(studyPlansTable.id, params.data.id), eq(studyPlansTable.userId, getAuth(req).userId!))).returning();
  if (!row) { res.status(404).json({ error: "Study task not found" }); return; }
  res.json(UpdateStudyPlanResponse.parse(row));
});

router.delete("/study-plans/:id", async (req, res): Promise<void> => {
  const params = DeleteStudyPlanParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid study task ID." }); return; }
  const rows = await db.delete(studyPlansTable)
    .where(and(eq(studyPlansTable.id, params.data.id), eq(studyPlansTable.userId, getAuth(req).userId!)))
    .returning({ id: studyPlansTable.id });
  if (!rows.length) { res.status(404).json({ error: "Study task not found" }); return; }
  res.sendStatus(204);
});

export default router;