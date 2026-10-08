import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const studyPlansTable = pgTable("classscribe_study_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  text: text("text").notNull(),
  completed: boolean("completed").default(false).notNull(),
  legacySource: text("legacy_source"),
  legacyId: text("legacy_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("classscribe_study_plans_legacy_unique").on(table.userId, table.legacySource, table.legacyId)]);

// Import identities survive deletion of a task, preventing stale local copies from recreating it.
export const studyPlanImportsTable = pgTable("classscribe_study_plan_imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  source: text("source").notNull(),
  legacyId: text("legacy_id").notNull(),
}, table => [uniqueIndex("classscribe_study_plan_import_unique").on(table.userId, table.source, table.legacyId)]);

export const insertStudyPlanSchema = createInsertSchema(studyPlansTable).omit({ id: true, createdAt: true });
export type InsertStudyPlan = z.infer<typeof insertStudyPlanSchema>;
export type StudyPlan = typeof studyPlansTable.$inferSelect;