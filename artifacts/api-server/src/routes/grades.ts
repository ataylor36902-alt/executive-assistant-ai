import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, inArray } from "drizzle-orm";
import {
  courseGradebooksTable, coursesTable, db, gradeScalesTable, syllabusAssignmentsTable,
  type GradeItem, type GradeScaleEntry, type GradeWeight,
} from "@workspace/db";
import {
  CalculateNeededGradeBody, CalculateNeededGradeParams, GetCourseGradesParams,
  UpdateCourseGradesBody, UpdateCourseGradesParams, UpdateGradeScaleBody,
} from "@workspace/api-zod";
import { accessibleCourseIds, canAccessCourse } from "./course-access";
import { categoryFor, currentGrade, defaultScale, letterFor, neededGrade, validScale, weightsFromText } from "../lib/grades";

const router: IRouter = Router();
const assumption = "This calculation counts only work already scored plus the selected item. Other unfinished work, extra credit, curves, and changes to the grading policy could change your final grade.";

async function schoolScale(userId: string) {
  const [saved] = await db.select().from(gradeScalesTable).where(eq(gradeScalesTable.userId, userId));
  return { entries: saved?.entries ?? defaultScale, customized: Boolean(saved) };
}

async function courseGradebook(userId: string, courseId: string, scale: GradeScaleEntry[]) {
  const [course] = await db.select().from(coursesTable).where(eq(coursesTable.id, courseId));
  if (!course) return null;
  const [saved] = await db.select().from(courseGradebooksTable)
    .where(and(eq(courseGradebooksTable.userId, userId), eq(courseGradebooksTable.courseId, courseId)));
  const needsWeightReview = Boolean(course.syllabusUploadedAt &&
    (!saved?.reviewedSyllabusAt || saved.reviewedSyllabusAt.getTime() !== course.syllabusUploadedAt.getTime()));
  const sourceWeights = course.syllabusGradeWeights?.length
    ? course.syllabusGradeWeights : weightsFromText(course.syllabusParsedText ?? "");
  const weights: GradeWeight[] = needsWeightReview && sourceWeights.length
    ? sourceWeights.map(({ category, weight }) => ({ category, weight }))
    : saved?.weights ?? sourceWeights.map(({ category, weight }) => ({ category, weight }));
  const assignments = await db.select().from(syllabusAssignmentsTable)
    .where(eq(syllabusAssignmentsTable.courseId, courseId));
  const remaining = [...(saved?.items ?? []).filter(item => item.source === "syllabus")];
  const items: GradeItem[] = [...(saved?.items ?? []).filter(item => item.source === "manual")];
  for (const assignment of assignments) {
    const id = `syllabus:${assignment.position}:${assignment.type}:${assignment.title.trim().toLowerCase()}`.slice(0, 200);
    let matchIndex = remaining.findIndex(item => item.id === id);
    if (matchIndex < 0) {
      const candidates = remaining.map((item, index) => ({ item, index }))
        .filter(({ item }) => item.title.trim().toLowerCase() === assignment.title.trim().toLowerCase() && item.type === assignment.type);
      const sameNamedAssignments = assignments.filter(row => row.title.trim().toLowerCase() === assignment.title.trim().toLowerCase() && row.type === assignment.type);
      if (candidates.length === 1 && sameNamedAssignments.length === 1) matchIndex = candidates[0].index;
    }
    if (matchIndex >= 0) {
      items.push({ ...remaining.splice(matchIndex, 1)[0], archived: false });
    } else {
      items.push({
        id, title: assignment.title.slice(0, 200),
        category: categoryFor(assignment.type, assignment.title, weights),
        type: assignment.type, source: "syllabus", scorePercent: null, archived: false,
      });
    }
  }
  items.push(...remaining.map(item => ({ ...item, archived: true })));
  const currentPercent = needsWeightReview ? null : currentGrade(items, weights);
  const credits = saved?.creditHours === null || saved?.creditHours === undefined ? null : Number(saved.creditHours);
  return {
    courseId, courseName: course.name, term: course.term,
    creditHours: credits, finalLetter: saved?.finalLetter ?? null,
    weights, items, weightsTotal: Math.round(weights.reduce((total, row) => total + row.weight, 0) * 100) / 100,
    currentPercent, currentLetter: letterFor(currentPercent, scale), needsWeightReview,
  };
}

router.get("/courses/:id/grades", async (req, res): Promise<void> => {
  const params = GetCourseGradesParams.safeParse(req.params);
  const userId = getAuth(req).userId!;
  if (!params.success || !(await canAccessCourse(userId, params.data.id))) {
    res.status(404).json({ error: "Course not found" }); return;
  }
  res.json(await courseGradebook(userId, params.data.id, (await schoolScale(userId)).entries));
});

