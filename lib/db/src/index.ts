import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Session-level request locks must not occupy connections needed by the
// guarded handler's data queries. Bound lock waits without timing out AI work.
export const privacyLockPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 10_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./edu-license-condition";
export * from "./edu-course-file-cleanup";
