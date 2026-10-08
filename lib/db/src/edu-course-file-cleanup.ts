import type { Pool } from "pg";

/**
 * Drizzle schema push manages tables but not triggers. Install this guard
 * before serving requests so every SQL course deletion inventories its files,
 * including account deletion and future routes, atomically with the cascade.
 */
export async function ensureEduCourseFileCleanup(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('edu-course-file-cleanup-schema', 0))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS classscribe_edu_course_file_cleanup (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id uuid NOT NULL,
        file_key text NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        blocked boolean NOT NULL DEFAULT false,
        last_error_code text,
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS classscribe_edu_course_file_cleanup_course_key
        ON classscribe_edu_course_file_cleanup (course_id, file_key);
      CREATE OR REPLACE FUNCTION classscribe_inventory_edu_course_files()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO classscribe_edu_course_file_cleanup (course_id, file_key)
          SELECT OLD.id, file_key FROM classscribe_edu_materials
            WHERE course_id = OLD.id AND file_key IS NOT NULL
          UNION
          SELECT OLD.id, file_key FROM classscribe_edu_assignments
            WHERE course_id = OLD.id AND file_key IS NOT NULL
          ON CONFLICT (course_id, file_key) DO NOTHING;
        RETURN OLD;
      END;
      $$;
      DROP TRIGGER IF EXISTS classscribe_inventory_edu_course_files ON classscribe_courses;
      CREATE TRIGGER classscribe_inventory_edu_course_files
        BEFORE DELETE ON classscribe_courses FOR EACH ROW
        EXECUTE FUNCTION classscribe_inventory_edu_course_files();
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
