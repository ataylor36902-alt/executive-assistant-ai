import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { coursesTable } from "./classscribe";

export const eduDiscussionTopicsTable = pgTable("classscribe_edu_discussion_topics", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).notNull(),
  creatorId: text("creator_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("classscribe_edu_discussion_topics_course_created_idx").on(table.courseId, table.createdAt),
]);

export const eduDiscussionRepliesTable = pgTable("classscribe_edu_discussion_replies", {
  id: uuid("id").defaultRandom().primaryKey(),
  topicId: uuid("topic_id").references(() => eduDiscussionTopicsTable.id, { onDelete: "cascade" }).notNull(),
  creatorId: text("creator_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("classscribe_edu_discussion_replies_topic_created_idx").on(table.topicId, table.createdAt),
]);

export type EduDiscussionTopic = typeof eduDiscussionTopicsTable.$inferSelect;
export type EduDiscussionReply = typeof eduDiscussionRepliesTable.$inferSelect;