router.put("/courses/:id/grades", async (req, res): Promise<void> => {
  const params = UpdateCourseGradesParams.safeParse(req.params);
  const body = UpdateCourseGradesBody.safeParse(req.body);
  const userId = getAuth(req).userId!;
  if (!params.success || !(await canAccessCourse(userId, params.data.id))) {
    res.status(404).json({ error: "Course not found" }); return;
  }
  if (!body.success) { res.status(400).json({ error: "Enter valid weights, scores and credit hours (0–30)" }); return; }
  const { weights, items, creditHours, finalLetter } = body.data;
  const scale = (await schoolScale(userId)).entries;
  const names = weights.map(row => row.category.trim().toLowerCase());
  if (new Set(names).size !== names.length ||
    new Set(items.map(row => row.id)).size !== items.length ||
    weights.reduce((total, row) => total + row.weight, 0) > 100.01 ||
    (finalLetter !== null && !scale.some(entry => entry.letter === finalLetter))) {
    res.status(400).json({ error: "Weights must have unique categories totaling no more than 100%, and the final grade must be on your school scale" }); return;
  }
  await db.insert(courseGradebooksTable).values({
    userId, courseId: params.data.id, weights: weights as GradeWeight[], items: items as GradeItem[],
    creditHours: creditHours === null ? null : String(creditHours), finalLetter,
    reviewedSyllabusAt: (await db.select({ date: coursesTable.syllabusUploadedAt }).from(coursesTable)
      .where(eq(coursesTable.id, params.data.id)))[0]?.date ?? null,
  }).onConflictDoUpdate({
    target: [courseGradebooksTable.userId, courseGradebooksTable.courseId],
    set: { weights: weights as GradeWeight[], items: items as GradeItem[],
      creditHours: creditHours === null ? null : String(creditHours), finalLetter, updatedAt: new Date(),
      reviewedSyllabusAt: (await db.select({ date: coursesTable.syllabusUploadedAt }).from(coursesTable)
        .where(eq(coursesTable.id, params.data.id)))[0]?.date ?? null },
  });
  res.json(await courseGradebook(userId, params.data.id, scale));
});

router.post("/courses/:id/grades/need", async (req, res): Promise<void> => {
  const params = CalculateNeededGradeParams.safeParse(req.params);
  const body = CalculateNeededGradeBody.safeParse(req.body);
  const userId = getAuth(req).userId!;
  if (!params.success || !(await canAccessCourse(userId, params.data.id))) {
    res.status(404).json({ error: "Course not found" }); return;
  }
  if (!body.success) { res.status(400).json({ error: "Choose an item and a target letter grade" }); return; }
  const scale = (await schoolScale(userId)).entries;
  const target = scale.find(row => row.letter === body.data.targetLetter);
  if (!target) { res.status(400).json({ error: "Choose a grade on your school scale" }); return; }
  const book = await courseGradebook(userId, params.data.id, scale);
  if (!book) { res.status(404).json({ error: "Course not found" }); return; }
  if (book.needsWeightReview) {
    res.json({ requiredPercent: null, message: "Review and save the syllabus grading weights in this course's Grades tab first.", assumption }); return;
  }
  res.json({ ...neededGrade(book.items, book.weights, body.data.itemId, target.minPercent), assumption });
});

router.get("/grades/scale", async (req, res): Promise<void> => {
  res.json(await schoolScale(getAuth(req).userId!));
});

router.put("/grades/scale", async (req, res): Promise<void> => {
  const body = UpdateGradeScaleBody.safeParse(req.body);
  if (!body.success || !validScale(body.data.entries)) {
    res.status(400).json({ error: "Use unique letters and cutoffs, including a lowest grade starting at 0%" }); return;
  }
  const userId = getAuth(req).userId!;
  const entries = [...body.data.entries].sort((a, b) => b.minPercent - a.minPercent);
  await db.insert(gradeScalesTable).values({ userId, entries }).onConflictDoUpdate({
    target: gradeScalesTable.userId, set: { entries },
  });
  res.json({ entries, customized: true });
});

router.get("/grades/overview", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId!;
  const ids = await accessibleCourseIds(userId);
  const scale = await schoolScale(userId);
  const courses = await Promise.all(ids.map(id => courseGradebook(userId, id, scale.entries)));
  res.json({ scale, courses: courses.filter(course => course !== null) });
});

export default router;