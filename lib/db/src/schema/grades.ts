import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { coursesTable } from "./classscribe";

export type GradeWeight = { category: string; weight: number };
export type GradeItem = {
  id: string;
  title: string;
  category: string;
  type: string;
  source: "syllabus" | "manual";
  scorePercent: number | null;
  archived?: boolean;
};
export type GradeScaleEntry = { letter: string; minPercent: number; points: number };

export const courseGradebooksTable = pgTable("classscribe_course_gradebooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  weights: jsonb("weights").$type<GradeWeight[]>().notNull(),
  items: jsonb("items").$type<GradeItem[]>().notNull(),
  creditHours: text("credit_hours"),
  finalLetter: text("final_letter"),
  reviewedSyllabusAt: timestamp("reviewed_syllabus_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("classscribe_course_gradebook_user_course").on(table.userId, table.courseId)]);

export const gradeScalesTable = pgTable("classscribe_grade_scales", {
  userId: text("user_id").primaryKey(),
  entries: jsonb("entries").$type<GradeScaleEntry[]>().notNull(),
});