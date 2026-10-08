import * as schema from "../../../../lib/db/src/schema/index.ts";

const rows = new Map();
let courseCleanupGuardInstalled = false;
export async function ensureEduCourseFileCleanup() {
  courseCleanupGuardInstalled = true;
}
export function isCourseCleanupGuardInstalled() { return courseCleanupGuardInstalled; }
const tableName = table => table?.[Symbol.for("drizzle:Name")] ?? "unknown";
const getRows = table => rows.get(tableName(table)) ?? [];

function parameters(condition, output = [], seen = new Set()) {
  // Drizzle's LIKE stores the pattern as a direct query chunk, unlike equality's Param.
  if (typeof condition === "string" && condition.startsWith("data/users/") && condition.includes("%")) {
    output.push(condition);
    return output;
  }
  if (!condition || typeof condition !== "object" || seen.has(condition)) return output;
  seen.add(condition);
  if (condition.constructor?.name === "Param" &&
      (typeof condition.value === "string" || condition.value instanceof Date)) {
    output.push(condition.value);
    return output;
  }
  for (const value of Object.values(condition)) {
    if (Array.isArray(value)) value.forEach(item => parameters(item, output, seen));
    else if (value && typeof value === "object") parameters(value, output, seen);
  }
  return output;
}

function conditionText(condition, output = [], seen = new Set()) {
  if (!condition || typeof condition !== "object" || seen.has(condition)) return output;
  seen.add(condition);
  if (Array.isArray(condition.value)) {
    for (const item of condition.value) {
      if (typeof item === "string") output.push(item);
      else conditionText(item, output, seen);
    }
  }
  for (const value of Object.values(condition)) {
    if (Array.isArray(value)) value.forEach(item => conditionText(item, output, seen));
    else if (value && typeof value === "object") conditionText(value, output, seen);
  }
  return output.join(" ");
}

function matchingRows(table, condition) {
  const values = parameters(condition);
  if (!values.length) return getRows(table);
  const stringParameters = values.filter(value => typeof value === "string");
  const dateParameter = values.find(value => value instanceof Date);
  const matchesString = (row, value) => {
    // SQL LIKE escapes literal '_' and '%' in private-library path prefixes.
    let escaped = "";
    for (let i = 0; i < value.length; i++) {
      let char = value[i];
      if (char === "\\" && i + 1 < value.length) {
        char = value[++i];
        escaped += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      } else {
        escaped += char === "%" ? ".*" : char === "_" ? "." :
          char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }
    }
    const pattern = new RegExp(`^${escaped}$`);
    return Object.values(row).some(candidate => typeof candidate === "string" && pattern.test(candidate));
  };
  if (dateParameter) {
    const text = conditionText(condition);
    const inclusive = text.includes("<=");
    const lessThan = text.includes("<");
    const greaterThan = text.includes(">");
    return getRows(table).filter(row => Object.values(row).some(value => value instanceof Date &&
      (lessThan ? (inclusive ? value <= dateParameter : value < dateParameter)
        : greaterThan ? (inclusive ? value >= dateParameter : value > dateParameter)
          : value.getTime() === dateParameter.getTime())) &&
      (!stringParameters.length || stringParameters.some(value => matchesString(row, value))));
  }
  return getRows(table).filter(row => stringParameters.some(value => matchesString(row, value)));
}

function query(kind, target) {
  let table = target;
  let condition;
  const result = {
    from(value) { table = value; return this; },
    where(value) { condition = value; return this; },
    orderBy() { return this; },
    for() { return this; },
    limit(max) { return Promise.resolve(matchingRows(table, condition).slice(0, max)); },
    set(values) { this.values = values; return this; },
    values(values) {
      const valuesArray = (Array.isArray(values) ? values : [values]).map(value =>
        tableName(table) === "classscribe_privacy_exports"
          ? { createdAt: new Date(), ...value }
          : value,
      );
      const current = getRows(table);
      rows.set(tableName(table), [...current, ...valuesArray]);
      this.inserted = valuesArray;
      return this;
    },
    onConflictDoUpdate() { return this; },
    onConflictDoNothing() { return this; },
    returning() { return Promise.resolve(this.inserted ?? []); },
    then(resolve, reject) {
      if (kind === "delete") {
        const removed = new Set(matchingRows(table, condition));
        if (tableName(table) === "classscribe_courses" && courseCleanupGuardInstalled) {
          const inventory = getRows(schema.eduCourseFileCleanupTable);
          for (const course of removed) {
            for (const source of [schema.eduMaterialsTable, schema.eduAssignmentsTable]) {
              for (const item of getRows(source)) {
                if (item.courseId !== course.id || !item.fileKey ||
                    inventory.some(entry => entry.courseId === course.id && entry.fileKey === item.fileKey)) continue;
                inventory.push({ id: `${course.id}:${item.fileKey}`, courseId: course.id, fileKey: item.fileKey });
              }
              rows.set(tableName(source), getRows(source).filter(item => item.courseId !== course.id));
            }
          }
          rows.set(tableName(schema.eduCourseFileCleanupTable), inventory);
        }
        rows.set(tableName(table), getRows(table).filter(row => !removed.has(row)));
      }
      if (kind === "update") {
        const affected = new Set(matchingRows(table, condition));
        rows.set(tableName(table), getRows(table).map(row => affected.has(row) ? { ...row, ...this.values } : row));
      }
      return Promise.resolve(kind === "select" ? matchingRows(table, condition) : undefined).then(resolve, reject);
    },
  };
  return result;
}

export const db = {
  select: () => query("select"),
  insert: table => query("insert", table),
  delete: table => query("delete", table),
  update: table => query("update", table),
  transaction: async callback => callback(db),
  execute: async () => undefined,
};

export const pool = {
  query: async () => ({ rows: [{ locked: true }] }),
  connect: async () => ({
    query: async () => ({ rows: [{ locked: true }] }),
    release() {},
  }),
};
export * from "../../../../lib/db/src/schema/index.ts";
export function resetPrivacyTestDb() { rows.clear(); courseCleanupGuardInstalled = false; }
export function readPrivacyTestRows(table) { return [...getRows(table)]; }
export function seedPrivacyTestRows(table, values) { rows.set(tableName(table), [...values]); }