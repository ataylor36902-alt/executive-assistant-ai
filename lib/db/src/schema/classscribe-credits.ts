import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const classscribeCreditTransactionsTable = pgTable("classscribe_credit_transactions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  libraryHash: text("library_hash").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull(),
  source: text("source").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
}, (table) => [
  index("classscribe_credit_transactions_library_date_idx").on(table.libraryHash, table.date),
  check("classscribe_credit_transactions_nonzero_amount_check", sql`${table.amount} <> 0`),
]);

export const classscribeCreditActionsTable = pgTable("classscribe_credit_actions", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  action: text("action").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("classscribe_credit_actions_library_idx").on(table.libraryHash, table.createdAt),
  check("classscribe_credit_actions_status_check", sql`${table.status} in ('reserved', 'completed', 'failed')`),
]);

export const classscribeCreditProviderIntentsTable = pgTable("classscribe_credit_provider_intents", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  amount: integer("amount").notNull(),
  reasonHash: text("reason_hash").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("classscribe_credit_provider_intents_library_idx").on(table.libraryHash, table.createdAt),
  check("classscribe_credit_provider_intents_status_check", sql`${table.status} in ('pending', 'uncertain', 'retryable', 'completed', 'cancelled')`),
]);

export const classscribeCreditSubscriptionPaymentRevocationsTable = pgTable("classscribe_credit_subscription_payment_revocations", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  paymentHash: text("payment_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("classscribe_credit_subscription_payment_revocations_payment_uidx").on(table.libraryHash, table.paymentHash),
]);

// One durable row per library and subscription billing period. The pending
// fields are committed before a RevenueCat write so a timeout cannot be
// mistaken for a failed write and blindly retried.
export const classscribeCreditSubscriptionPeriodsTable = pgTable("classscribe_credit_subscription_periods", {
  id: text("id").primaryKey(),
  libraryHash: text("library_hash").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  highWaterPlan: text("high_water_plan"),
  grantedAmount: integer("granted_amount").notNull().default(0),
  paymentHashes: jsonb("payment_hashes").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("active"),
  revokedPaymentHash: text("revoked_payment_hash"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  pendingEventId: text("pending_event_id"),
  pendingPaymentHash: text("pending_payment_hash"),
  pendingPlan: text("pending_plan"),
  pendingAmount: integer("pending_amount"),
  pendingSource: text("pending_source"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("classscribe_credit_subscription_periods_library_idx").on(table.libraryHash, table.periodStart),
  uniqueIndex("classscribe_credit_subscription_periods_library_end_uidx").on(table.libraryHash, table.periodEnd),
  check("classscribe_credit_subscription_periods_status_check", sql`${table.status} in ('active', 'pending', 'uncertain', 'revoked')`),
]);