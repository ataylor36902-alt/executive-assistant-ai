import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { coursesTable } from "./classscribe";

export const eduGroupsTable = pgTable("classscribe_edu_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eduGroupMembersTable = pgTable("classscribe_edu_group_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").references(() => eduGroupsTable.id, { onDelete: "cascade" }).notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
}, table => [uniqueIndex("classscribe_edu_group_member_unique").on(table.groupId, table.userId)]);

export const eduLecturesTable = pgTable("classscribe_edu_lectures", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  createdBy: text("created_by").notNull(),
  title: text("title").notNull(),
  professor: text("professor").notNull().default(""),
  lectureDate: timestamp("lecture_date", { withTimezone: true }).notNull().defaultNow(),
  durationSeconds: integer("duration_seconds"),
  transcript: text("transcript"),
  transcriptionStatus: text("transcription_status", { enum: ["draft", "transcribing", "complete", "failed"] }).notNull().default("draft"),
  audioObjectKey: text("audio_object_key"),
  audioMimeType: text("audio_mime_type"),
  audioFilename: text("audio_filename"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eduLectureGroupsTable = pgTable("classscribe_edu_lecture_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  lectureId: uuid("lecture_id").references(() => eduLecturesTable.id, { onDelete: "cascade" }).notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  groupId: uuid("group_id").references(() => eduGroupsTable.id, { onDelete: "cascade" }).notNull(),
}, table => [uniqueIndex("classscribe_edu_lecture_group_unique").on(table.lectureId, table.groupId)]);

export const eduSourcesTable = pgTable("classscribe_edu_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  createdBy: text("created_by").notNull(),
  kind: text("kind", { enum: ["link", "upload"] }).notNull(),
  visibility: text("visibility", { enum: ["private", "groups", "class"] }).notNull().default("private"),
  title: text("title").notNull(),
  description: text("description"),
  url: text("url"),
  objectKey: text("object_key"),
  filename: text("filename"),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eduSourceGroupsTable = pgTable("classscribe_edu_source_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceId: uuid("source_id").references(() => eduSourcesTable.id, { onDelete: "cascade" }).notNull(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  groupId: uuid("group_id").references(() => eduGroupsTable.id, { onDelete: "cascade" }).notNull(),
}, table => [uniqueIndex("classscribe_edu_source_group_unique").on(table.sourceId, table.groupId)]);
