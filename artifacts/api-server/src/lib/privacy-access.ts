import { createHash } from "node:crypto";
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import { classscribeLegacyDocumentsTable, classscribePrivacyTombstonesTable, db } from "@workspace/db";
import { freeBillingIdentityForOwner } from "./privacy-billing";
import { getLinkedLibraryCode } from "./modern-library-link";
import { validUid } from "./classscribe-legacy-access";

export type PrivacyLibrary = {
  userId: string;
  libraryCode: string;
  libraryHash: string;
  linked: boolean;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Resolve the currently authenticated Clerk user to only their linked library,
 * or their server-derived free library. Never accept a library ID from a
 * caller-supplied query or body for authenticated operations.
 */
export async function requirePrivacyLibrary(req: Request): Promise<PrivacyLibrary> {
  const userId = getAuth(req).userId;
  if (!userId) {
    const authorization = req.header("authorization") ?? "";
    const bearer = /^Bearer (u_[A-Za-z0-9]{16,40})$/.exec(authorization)?.[1];
    const selectedCode = req.get("X-CS-User");
    if (!bearer || !validUid(bearer)) {
      throw Object.assign(new Error("A matching legacy library bearer and X-CS-User code are required."), { status: 401 });
    }
    if (selectedCode !== bearer) {
      throw Object.assign(new Error("The X-CS-User code must match the legacy bearer."), { status: 403 });
    }
    const libraryHash = hash(bearer);
    const [profile] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `data/users/${bearer}/profile`)).limit(1);
    const [owner] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `private/library-links/owners/${libraryHash}`)).limit(1);
    const [revoked] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `revoked/${libraryHash}`)).limit(1);
    if (!profile || owner || revoked) {
      throw Object.assign(new Error("Only an existing, active, unlinked legacy library can use bearer access."), { status: 403 });
    }
    const [deleted] = await db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
      .from(classscribePrivacyTombstonesTable)
      .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
    if (deleted) throw Object.assign(new Error("This sync code has been replaced or deleted."), { status: 410 });
    return { userId: "", libraryCode: bearer, libraryHash, linked: false };
  }
  const linkedCode = await getLinkedLibraryCode(userId);
  const selectedCode = req.get("X-CS-User")?.trim();
  if (selectedCode && (!linkedCode || selectedCode !== linkedCode)) {
    throw Object.assign(new Error("The selected library is not linked to this account."), { status: 403 });
  }
  if (await isPrivacyDeletedUser(userId)) {
    throw Object.assign(new Error("This account and private library have been deleted."), { status: 410 });
  }
  const libraryCode = linkedCode ?? freeBillingIdentityForOwner(userId);
  if (!validUid(libraryCode)) throw Object.assign(new Error("Library ownership could not be verified."), { status: 503 });
  const libraryHash = hash(libraryCode);
  const [deleted] = await db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
    .from(classscribePrivacyTombstonesTable)
    .where(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)).limit(1);
  if (deleted) throw Object.assign(new Error("This sync code has been replaced or deleted."), { status: 410 });
  if (linkedCode) {
    const ownerPath = `private/library-links/owners/${hash(libraryCode)}`;
    const [owner] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, ownerPath)).limit(1);
    // The encrypted owner mapping is verified by getLinkedLibraryCode. Its
    // presence here prevents an ownerless/rotated library from being accessed.
    if (!owner) throw Object.assign(new Error("Library ownership could not be verified."), { status: 403 });
  }
  return { userId, libraryCode, libraryHash, linked: Boolean(linkedCode) };
}

export async function resolveWriteLibrary(req: Request): Promise<PrivacyLibrary> {
  const userId = getAuth(req).userId;
  const selectedCode = req.get("X-CS-User")?.trim();
  if (userId) {
    const linkedCode = await getLinkedLibraryCode(userId);
    if (selectedCode && (!linkedCode || selectedCode !== linkedCode)) {
      throw Object.assign(new Error("The selected library is not linked to this account."), { status: 403 });
    }
    const libraryCode = linkedCode ?? freeBillingIdentityForOwner(userId);
    return { userId, libraryCode, libraryHash: hash(libraryCode), linked: Boolean(linkedCode) };
  }
  if (!selectedCode || !validUid(selectedCode)) {
    throw Object.assign(new Error("A library owner is required."), { status: 401 });
  }
  return { userId: "", libraryCode: selectedCode, libraryHash: hash(selectedCode), linked: false };
}

export type PrivacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serializes legacy and authenticated writes against account deletion. */
export async function lockPrivacyLibraryWrite(tx: PrivacyTransaction, libraryCode: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${libraryCode}, 0))`);
  await assertPrivacyLibraryActive(tx, libraryCode);
}

export async function assertPrivacyLibraryActive(tx: Pick<PrivacyTransaction, "select">, libraryCode: string, userId?: string): Promise<void> {
  const [deleted] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
    .from(classscribePrivacyTombstonesTable)
    .where(eq(classscribePrivacyTombstonesTable.libraryHash, hash(libraryCode))).limit(1);
  if (deleted) throw Object.assign(new Error("This sync code has been replaced or deleted."), { status: 410 });
  if (userId) {
    const [deletedUser] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
      .from(classscribePrivacyTombstonesTable)
      .where(eq(classscribePrivacyTombstonesTable.deletedUserHash, hash(userId))).limit(1);
    if (deletedUser) throw Object.assign(new Error("This account and private library have been deleted."), { status: 410 });
  }
}

/** Deletion takes the same lock but needs to remain safely idempotent. */
export async function lockPrivacyLibraryDeletion(tx: PrivacyTransaction, libraryCode: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${libraryCode}, 0))`);
}

export async function assertLibraryOwner(req: Request, libraryCode: string): Promise<PrivacyLibrary> {
  const library = await requirePrivacyLibrary(req);
  if (library.libraryCode !== libraryCode) {
    throw Object.assign(new Error("Library ownership could not be verified."), { status: 403 });
  }
  return library;
}

export function hashPrivacyLibrary(value: string): string {
  return hash(value);
}

export function isPrivacyTombstoned(libraryHash: string): Promise<boolean> {
  return db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
    .from(classscribePrivacyTombstonesTable)
    .where(and(eq(classscribePrivacyTombstonesTable.libraryHash, libraryHash)))
    .limit(1).then(([row]) => Boolean(row));
}

export async function isPrivacyDeletedUser(userId: string): Promise<boolean> {
  const [row] = await db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
    .from(classscribePrivacyTombstonesTable)
    .where(eq(classscribePrivacyTombstonesTable.deletedUserHash, hash(userId))).limit(1);
  return Boolean(row);
}