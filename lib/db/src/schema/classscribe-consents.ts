import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Immutable record of the consent given for one recording session.
 *
 * Lecture IDs intentionally aren't foreign keys: consent must be saved before
 * the recording/lecture row exists, and legacy lecture IDs may not be UUIDs.
 */
export const classscribeConsentsTable = pgTable("classscribe_consents", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  sessionId: text("session_id").notNull(),
  lectureId: text("lecture_id").notNull(),
  courseId: text("course_id").notNull(),
  version: text("version").notNull(),
  statements: jsonb("statements").$type<[string, string]>().notNull(),
  platform: text("platform").notNull(),
  appVersion: text("app_version").notNull(),
  accommodation: boolean("accommodation").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, table => [
  uniqueIndex("classscribe_consents_library_session_unique").on(table.libraryHash, table.sessionId),
]);

export type ClassscribeConsent = typeof classscribeConsentsTable.$inferSelect;
export type NewClassscribeConsent = typeof classscribeConsentsTable.$inferInsert;