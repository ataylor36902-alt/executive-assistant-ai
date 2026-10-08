import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { classscribeConsentsTable, db } from "@workspace/db";

export type PrivacyConsentConfig = {
  version: string;
  statements: readonly [string, string];
};

export type PrivacyConsentInput = {
  sessionId: string;
  lectureId: string;
  courseId: string;
  version: string;
  statements: [string, string];
  platform: "ios" | "android" | "web";
  appVersion: string;
  accommodation: boolean;
};

export type ConsentValidation =
  | { valid: true; input: PrivacyConsentInput }
  | { valid: false; error: string };

const sessionIdPattern = /^[A-Za-z0-9_-]{8,128}$/;
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;
const controlCharacters = /[\u0000-\u001f\u007f]/;

export function validatePrivacyConsentInput(
  body: unknown,
  config: PrivacyConsentConfig,
): ConsentValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "A consent record is required." };
  }

  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(key => ![
    "sessionId", "lectureId", "courseId", "version", "statements",
    "platform", "appVersion", "accommodation",
  ].includes(key))) {
    return { valid: false, error: "The consent record contains unsupported fields." };
  }
  if (typeof value.sessionId !== "string" || !sessionIdPattern.test(value.sessionId)) {
    return { valid: false, error: "A stable sessionId is required." };
  }
  if (typeof value.lectureId !== "string" || !idPattern.test(value.lectureId) ||
      typeof value.courseId !== "string" || !idPattern.test(value.courseId)) {
    return { valid: false, error: "A valid lectureId and courseId are required." };
  }
  if (value.version !== config.version ||
      !Array.isArray(value.statements) || value.statements.length !== 2 ||
      value.statements[0] !== config.statements[0] ||
      value.statements[1] !== config.statements[1]) {
    return { valid: false, error: "Consent version or statement text does not match the current privacy notice." };
  }
  if (value.platform !== "ios" && value.platform !== "android" && value.platform !== "web") {
    return { valid: false, error: "Platform must be ios, android, or web." };
  }
  if (typeof value.appVersion !== "string" || value.appVersion.length < 1 ||
      value.appVersion.length > 80 || controlCharacters.test(value.appVersion)) {
    return { valid: false, error: "A valid appVersion is required." };
  }
  if (typeof value.accommodation !== "boolean") {
    return { valid: false, error: "Accommodation must be a boolean." };
  }

  return {
    valid: true,
    input: {
      sessionId: value.sessionId,
      lectureId: value.lectureId,
      courseId: value.courseId,
      version: value.version,
      statements: [value.statements[0], value.statements[1]],
      platform: value.platform,
      appVersion: value.appVersion,
      accommodation: value.accommodation,
    },
  };
}

function consentFingerprint(consent: PrivacyConsentInput): string {
  return createHash("sha256").update(JSON.stringify([
    consent.lectureId,
    consent.courseId,
    consent.version,
    consent.statements,
    consent.platform,
    consent.appVersion,
    consent.accommodation,
  ])).digest("hex");
}

export type SaveConsentResult =
  | { saved: true; consentId: string; idempotent: boolean }
  | { saved: false; conflict: true };

export type ConsentRecord = PrivacyConsentInput & {
  id: string;
  libraryHash: string;
};

export type ConsentStore = {
  find(libraryHash: string, sessionId: string): Promise<ConsentRecord | undefined>;
  insertIfAbsent(record: ConsentRecord): Promise<void>;
};

/**
 * Save consent once per library/session. Reusing a stable session ID with
 * changed terms is rejected; a successful record can never be overwritten.
 */
export async function savePrivacyConsentWithStore(
  store: ConsentStore,
  libraryHash: string,
  consent: PrivacyConsentInput,
): Promise<SaveConsentResult> {
  const existing = await store.find(libraryHash, consent.sessionId);
  if (existing) {
    const matches = consentFingerprint(existing) === consentFingerprint(consent);
    return matches
      ? { saved: true, consentId: existing.id, idempotent: true }
      : { saved: false, conflict: true };
  }

  const id = randomUUID();
  await store.insertIfAbsent({
    id,
    libraryHash,
    ...consent,
  });

  // A competing insert may have won between the first select and insert.
  const saved = await store.find(libraryHash, consent.sessionId);
  if (!saved) throw new Error("Consent record could not be persisted.");
  const matches = consentFingerprint(saved) === consentFingerprint(consent);
  return matches
    ? { saved: true, consentId: saved.id, idempotent: saved.id !== id }
    : { saved: false, conflict: true };
}

const databaseConsentStore: ConsentStore = {
  async find(libraryHash, sessionId) {
    const [record] = await db.select().from(classscribeConsentsTable).where(and(
      eq(classscribeConsentsTable.libraryHash, libraryHash),
      eq(classscribeConsentsTable.sessionId, sessionId),
    )).limit(1);
    return record as ConsentRecord | undefined;
  },
  async insertIfAbsent(record) {
    await db.insert(classscribeConsentsTable).values(record).onConflictDoNothing({
      target: [classscribeConsentsTable.libraryHash, classscribeConsentsTable.sessionId],
    });
  },
};

export function savePrivacyConsent(
  libraryHash: string,
  consent: PrivacyConsentInput,
): Promise<SaveConsentResult> {
  return savePrivacyConsentWithStore(databaseConsentStore, libraryHash, consent);
}

export function privacyConsentMatchesRecording(
  record: Pick<ConsentRecord, "sessionId" | "lectureId" | "courseId">,
  requested: { sessionId: string; lectureId: string; courseId: string },
): boolean {
  return record.sessionId === requested.sessionId &&
    record.lectureId === requested.lectureId &&
    record.courseId === requested.courseId;
}

export async function hasPrivacyConsent(
  libraryHash: string,
  consentId: string,
  sessionId?: string,
  lectureId?: string,
  courseId?: string,
): Promise<boolean> {
  const [record] = await db.select().from(classscribeConsentsTable).where(and(
    eq(classscribeConsentsTable.libraryHash, libraryHash),
    eq(classscribeConsentsTable.id, consentId),
  )).limit(1);
  if (!record) return false;
  if (sessionId !== undefined && lectureId !== undefined && courseId !== undefined) {
    return privacyConsentMatchesRecording(record, { sessionId, lectureId, courseId });
  }
  return (sessionId === undefined || record.sessionId === sessionId) &&
    (lectureId === undefined || record.lectureId === lectureId) &&
    (courseId === undefined || record.courseId === courseId);
}

export type ConsentDeleteStore = {
  deleteForLecture(libraryHash: string, lectureId: string): Promise<number>;
};

export async function deletePrivacyConsentsForLectureWithStore(
  store: ConsentDeleteStore,
  libraryHash: string,
  lectureId: string,
): Promise<number> {
  return store.deleteForLecture(libraryHash, lectureId);
}

export function deletePrivacyConsentsForLecture(
  libraryHash: string,
  lectureId: string,
): Promise<number> {
  return deletePrivacyConsentsForLectureWithStore({
    async deleteForLecture(ownerHash, targetLectureId) {
      const deleted = await db.delete(classscribeConsentsTable).where(and(
        eq(classscribeConsentsTable.libraryHash, ownerHash),
        eq(classscribeConsentsTable.lectureId, targetLectureId),
      )).returning({ id: classscribeConsentsTable.id });
      return deleted.length;
    },
  }, libraryHash, lectureId);
}