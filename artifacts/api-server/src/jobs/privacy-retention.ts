import { createHash } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { eq, lt } from "drizzle-orm";
import {
  classscribeCreditProviderIntentsTable,
  classscribeCreditSubscriptionPaymentRevocationsTable,
  classscribeCreditSubscriptionPeriodsTable,
  classscribeCreditTransactionsTable,
  classscribePrivacyExportsTable,
  classscribePrivacyRetentionWarningsTable,
  db,
  pool,
} from "@workspace/db";
import { freeBillingIdentityForOwner, getLibraryBillingStatus, getRevenueCatAppUserId } from "../lib/privacy-billing";
import { getLinkedLibraryCode } from "../lib/modern-library-link";
import { sendClassscribeRetentionWarningEmail } from "../lib/classscribe-support-email";
import { deletePrivacyLibraryData } from "../routes/privacy";
import { processPrivacyDeletionOutboxBatch } from "../lib/privacy-deletion";
import { hashPrivacyLibrary } from "../lib/privacy-access";

const warningLeadMilliseconds = 30 * 24 * 60 * 60 * 1000;
const retentionLock = 718_342_911;

function deletedAfter(lastSignInAt: Date): Date {
  const date = new Date(lastSignInAt);
  date.setUTCMonth(date.getUTCMonth() + 24);
  return date;
}

function warningEmailForUser(user: Awaited<ReturnType<typeof clerkClient.users.getUser>>) {
  const address = user.emailAddresses.find(item => item.id === user.primaryEmailAddressId)?.emailAddress;
  return address && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address) ? address : undefined;
}

async function sendInactivityWarningsAndDelete(now: Date, apply: boolean): Promise<{ warned: number; deleted: number; skipped: number }> {
  let warned = 0;
  let deleted = 0;
  let skipped = 0;
  let offset = 0;
  const pageSize = 100;
  while (true) {
    const page = await clerkClient.users.getUserList({ limit: pageSize, offset });
    for (const user of page.data) {
      if (!user.lastSignInAt) { skipped += 1; continue; }
      const lastSignInAt = new Date(user.lastSignInAt);
      if (!Number.isFinite(lastSignInAt.getTime())) { skipped += 1; continue; }
      const deletionAt = deletedAfter(lastSignInAt);
      const warningAt = new Date(deletionAt.getTime() - warningLeadMilliseconds);
      const [record] = await db.select().from(classscribePrivacyRetentionWarningsTable)
        .where(eq(classscribePrivacyRetentionWarningsTable.userId, user.id)).limit(1);
      if (record && lastSignInAt.getTime() > record.warningSentAt.getTime()) {
        if (apply) await db.delete(classscribePrivacyRetentionWarningsTable)
          .where(eq(classscribePrivacyRetentionWarningsTable.userId, user.id));
        continue;
      }
      if (!record && now >= warningAt) {
        const libraryCode = await getLinkedLibraryCode(user.id) ?? freeBillingIdentityForOwner(user.id);
        const libraryHash = hashPrivacyLibrary(libraryCode);
        if (!apply) { warned += 1; continue; }
        const email = warningEmailForUser(user);
        const sent = email ? await sendClassscribeRetentionWarningEmail({
          to: email, deletionDate: deletionAt.toISOString().slice(0, 10),
        }) : false;
        // No warning acceptance means no warning record and, importantly, no
        // deletion eligibility. The owner must configure a functioning email
        // transport to enable this job.
        if (!sent) { skipped += 1; continue; }
        await db.insert(classscribePrivacyRetentionWarningsTable).values({
          userId: user.id, libraryHash, warningSentAt: now, scheduledDeleteAt: deletionAt,
        }).onConflictDoNothing();
        warned += 1;
        continue;
      }
      if (record && now >= record.scheduledDeleteAt &&
          now.getTime() >= record.warningSentAt.getTime() + warningLeadMilliseconds) {
        if (!apply) { deleted += 1; continue; }
        const libraryCode = await getLinkedLibraryCode(user.id) ?? freeBillingIdentityForOwner(user.id);
        try {
          const billing = await getLibraryBillingStatus(libraryCode);
          if ((billing.plan === "student" || billing.plan === "pro") &&
              ["active", "trialing", "past_due"].includes(billing.status)) {
            skipped += 1;
            continue;
          }
          let providerAppUserId: string | undefined;
          try { providerAppUserId = await getRevenueCatAppUserId(libraryCode); } catch { /* retained in provider outbox */ }
          await deletePrivacyLibraryData({
            userId: user.id, libraryCode, libraryHash: record.libraryHash,
          }, providerAppUserId);
          await clerkClient.users.deleteUser(user.id).catch(error => {
            if (!(error && typeof error === "object" && "status" in error && Number(error.status) === 404)) throw error;
          });
          deleted += 1;
        } catch {
          skipped += 1;
        }
      }
    }
    if (page.data.length < pageSize) break;
    offset += page.data.length;
  }
  return { warned, deleted, skipped };
}

