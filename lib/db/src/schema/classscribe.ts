import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const coursesTable = pgTable("classscribe_courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  term: text("term").notNull(),
  color: text("color").notNull(),
  inviteCode: text("invite_code").notNull().unique(),
  ownerId: text("owner_id"),
  eduEnabled: boolean("edu_enabled").notNull().default(false),
  syllabusObjectPath: text("syllabus_object_path"),
  syllabusFilename: text("syllabus_filename"),
  syllabusMimeType: text("syllabus_mime_type"),
  syllabusParsedText: text("syllabus_parsed_text"),
  syllabusGradeWeights: jsonb("syllabus_grade_weights").$type<{ category: string; weight: number; sourceText: string }[]>(),
  syllabusUploadedAt: timestamp("syllabus_uploaded_at", { withTimezone: true }),
  syllabusPendingObjectPath: text("syllabus_pending_object_path"),
  syllabusPendingFilename: text("syllabus_pending_filename"),
  syllabusPendingMimeType: text("syllabus_pending_mime_type"),
  syllabusPendingParsedText: text("syllabus_pending_parsed_text"),
  syllabusPendingGradeWeights: jsonb("syllabus_pending_grade_weights").$type<{ category: string; weight: number; sourceText: string }[]>(),
  meetings: jsonb("meetings").$type<{ days: ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")[]; start: string; end: string; location: string; type: "Lecture" | "Lab" | "Discussion" | "Seminar" | "Recitation" | "Office hours" }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const courseMembersTable = pgTable("classscribe_course_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
}, table => [uniqueIndex("classscribe_course_member_unique").on(table.courseId, table.userId)]);

export const lecturesTable = pgTable("classscribe_lectures", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  createdBy: text("created_by"),
  title: text("title").notNull(),
  professor: text("professor").notNull(),
  lectureDate: timestamp("lecture_date", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds"),
  transcript: text("transcript"),
  notes: text("notes"),
  summary: text("summary"),
  keyPoints: jsonb("key_points").$type<string[]>().default([]).notNull(),
  definitions: jsonb("definitions").$type<string[]>().default([]).notNull(),
  studyQuestions: jsonb("study_questions").$type<string[]>().default([]).notNull(),
  quizQuestions: jsonb("quiz_questions").$type<{ id: string; topic: string; prompt: string; options: string[]; correctIndex: number }[]>().default([]).notNull(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const academicDatesTable = pgTable("classscribe_academic_dates", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => lecturesTable.id, { onDelete: "cascade" }).notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["assignment", "exam"] }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  sourceText: text("source_text").notNull(),
  confirmed: boolean("confirmed").default(false).notNull(),
});

export const bookmarksTable = pgTable("classscribe_bookmarks", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  lectureId: uuid("lecture_id").references(() => lecturesTable.id, { onDelete: "cascade" }).notNull(),
  excerpt: text("excerpt").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const syllabusDatesTable = pgTable("classscribe_syllabus_dates", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["assignment", "exam"] }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  sourceText: text("source_text").notNull(),
  confirmed: boolean("confirmed").default(true).notNull(),
});

export const courseModulesTable = pgTable("classscribe_course_modules", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  sourceText: text("source_text").notNull(),
  position: integer("position").notNull(),
});

export const syllabusAssignmentsTable = pgTable("classscribe_syllabus_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  type: text("type", { enum: ["homework", "reading", "quiz", "exam", "project"] }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  sourceText: text("source_text").notNull(),
  position: integer("position").notNull(),
});

export const syllabusAssignmentCompletionsTable = pgTable("classscribe_syllabus_assignment_completions", {
  assignmentId: uuid("assignment_id").references(() => syllabusAssignmentsTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("classscribe_assignment_completion_user_item").on(table.userId, table.assignmentId)]);

export const courseCommentsTable = pgTable("classscribe_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  authorId: text("author_id"),
  authorName: text("author_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notesTable = pgTable("classscribe_notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  markdownBody: text("markdown_body").notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "set null" }),
  lectureId: uuid("lecture_id").references(() => lecturesTable.id, { onDelete: "set null" }),
  pinned: boolean("pinned").default(false).notNull(),
  prevBody: text("prev_body"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const studyGuidesTable = pgTable("classscribe_study_guides", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  content: text("content").notNull(),
  sources: jsonb("sources").$type<{ id: string; title: string }[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [uniqueIndex("classscribe_study_guide_user_course").on(table.userId, table.courseId)]);

export const practiceAttemptsTable = pgTable("classscribe_practice_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  lectureId: uuid("lecture_id").references(() => lecturesTable.id, { onDelete: "cascade" }).notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  questionId: uuid("question_id").notNull(),
  topic: text("topic").notNull(),
  selectedIndex: integer("selected_index").notNull(),
  correct: boolean("correct").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
