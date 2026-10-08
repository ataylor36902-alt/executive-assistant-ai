import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const classscribeLegacyDocumentsTable = pgTable("classscribe_legacy_documents", {
  path: text("path").primaryKey(),
  data: jsonb("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ClassscribeLegacyDocument = typeof classscribeLegacyDocumentsTable.$inferSelect;

export const classscribeLegacyRateLimitsTable = pgTable("classscribe_legacy_rate_limits", {
  scope: text("scope").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
}, (table) => [
  index("classscribe_legacy_rate_limits_window_idx").on(table.windowStartedAt),
]);