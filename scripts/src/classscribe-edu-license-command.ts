import { randomBytes, randomInt, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_BYTES = 64;

export type EduLicenseCommand =
  | { action: "grant"; userId: string; signedAgreementRef: string; expiresAt: Date }
  | { action: "school"; userId: string; signedAgreementRef: string; expiresAt: Date }
  | { action: "revoke"; userId: string }
  | { action: "revoke-school"; userId: string; signedAgreementRef: string };

export interface EduLicenseCommandDependencies {
  lookupClerkUser(userId: string): Promise<{ id: string }>;
  query(sql: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  now?: Date;
}

export type IssuedEduClientCredentials = { licenseNumber: string; clientPin: string };

const clerkUserIdPattern = /^user_[A-Za-z0-9]{10,64}$/;
const agreementReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const isoDateTimeWithZone =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;

function parseExpiry(value: string, now: Date): Date {
  const match = isoDateTimeWithZone.exec(value);
  if (!match) {
    throw new Error("Expiry must be a future ISO 8601 date-time with an explicit timezone, such as 2030-01-31T23:59:59Z.");
  }
  const [, year, month, day, , , , zone, , offsetHour, offsetMinute] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 ||
    calendar.getUTCDate() !== Number(day) ||
    (zone !== "Z" && (Number(offsetHour) > 14 || (Number(offsetHour) === 14 && Number(offsetMinute) !== 0)))) {
    throw new Error("Expiry must be a valid ISO 8601 date-time with an explicit timezone.");
  }
  const expiresAt = new Date(value);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
    throw new Error("Expiry must be later than the current time.");
  }
  return expiresAt;
}

export function parseEduLicenseCommand(args: string[], now = new Date()): EduLicenseCommand {
  const [action, userId, agreementRef, expiryText] = args;
  if (action !== "grant" && action !== "school" && action !== "revoke" && action !== "revoke-school") {
    throw new Error("Use exactly: grant|school <clerk-user-id> <agreement-reference> <future-ISO-expiry>, revoke <clerk-user-id>, or revoke-school <admin-user-id> <agreement-reference>.");
  }
  const expectedArgs = action === "grant" || action === "school" ? 4 : action === "revoke-school" ? 3 : 2;
  if (args.length !== expectedArgs) {
    throw new Error("Use exactly: grant|school <clerk-user-id> <agreement-reference> <future-ISO-expiry>, revoke <clerk-user-id>, or revoke-school <admin-user-id> <agreement-reference>.");
  }
  if (typeof userId !== "string" || userId !== userId.trim() || !clerkUserIdPattern.test(userId)) {
    throw new Error("Clerk user ID must be an unpadded user_ identifier containing 10–64 letters or digits after user_.");
  }
  if (action === "revoke") return { action, userId };

  if (typeof agreementRef !== "string" || agreementRef !== agreementRef.trim() ||
    !agreementReferencePattern.test(agreementRef)) {
    throw new Error("Agreement reference must be an opaque 8–200 character token using only letters, digits, dot, underscore, colon, or hyphen.");
  }
  if (action === "revoke-school") return { action, userId, signedAgreementRef: agreementRef };
  return {
    action,
    userId,
    signedAgreementRef: agreementRef,
    expiresAt: parseExpiry(expiryText, now),
  };
}

