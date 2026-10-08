import { boolean, customType, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const classscribePrivacyProfilesTable = pgTable("classscribe_privacy_profiles", {
  userId: text("user_id").primaryKey(),
  ageBand: text("age_band", { enum: ["13-17", "18+"] }).notNull(),
  defaults: jsonb("defaults").$type<Partial<{
    sharing: "off";
    publicProfiles: "off";
    schoolLevel: "HighSchool";
    discussionName: "firstName";
  }>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const classscribePrivacyExportsTable = pgTable("classscribe_privacy_exports", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  archive: bytea("archive").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("classscribe_privacy_exports_library_created_idx").on(table.libraryHash, table.createdAt),
  index("classscribe_privacy_exports_expiry_idx").on(table.expiresAt),
]);

export const classscribePrivacyDeletionOutboxTable = pgTable("classscribe_privacy_deletion_outbox", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  userId: text("user_id"),
  providerAppUserId: text("provider_app_user_id"),
  providerProjectId: text("provider_project_id"),
  pendingProviders: jsonb("pending_providers").$type<string[]>().notNull().default([]),
  attempts: text("attempts").notNull().default("0"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("classscribe_privacy_deletion_outbox_next_idx").on(table.nextAttemptAt),
]);

export const classscribePrivacyTombstonesTable = pgTable("classscribe_privacy_tombstones", {
  libraryHash: text("library_hash").primaryKey(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  deletedUserHash: text("deleted_user_hash"),
  legacyLibrary: boolean("legacy_library").notNull().default(false),
});

export const classscribePrivacyLibraryAliasesTable = pgTable("classscribe_privacy_library_aliases", {
  aliasHash: text("alias_hash").primaryKey(),
  currentLibraryHash: text("current_library_hash").notNull(),
  userHash: text("user_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  index("classscribe_privacy_library_aliases_current_idx").on(table.currentLibraryHash),
  index("classscribe_privacy_library_aliases_user_idx").on(table.userHash),
]);

export const classscribePrivacyRetentionWarningsTable = pgTable("classscribe_privacy_retention_warnings", {
  userId: text("user_id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  warningSentAt: timestamp("warning_sent_at", { withTimezone: true }).notNull(),
  scheduledDeleteAt: timestamp("scheduled_delete_at", { withTimezone: true }).notNull(),
});

export type ClassscribePrivacyDeletionOutbox = typeof classscribePrivacyDeletionOutboxTable.$inferSelect;