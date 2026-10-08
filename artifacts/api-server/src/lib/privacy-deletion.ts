import { eq, lte } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  classscribePrivacyDeletionOutboxTable,
  classscribeLegacyDocumentsTable,
  db,
  eduCourseFileCleanupTable,
  type ClassscribePrivacyDeletionOutbox,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { revenueCatRequest } from "./revenuecat-request";
import { isRecord } from "./classscribe-legacy-access";

const storage = new ObjectStorageService();
const projectIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function discoverRevenueCatProjectIds(): Promise<string[]> {
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const path = cursor
      ? `/v2/projects?starting_after=${encodeURIComponent(cursor)}`
      : "/v2/projects";
    const response = await revenueCatRequest(path, { method: "GET" });
    if (!response.ok) throw new Error(`provider_project_discovery_http_${response.status}`);
    const payload: unknown = await response.json();
    if (!record(payload) || !Array.isArray(payload.items)) throw new Error("provider_project_discovery_invalid");
    for (const item of payload.items) {
      if (record(item) && typeof item.id === "string" && projectIdPattern.test(item.id)) ids.add(item.id);
    }
    if (typeof payload.next_page !== "string" || !payload.next_page) break;
    if (cursors.has(payload.next_page)) throw new Error("provider_project_discovery_loop");
    cursors.add(payload.next_page);
    cursor = payload.next_page;
  }
  if (!ids.size) throw new Error("provider_project_not_found");
  return [...ids];
}

function isClerkNotFound(error: unknown): boolean {
  return !!error && typeof error === "object" && "status" in error && Number(error.status) === 404;
}

