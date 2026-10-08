import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { coursesTable } from "./classscribe";

/**
 * Operator-managed record of an out-of-band verified EDU agreement.
 * There is intentionally no API for creating or editing these grants.
 */
export const classscribeEduLicenseGrantsTable = pgTable("classscribe_edu_license_grants", {
  userId: text("user_id").primaryKey(),
  signedAgreementRef: text("signed_agreement_ref").notNull(),
  issuerUserId: text("issuer_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Only the operator records a verified agreement and designates its administrator. */
export const classscribeEduInstitutionAgreementsTable = pgTable("classscribe_edu_institution_agreements", {
  signedAgreementRef: text("signed_agreement_ref").primaryKey(),
  adminUserId: text("admin_user_id").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  expiryWarningEnabled: boolean("expiry_warning_enabled").notNull().default(false),
});

/** Append-only audit of administrator approvals and revocations. */
export const classscribeEduInstructorAuditTable = pgTable("classscribe_edu_instructor_audit", {
  id: uuid("id").defaultRandom().primaryKey(),
  signedAgreementRef: text("signed_agreement_ref").notNull(),
  issuerUserId: text("issuer_user_id").notNull(),
  instructorUserId: text("instructor_user_id").notNull(),
  action: text("action").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

/**
 * Per-agreement number/PIN credential issued only by the operator CLI.
 * The PIN is stored as a salted scrypt hash; it is never recoverable.
 */
export const classscribeEduClientLicensesTable = pgTable("classscribe_edu_client_licenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  licenseNumber: text("license_number").notNull().unique(),
  ownerUserId: text("owner_user_id").notNull(),
  signedAgreementRef: text("signed_agreement_ref").notNull(),
  pinHash: text("pin_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** EDU verification is bound to both the Clerk session and the Clerk user. */
export const classscribeEduClientSessionsTable = pgTable("classscribe_edu_client_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  licenseId: uuid("license_id").references(() => classscribeEduClientLicensesTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").notNull(),
  clerkSessionId: text("clerk_session_id").notNull(),
  signedAgreementRef: text("signed_agreement_ref").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("classscribe_edu_client_session_user_session").on(table.userId, table.clerkSessionId),
]);

/**
 * Persistent account+license and IP lockout buckets. scope_hash is a
 * one-way fingerprint, never a raw PIN, account/license pair, or IP address.
 */
export const classscribeEduClientFailedAttemptsTable = pgTable("classscribe_edu_client_failed_attempts", {
  scopeHash: text("scope_hash").primaryKey(),
  attemptCount: integer("attempt_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Immutable agreement provenance for each EDU course. A missing binding is
 * intentionally treated as inaccessible; existing courses require operator
 * verification before a binding can be inserted.
 */
export const classscribeEduCourseLicenseBindingsTable = pgTable("classscribe_edu_course_license_bindings", {
  courseId: uuid("course_id").references(() => coursesTable.id, { onDelete: "cascade" }).primaryKey(),
  signedAgreementRef: text("signed_agreement_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClassscribeEduLicenseGrant = typeof classscribeEduLicenseGrantsTable.$inferSelect;