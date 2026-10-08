import { createHash } from "node:crypto";

export type LegacyFilter = [string, "==" | "eq" | "!=", string | number | boolean | null];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validUid(value: unknown): value is string {
  // The web client makes 16 cryptographically random base-62 characters; the
  // native client uses 22. Both are high-entropy bearer codes.
  return typeof value === "string" && /^u_[A-Za-z0-9]{16,40}$/.test(value);
}

export function validGroupCode(value: unknown): value is string {
  return typeof value === "string" && /^g_[a-f0-9]{32}$/.test(value);
}

export function legacyCapabilityAlias(uid: string): string {
  return `m_${createHash("sha256").update(uid).digest("hex")}`;
}

export function validPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 &&
    /^[A-Za-z0-9_.\-~:@+]+(\/[A-Za-z0-9_.\-~:@+]+)*$/.test(value) &&
    !value.split("/").some((segment) => segment === "." || segment === "..");
}

export function resolveAndAuthorizePath(rawPath: unknown, uid: string, collection: boolean):
  { path: string; access: "private" | "shared" | "member" | "collaborative" } | null {
  if (!validPath(rawPath)) return null;
  const segments = rawPath.split("/");
  if (segments[0] === "data" && segments[1] === "users" && segments[2] === "me") segments[2] = uid;
  const path = segments.join("/");
  if (collection ? segments.length % 2 !== 1 : segments.length % 2 !== 0) return null;

  if (segments[0] === "data" && segments[1] === "users") {
    return segments.length >= 3 && segments[2] === uid ? { path, access: "private" } : null;
  }
  if (segments.length === 2 && segments[0] === "members" &&
    (validUid(segments[1]) || /^m_[a-f0-9]{64}$/.test(segments[1]))) {
    return { path, access: "member" };
  }
  if (segments.length <= 2 && (segments[0] === "posts" || segments[0] === "shared")) {
    return { path, access: "shared" };
  }
  if (!collection && segments.length === 2 && segments[0] === "notebooks" && validGroupCode(segments[1])) {
    return { path, access: "collaborative" };
  }
  return null;
}

export function isValidWhere(value: unknown): value is LegacyFilter[] {
  return Array.isArray(value) && value.length <= 10 && value.every((filter) =>
    Array.isArray(filter) && filter.length === 3 &&
    typeof filter[0] === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(filter[0]) &&
    (filter[1] === "==" || filter[1] === "eq" || filter[1] === "!=") &&
    (filter[2] === null || typeof filter[2] === "string" || typeof filter[2] === "number" || typeof filter[2] === "boolean") &&
    (typeof filter[2] !== "string" || filter[2].length <= 1000) &&
    (typeof filter[2] !== "number" || Number.isFinite(filter[2])));
}

export function filtersMatch(data: unknown, filters: LegacyFilter[]): boolean {
  const record = isRecord(data) ? data : {};
  return filters.every(([field, operator, value]) =>
    operator === "!=" ? record[field] !== value : record[field] === value);
}