async function runLocked(now: Date, apply: boolean) {
  const client = await pool.connect();
  let lock;
  try {
    lock = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked", [retentionLock],
    );
  } catch (error) {
    client.release();
    throw error;
  }
  if (!lock.rows[0]?.locked) {
    client.release();
    return { locked: false, warned: 0, deleted: 0, skipped: 0, outboxPending: 0 };
  }
  try {
    const retention = await sendInactivityWarningsAndDelete(now, apply);
    const outboxPending = apply ? await processPrivacyDeletionOutboxBatch(200) : 0;
    if (apply) {
      await db.delete(classscribePrivacyExportsTable).where(lt(classscribePrivacyExportsTable.expiresAt, now));
      const financialRetentionCutoff = new Date(now.getTime() - 7 * 365.25 * 24 * 60 * 60 * 1000);
      await Promise.all([
        db.delete(classscribeCreditTransactionsTable)
          .where(lt(classscribeCreditTransactionsTable.date, financialRetentionCutoff)),
        db.delete(classscribeCreditProviderIntentsTable)
          .where(lt(classscribeCreditProviderIntentsTable.createdAt, financialRetentionCutoff)),
        db.delete(classscribeCreditSubscriptionPaymentRevocationsTable)
          .where(lt(classscribeCreditSubscriptionPaymentRevocationsTable.createdAt, financialRetentionCutoff)),
        db.delete(classscribeCreditSubscriptionPeriodsTable)
          .where(lt(classscribeCreditSubscriptionPeriodsTable.createdAt, financialRetentionCutoff)),
      ]);
    }
    return { locked: true, ...retention, outboxPending };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [retentionLock]);
    client.release();
  }
}

/**
 * Production scheduler entry point. It is deliberately dry-run unless the
 * owner explicitly enables both PRIVACY_RETENTION_JOB_ENABLED and APPLY.
 */
export async function runPrivacyRetentionJob(now = new Date()) {
  const enabled = process.env.PRIVACY_RETENTION_JOB_ENABLED === "true";
  const apply = enabled && process.env.PRIVACY_RETENTION_APPLY === "true";
  return runLocked(now, apply);
}

let developmentTimer: ReturnType<typeof setInterval> | undefined;
export function startPrivacyDevelopmentScheduler(): void {
  if (process.env.NODE_ENV !== "development" || developmentTimer) return;
  developmentTimer = setInterval(() => {
    void processPrivacyDeletionOutboxBatch(50).catch(() => undefined);
    void db.delete(classscribePrivacyExportsTable).where(lt(classscribePrivacyExportsTable.expiresAt, new Date()))
      .catch(() => undefined);
    const financialRetentionCutoff = new Date(Date.now() - 7 * 365.25 * 24 * 60 * 60 * 1000);
    void Promise.all([
      db.delete(classscribeCreditTransactionsTable)
        .where(lt(classscribeCreditTransactionsTable.date, financialRetentionCutoff)),
      db.delete(classscribeCreditProviderIntentsTable)
        .where(lt(classscribeCreditProviderIntentsTable.createdAt, financialRetentionCutoff)),
      db.delete(classscribeCreditSubscriptionPaymentRevocationsTable)
        .where(lt(classscribeCreditSubscriptionPaymentRevocationsTable.createdAt, financialRetentionCutoff)),
      db.delete(classscribeCreditSubscriptionPeriodsTable)
        .where(lt(classscribeCreditSubscriptionPeriodsTable.createdAt, financialRetentionCutoff)),
    ]).catch(() => undefined);
  }, 60 * 60 * 1000);
  developmentTimer.unref?.();
}