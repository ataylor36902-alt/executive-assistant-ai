import { createDecipheriv, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { classscribeLegacyDocumentsTable, db } from "@workspace/db";
import { validUid } from "./classscribe-legacy-access";

const accountsPath = "private/library-links/accounts";
const ownersPath = "private/library-links/owners";
const revokedPath = (code: string) => `revoked/${hash(code)}`;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secretKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for library linking");
  return createHash("sha256").update(secret).digest();
}

function decrypt(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid encrypted library-link mapping");
  }
  const record = data as Record<string, unknown>;
  if (record.version !== 1 || typeof record.iv !== "string" ||
      typeof record.tag !== "string" || typeof record.ciphertext !== "string") {
    throw new Error("Invalid encrypted library-link mapping");
  }
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getLinkedLibraryCode(accountId: string): Promise<string | undefined> {
  if (!accountId) return undefined;
  const [mapping] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, `${accountsPath}/${hash(accountId)}`)).limit(1);
  if (!mapping) return undefined;
  const code = decrypt(mapping.data);
  if (!validUid(code)) throw new Error("Invalid library-link account mapping");
  const [ownerMapping, revoked] = await Promise.all([
    db.select({ data: classscribeLegacyDocumentsTable.data })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `${ownersPath}/${hash(code)}`)).limit(1)
      .then(([row]) => row),
    db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, revokedPath(code))).limit(1)
      .then(([row]) => row),
  ]);
  if (!ownerMapping || decrypt(ownerMapping.data) !== accountId || revoked) {
    throw new Error("Library-link mappings are inconsistent");
  }
  return code;
}