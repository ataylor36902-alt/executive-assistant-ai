import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, classscribeLegacyDocumentsTable, classscribePrivacyTombstonesTable } from "@workspace/db";
import { isRecord, validUid } from "../lib/classscribe-legacy-access";
import { mergeFreeOwnerUsageIntoLibrary } from "../lib/classscribe-billing";
import { getLinkedLibraryCode } from "../lib/modern-library-link";
import { grantWelcomeCreditsForNewLink } from "../lib/classscribe-credits";

const router: IRouter = Router();
const accountsPath = "private/library-links/accounts";
const ownersPath = "private/library-links/owners";
const creditsWelcomePath = (codeHash: string) => `private/classscribe-credits/welcome-pending/${codeHash}`;
const revokedPath = (code: string) => `revoked/${hash(code)}`;
const profilePath = (code: string) => `data/users/${code}/profile`;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secretKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for library linking");
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string): Record<string, string | number> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(data: unknown): string {
  if (!isRecord(data) || data.version !== 1 ||
    typeof data.iv !== "string" || typeof data.tag !== "string" ||
    typeof data.ciphertext !== "string") {
    throw new Error("Invalid encrypted library-link mapping");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(data.iv, "base64"));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function accountPath(accountHash: string): string {
  return `${accountsPath}/${accountHash}`;
}

function ownerPath(codeHash: string): string {
  return `${ownersPath}/${codeHash}`;
}

export { getLinkedLibraryCode };

async function lockMappingKeys(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], keys: string[]) {
  for (const key of [...new Set(keys)].sort((left, right) => {
    const leftRank = left.startsWith("library-code:") ? 0 : 1;
    const rightRank = right.startsWith("library-code:") ? 0 : 1;
    return leftRank - rightRank || left.localeCompare(right);
  })) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}

/**
 * Update the encrypted account↔library association as part of the legacy
 * rotation transaction. No legacy user documents are removed by this helper.
 */
export async function rotateLinkedLibraryMapping(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  oldCode: string,
  nextCode: string,
): Promise<void> {
  const oldCodeHash = hash(oldCode);
  const nextCodeHash = hash(nextCode);
  await lockMappingKeys(tx, [
    `library-code:${oldCodeHash}`,
    `library-code:${nextCodeHash}`,
  ]);
  const oldOwnerPath = ownerPath(oldCodeHash);
  const [initialOwner] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, oldOwnerPath)).limit(1);
  if (!initialOwner) return;
  const accountId = decrypt(initialOwner.data);
  const accountHash = hash(accountId);
  await lockMappingKeys(tx, [`library-account:${accountHash}`]);
  const [currentOwner] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, oldOwnerPath)).limit(1);
  if (!currentOwner || decrypt(currentOwner.data) !== accountId) return;
  const [accountMapping] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, accountPath(accountHash))).limit(1);
  if (!accountMapping || decrypt(accountMapping.data) !== oldCode) {
    throw new Error("Library-link mappings are inconsistent during rotation");
  }
  const [nextOwner] = await tx.select({ path: classscribeLegacyDocumentsTable.path })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, ownerPath(nextCodeHash))).limit(1);
  if (nextOwner) throw new Error("Replacement code already has a library-link owner");

  await tx.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, oldOwnerPath));
  await tx.insert(classscribeLegacyDocumentsTable).values({
    path: ownerPath(nextCodeHash),
    data: encrypt(accountId),
  });
  await tx.update(classscribeLegacyDocumentsTable)
    .set({ data: encrypt(nextCode) })
    .where(eq(classscribeLegacyDocumentsTable.path, accountPath(accountHash)));
}

router.get("/library-link", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const accountId = getAuth(req).userId;
  if (!accountId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    secretKey();
    const [mapping] = await db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, accountPath(hash(accountId)))).limit(1);
    if (!mapping) {
      res.json({ linked: false });
      return;
    }
    const code = decrypt(mapping.data);
    if (!validUid(code)) throw new Error("Invalid library-link account mapping");
    res.json({ linked: true, code });
  } catch (error) {
    req.log?.error({ code: error instanceof Error && error.message.includes("SESSION_SECRET") ? "missing_secret" : "mapping_unavailable" }, "Library-link lookup failed");
    res.status(503).json({ error: "Library link is temporarily unavailable" });
  }
});

router.post("/library-link", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const accountId = getAuth(req).userId;
  if (!accountId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!isRecord(req.body) || Object.keys(req.body).length !== 1 || !validUid(req.body.code)) {
    res.status(400).json({ error: "A valid library code is required" });
    return;
  }
  const code = req.body.code;
  const accountHash = hash(accountId);
  const codeHash = hash(code);
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${code}, 0))`);
      await lockMappingKeys(tx, [
        `library-code:${codeHash}`,
      ]);
      await lockMappingKeys(tx, [`library-account:${accountHash}`]);
      secretKey();
      const [deletedUser] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
        .from(classscribePrivacyTombstonesTable)
        .where(eq(classscribePrivacyTombstonesTable.deletedUserHash, accountHash)).limit(1);
      const [deletedLibrary] = await tx.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
        .from(classscribePrivacyTombstonesTable)
        .where(eq(classscribePrivacyTombstonesTable.libraryHash, codeHash)).limit(1);
      if (deletedUser || deletedLibrary) return "invalid" as const;
      const [revoked] = await tx.select({ path: classscribeLegacyDocumentsTable.path })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, revokedPath(code))).limit(1);
      if (revoked) return "invalid" as const;
      const [profile] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, profilePath(code))).limit(1);
      if (!profile || !isRecord(profile.data)) return "invalid" as const;
      const [accountMapping] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, accountPath(accountHash))).limit(1);
      const [ownerMapping] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, ownerPath(codeHash))).limit(1);
      if (accountMapping && decrypt(accountMapping.data) !== code) return "account-conflict" as const;
      if (ownerMapping && decrypt(ownerMapping.data) !== accountId) return "library-conflict" as const;
      if (accountMapping && ownerMapping) return "linked" as const;
      const newlyCreated = !accountMapping && !ownerMapping;
      if (!accountMapping) {
        await tx.insert(classscribeLegacyDocumentsTable).values({
          path: accountPath(accountHash),
          data: encrypt(code),
        });
      }
      if (!ownerMapping) {
        await tx.insert(classscribeLegacyDocumentsTable).values({
          path: ownerPath(codeHash),
          data: encrypt(accountId),
        });
      }
      if (newlyCreated) {
        await tx.insert(classscribeLegacyDocumentsTable).values({
          path: creditsWelcomePath(codeHash),
          data: { pending: true },
        }).onConflictDoNothing();
      }
      return newlyCreated ? "created" as const : "linked" as const;
    });
    if (result === "invalid") {
      res.status(400).json({ error: "Library code is invalid or has been replaced" });
      return;
    }
    if (result === "account-conflict" || result === "library-conflict") {
      res.status(409).json({ error: "This account or library is already linked elsewhere" });
      return;
    }
    await mergeFreeOwnerUsageIntoLibrary(accountId, code);
    const [welcome] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, creditsWelcomePath(codeHash))).limit(1);
    if (welcome) {
      await grantWelcomeCreditsForNewLink(code);
      await db.delete(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, creditsWelcomePath(codeHash)));
    }
    res.json({ linked: true });
  } catch (error) {
    req.log?.error({ code: error instanceof Error && error.message.includes("SESSION_SECRET") ? "missing_secret" : "mapping_unavailable" }, "Library-link request failed");
    res.status(503).json({ error: "Library linking is temporarily unavailable" });
  }
});

export default router;