export async function runEduLicenseCommand(
  args: string[],
  dependencies: EduLicenseCommandDependencies,
): Promise<IssuedEduClientCredentials | undefined> {
  const command = parseEduLicenseCommand(args, dependencies.now);
  // Agreement revocation must remain available even if its administrator's
  // Clerk account has already been deleted.
  if (command.action !== "revoke-school") {
    let clerkUser: { id: string };
    try {
      clerkUser = await dependencies.lookupClerkUser(command.userId);
    } catch {
      throw new Error("Could not verify this account with Clerk; no license change was written.");
    }
    if (clerkUser.id !== command.userId) {
      throw new Error("Clerk account verification did not match this user ID; no license change was written.");
    }
  }

  if (command.action === "revoke-school") {
    const { rows } = await dependencies.query(`
      update classscribe_edu_institution_agreements set revoked_at = now()
      where signed_agreement_ref = $1 and admin_user_id = $2 and revoked_at is null returning signed_agreement_ref
    `, [command.signedAgreementRef, command.userId]);
    if (!rows[0]) throw new Error("No active school agreement exists for this administrator and reference.");
    await dependencies.query(`
      insert into classscribe_edu_instructor_audit
        (signed_agreement_ref, issuer_user_id, instructor_user_id, action)
      values ($1, $2, $3, 'agreement-revoked')
    `, [command.signedAgreementRef, "operator-cli", command.userId]);
    return undefined;
  }
  if (command.action === "grant" || command.action === "school") {
    if (command.action === "school") {
      // A reference may be recorded only once. Reissuing a revoked agreement requires a new signed reference.
      await dependencies.query(`
        insert into classscribe_edu_institution_agreements
          (signed_agreement_ref, admin_user_id, expires_at)
        values ($1, $2, $3)
      `, [command.signedAgreementRef, command.userId, command.expiresAt]);
      await dependencies.query(`
        insert into classscribe_edu_instructor_audit
          (signed_agreement_ref, issuer_user_id, instructor_user_id, action, expires_at)
        values ($1, $2, $3, 'verified-admin', $4)
      `, [command.signedAgreementRef, "operator-cli", command.userId, command.expiresAt]);
    }
    const licenseNumber = `EDU-${randomBytes(12).toString("hex").toUpperCase()}`;
    const clientPin = randomInt(0, 10_000_000_000).toString().padStart(10, "0");
    const salt = randomBytes(16);
    const pinHash = await scrypt(clientPin, salt, SCRYPT_BYTES) as Buffer;
    const encodedPinHash = `scrypt$${salt.toString("hex")}$${pinHash.toString("hex")}`;
    await dependencies.query(`
      insert into classscribe_edu_license_grants (user_id, signed_agreement_ref, approved_at, expires_at, revoked_at, issuer_user_id)
      values ($1, $2, now(), $3, null, $4)
      on conflict (user_id) do update set
        signed_agreement_ref = excluded.signed_agreement_ref,
        approved_at = excluded.approved_at,
        expires_at = excluded.expires_at,
        revoked_at = null, issuer_user_id = excluded.issuer_user_id
    `, [command.userId, command.signedAgreementRef, command.expiresAt, command.action === "school" ? command.userId : null]);
    await dependencies.query(`
      update classscribe_edu_client_licenses
      set revoked_at = now()
      where owner_user_id = $1 and revoked_at is null
    `, [command.userId]);
    await dependencies.query(`
      delete from classscribe_edu_client_sessions
      where license_id in (
        select id from classscribe_edu_client_licenses where owner_user_id = $1
      )
    `, [command.userId]);
    await dependencies.query(`
      insert into classscribe_edu_client_licenses
        (license_number, owner_user_id, signed_agreement_ref, pin_hash, expires_at, revoked_at)
      values ($1, $2, $3, $4, $5, null)
    `, [licenseNumber, command.userId, command.signedAgreementRef, encodedPinHash, command.expiresAt]);
    return { licenseNumber, clientPin };
  }

  const { rows } = await dependencies.query(
    "update classscribe_edu_license_grants set revoked_at = now() where user_id = $1 and revoked_at is null returning user_id",
    [command.userId],
  );
  if (!rows[0]) throw new Error("No active EDU license grant exists for that user.");
  await dependencies.query(`
    update classscribe_edu_client_licenses
    set revoked_at = now()
    where owner_user_id = $1 and revoked_at is null
  `, [command.userId]);
  await dependencies.query(`
    delete from classscribe_edu_client_sessions
    where license_id in (
      select id from classscribe_edu_client_licenses where owner_user_id = $1
    )
  `, [command.userId]);
  return undefined;
}