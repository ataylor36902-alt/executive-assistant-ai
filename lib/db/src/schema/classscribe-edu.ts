import { createInsertSchema } from "drizzle-zod";
import { boolean, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { coursesTable } from "./classscribe";
import { z } from "zod/v4";

export const eduAnnouncementsTable = pgTable("classscribe_edu_announcements", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eduMaterialsTable = pgTable("classscribe_edu_materials", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  fileKey: text("file_key"),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: numeric("size_bytes", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eduAssignmentsTable = pgTable("classscribe_edu_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  points: numeric("points", { mode: "number" }).notNull(),
  fileKey: text("file_key"),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: numeric("size_bytes", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eduSubmissionsTable = pgTable("classscribe_edu_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id").references(() => eduAssignmentsTable.id, { onDelete: "cascade" }).notNull(),
  studentId: text("student_id").notNull(),
  text: text("text").notNull(),
  fileKey: text("file_key"),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: numeric("size_bytes", { mode: "number" }),
  score: numeric("score", { mode: "number" }),
  feedback: text("feedback"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("classscribe_edu_submission_assignment_student").on(table.assignmentId, table.studentId)]);

export const eduCourseFileCleanupTable = pgTable("classscribe_edu_course_file_cleanup", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").notNull(),
  fileKey: text("file_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  blocked: boolean("blocked").notNull().default(false),
  lastErrorCode: text("last_error_code"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("classscribe_edu_course_file_cleanup_course_key").on(table.courseId, table.fileKey)]);
export const insertEduAnnouncementSchema = createInsertSchema(eduAnnouncementsTable).omit({ id: true, createdAt: true });
export const insertEduMaterialSchema = createInsertSchema(eduMaterialsTable).omit({ id: true, createdAt: true });
export const insertEduAssignmentSchema = createInsertSchema(eduAssignmentsTable).omit({ id: true, createdAt: true });
export const insertEduSubmissionSchema = createInsertSchema(eduSubmissionsTable).omit({ id: true, submittedAt: true, score: true, feedback: true });
export type InsertEduAnnouncement = z.infer<typeof insertEduAnnouncementSchema>;
export type InsertEduMaterial = z.infer<typeof insertEduMaterialSchema>;
export type InsertEduAssignment = z.infer<typeof insertEduAssignmentSchema>;
export type InsertEduSubmission = z.infer<typeof insertEduSubmissionSchema>;
export type EduAnnouncement = typeof eduAnnouncementsTable.$inferSelect;
export type EduMaterial = typeof eduMaterialsTable.$inferSelect;
export type EduAssignment = typeof eduAssignmentsTable.$inferSelect;
export type EduSubmission = typeof eduSubmissionsTable.$inferSelect;