/** Retries only idempotent provider deletes; credential errors remain in the outbox. */
export async function processPrivacyDeletionOutboxItem(
  item: ClassscribePrivacyDeletionOutbox,
): Promise<boolean> {
  const remaining: string[] = [];
  let resolvedProviderAppUserId = item.providerAppUserId;
  let resolvedProjectId = item.providerProjectId || process.env.REVENUECAT_PROJECT_ID || null;
  let lastErrorCode = "external_delete_pending";
  for (const provider of item.pendingProviders) {
    try {
      if (provider === "clerk") {
        if (!item.userId) throw new Error("missing_identity");
        try { await clerkClient.users.deleteUser(item.userId); } catch (error) {
          if (!isClerkNotFound(error)) throw error;
        }
      } else if (provider === "revenuecat-confirm") {
        if (!resolvedProviderAppUserId || !resolvedProjectId) throw new Error("provider_confirmation_identity_pending");
        const response = await revenueCatRequest(
          `/v2/projects/${encodeURIComponent(resolvedProjectId)}/customers/${encodeURIComponent(resolvedProviderAppUserId)}`,
          { method: "GET" },
        );
        if (response.status === 404) continue;
        if (!response.ok) throw new Error(`provider_http_${response.status}`);
        remaining.push("revenuecat-confirm");
        lastErrorCode = "revenuecat_delete_confirmation_pending";
      } else if (provider === "revenuecat") {
        let appUserId = resolvedProviderAppUserId;
        if (!appUserId && resolvedProjectId) {
          const [account] = await db.select({ data: classscribeLegacyDocumentsTable.data })
            .from(classscribeLegacyDocumentsTable)
            .where(eq(classscribeLegacyDocumentsTable.path, `private/classscribe-billing/accounts/${item.libraryHash}`))
            .limit(1);
          if (account?.data && isRecord(account.data) &&
              typeof account.data.billingAccountId === "string") {
            appUserId = account.data.billingAccountId;
            resolvedProviderAppUserId = appUserId;
          }
        }
        if (!appUserId) throw new Error("provider_identity_pending");
        const projectIds = resolvedProjectId ? [resolvedProjectId] : await discoverRevenueCatProjectIds();
        let deletionQueued = false;
        for (const projectId of projectIds) {
          const response = await revenueCatRequest(
            `/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(appUserId)}`,
            { method: "DELETE" },
          );
          if (response.status === 404) continue;
          if (!response.ok) throw new Error(`provider_http_${response.status}`);
          resolvedProjectId = projectId;
          // Successful RevenueCat customer deletion is asynchronous: 200
          // means queued, not confirmed. Persist the exact project/identity
          // and poll that customer with GET on future attempts. Never DELETE
          // again from the confirmation phase because it could remove a
          // customer that was recreated after the original request.
          remaining.push("revenuecat-confirm");
          lastErrorCode = "revenuecat_delete_confirmation_pending";
          deletionQueued = true;
          break;
        }
        // A 404 in every selected/discoverable project confirms there was no
        // customer to delete.
        if (!deletionQueued) resolvedProjectId = resolvedProjectId ?? projectIds[0] ?? null;
      } else if (provider.startsWith("edu-course-files:")) {
        const courseId = provider.slice("edu-course-files:".length);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(courseId)) {
          throw new Error("invalid_course_cleanup_id");
        }
        const [pending] = await db.select({ id: eduCourseFileCleanupTable.id })
          .from(eduCourseFileCleanupTable).where(eq(eduCourseFileCleanupTable.courseId, courseId)).limit(1);
        if (pending) {
          remaining.push(provider);
          lastErrorCode = "edu_course_files_pending";
        }
      } else if (provider.startsWith("storage:")) {
        const key = provider.slice("storage:".length);
        if (!/^[A-Za-z0-9_./-]{1,512}$/.test(key) || key.split("/").includes("..")) {
          throw new Error("invalid_storage_key");
        }
        await storage.deleteObject(`/objects/${key}`);
      } else {
        throw new Error("unknown_provider");
      }
    } catch (error) {
      remaining.push(provider);
      if (provider === "revenuecat" && error instanceof Error) {
        if (/provider_http_401|provider_project_discovery_http_401/.test(error.message)) {
          lastErrorCode = "revenuecat_authentication_failed";
        } else if (/provider_http_403|provider_project_discovery_http_403/.test(error.message)) {
          lastErrorCode = "revenuecat_project_scope_denied";
        } else if (/provider_identity_pending|provider_project_not_found/.test(error.message)) {
          lastErrorCode = "revenuecat_identity_or_project_pending";
        }
      } else if (provider === "revenuecat-confirm" && error instanceof Error) {
        if (/provider_http_401|provider_project_discovery_http_401/.test(error.message)) {
          lastErrorCode = "revenuecat_authentication_failed";
        } else if (/provider_http_403|provider_project_discovery_http_403/.test(error.message)) {
          lastErrorCode = "revenuecat_project_scope_denied";
        } else if (/provider_confirmation_identity_pending/.test(error.message)) {
          lastErrorCode = "revenuecat_identity_or_project_pending";
        }
      }
    }
  }
  if (!remaining.length) {
    await db.delete(classscribePrivacyDeletionOutboxTable)
      .where(eq(classscribePrivacyDeletionOutboxTable.id, item.id));
    return false;
  }
  await db.update(classscribePrivacyDeletionOutboxTable).set({
    pendingProviders: remaining,
    providerAppUserId: resolvedProviderAppUserId ?? null,
    providerProjectId: resolvedProjectId,
    attempts: String((Number.parseInt(item.attempts, 10) || 0) + 1),
    nextAttemptAt: new Date(Date.now() + Math.min(24 * 60 * 60 * 1000, 60_000 * 2 ** Math.min(10, Number.parseInt(item.attempts, 10) || 0))),
    lastErrorCode,
  }).where(eq(classscribePrivacyDeletionOutboxTable.id, item.id));
  return true;
}

export async function processPrivacyDeletionOutboxBatch(limit = 50): Promise<number> {
  const batchSize = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await db.select().from(classscribePrivacyDeletionOutboxTable)
    .where(lte(classscribePrivacyDeletionOutboxTable.nextAttemptAt, new Date()))
    .limit(batchSize);
  let pending = 0;
  for (const row of rows) if (await processPrivacyDeletionOutboxItem(row)) pending += 1;
  return pending;
}
