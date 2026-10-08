import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_BYTES = 64;

export type GeneratedEduClientCredentials = {
  licenseNumber: string;
  clientPin: string;
  pinHash: string;
};

export function makeEduLicenseNumber(): string {
  return `EDU-${randomBytes(12).toString("hex").toUpperCase()}`;
}

export function makeEduClientPin(): string {
  return randomInt(0, 10_000_000_000).toString().padStart(10, "0");
}

export async function hashEduClientPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, SCRYPT_BYTES) as Buffer;
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyEduClientPin(pin: string, encodedHash: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex, ...extra] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex || extra.length ||
    !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(pin, Buffer.from(saltHex, "hex"), expected.length) as Buffer;
  return timingSafeEqual(actual, expected);
}

export function fingerprintEduRateLimitScope(scope: string): string {
  return createHash("sha256").update(`classscribe-edu:${scope}`).digest("hex");
}

export async function generateEduClientCredentials(): Promise<GeneratedEduClientCredentials> {
  const licenseNumber = makeEduLicenseNumber();
  const clientPin = makeEduClientPin();
  return { licenseNumber, clientPin, pinHash: await hashEduClientPin(clientPin) };
}