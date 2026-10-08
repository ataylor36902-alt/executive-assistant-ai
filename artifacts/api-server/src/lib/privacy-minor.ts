import { eq } from "drizzle-orm";
import {
  classscribeLegacyDocumentsTable, classscribePrivacyProfilesTable, db,
} from "@workspace/db";
import { getLinkedLibraryCode } from "./modern-library-link";
import { isRecord, validUid } from "./classscribe-legacy-access";

export type PrivacyAgeBand = "13-17" | "18+";

function parseAgeBand(value: unknown): PrivacyAgeBand | null {
  return value === "13-17" || value === "18+" ? value : null;
}

/**
 * Resolve age only from the Clerk-owned privacy profile, and only when the
 * authenticated owner is linked to this legacy library. Anonymous legacy
 * libraries may use their server-stored legacy profile.
 */
export async function getPrivacyAgeBand(userId?: string, libraryCode?: string): Promise<PrivacyAgeBand | null> {
  if (userId) {
    if (libraryCode && await getLinkedLibraryCode(userId) !== libraryCode) return null;
    const [profile] = await db.select({ ageBand: classscribePrivacyProfilesTable.ageBand })
      .from(classscribePrivacyProfilesTable)
      .where(eq(classscribePrivacyProfilesTable.userId, userId)).limit(1);
    return parseAgeBand(profile?.ageBand);
  }
  if (!libraryCode || !validUid(libraryCode)) return null;
  const [legacyProfile] = await db.select({ data: classscribeLegacyDocumentsTable.data })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, `data/users/${libraryCode}/profile`)).limit(1);
  return parseAgeBand(isRecord(legacyProfile?.data) ? legacyProfile.data.ageBand : null);
}

export function firstNameOnly(value: string): string {
  return value.trim().split(/\s+/u, 1)[0] ?? "";
}

/** Minor names are first-name-only in public surfaces; adult naming is unchanged. */
export function publicAuthorName(ageBand: PrivacyAgeBand | null, name: string): string {
  return ageBand === "13-17" ? firstNameOnly(name) : name;
}

/**
 * No validated minor sharing opt-in is currently implemented. In particular,
 * a write payload can never act as consent or turn sharing on.
 */
export function canSharePublicly(ageBand: PrivacyAgeBand | null, _validatedMinorOptIn = false): boolean {
  return ageBand !== "13-17";
}