import type { RequestHandler } from "express";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { classscribePrivacyTombstonesTable, db, privacyLockPool } from "@workspace/db";
import { requirePrivacyLibrary, resolveWriteLibrary } from "../lib/privacy-access";

type PrivacyLockClient = {
  query: (queryText: string, values?: string[]) => Promise<unknown>;
  release: (destroy?: boolean) => void;
};
const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const readOnlyRpcPaths = new Set(["/db/get", "/db/list"]);
const unscopedPaths = new Set(["/privacy/config", "/privacy/delete", "/health", "/edu-inquiries"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const usesTransactionPrivacyGuard = (path: string, method: string): boolean =>
  (path === "/db/set" || path === "/db/update" || path === "/db/delete") && method === "POST" ||
  path === "/student/grades/save" && method === "POST" ||
  path === "/syllabus/confirm" && method === "POST" ||
  path === "/profile-photo" && (method === "POST" || method === "DELETE");

/**
 * Holds the library advisory lock across an entire mutation request. This
 * catches every route namespace, including one-statement writes that do not
 * otherwise open an application transaction.
 */
export const privacyWriteLockMiddleware: RequestHandler = (req, res, next) => {
  if (unscopedPaths.has(req.path) || (req.path === "/library-link" && req.method === "POST") ||
      req.path.startsWith("/privacy/export/download/")) {
    next();
    return;
  }
  const mutation = writeMethods.has(req.method) && !readOnlyRpcPaths.has(req.path) &&
    req.path !== "/privacy/delete" && req.path !== "/db/rotate";
  void (async () => {
    let library;
    try {
      // Reject unauthorized consent retries before they reserve lock capacity.
      library = req.path === "/privacy/consents"
        ? await requirePrivacyLibrary(req)
        : await resolveWriteLibrary(req);
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error
        ? Number(error.status) : 503;
      res.status(status >= 400 && status < 600 ? status : 503).json({
        error: error instanceof Error ? error.message : "Could not verify the selected library.",
      });
      return;
    }

    let client: PrivacyLockClient | undefined;
    if (mutation && !usesTransactionPrivacyGuard(req.path, req.method)) {
      try {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (req.aborted || res.destroyed) return;
          client = await privacyLockPool.connect() as unknown as PrivacyLockClient;
          const result = await client.query(
            "select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired",
            [library.libraryCode],
          ) as { rows: Array<{ acquired: boolean }> };
          if (result.rows?.[0]?.acquired === true) break;
          if (result.rows?.[0]?.acquired !== false) throw new Error("Could not confirm privacy lock acquisition.");
          // A waiting request must not hold a connection needed by other
          // libraries. Only an acquired lock keeps its dedicated session.
          client.release();
          client = undefined;
          await new Promise(resolve => setTimeout(resolve, 100 + Math.floor(Math.random() * 100)));
        }
        if (!client) {
          res.status(503).json({
            code: "privacy_write_busy",
            error: "Your library is busy saving another change. Wait a moment and try again. This request has not started.",
          });
          return;
        }
      } catch (error) {
        // A failed acquisition must never return a possibly locked session.
        client?.release(true);
        req.log?.warn({
          code: error && typeof error === "object" && "code" in error ? error.code : undefined,
        }, "Could not acquire the privacy write lock");
        res.status(503).json({
          code: "privacy_write_unavailable",
          error: "ClassScribe could not safely save this change. This request has not started. Try again shortly.",
        });
        return;
      }
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (client) {
        void client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [library.libraryCode])
          .then(() => client?.release(), () => client?.release(true));
      }
    };
    if (client) {
      res.once("finish", release);
      // A client disconnect is not proof the async route handler has stopped
      // writing. Keep the lock until its response completion signal instead.
      let clientClosed = false;
      res.once("close", () => {
        clientClosed = true;
        if (res.writableEnded) release();
      });
      const responseWithEnd = res as unknown as { end: (...args: unknown[]) => unknown };
      const endResponse = responseWithEnd.end.bind(res);
      responseWithEnd.end = (...args: unknown[]) => {
        const result = endResponse(...args);
        if (clientClosed) release();
        return result;
      };
    }

    if (req.aborted || res.destroyed) {
      release();
      return;
    }

    try {
      const currentLibrary = req.path === "/privacy/consents"
        ? await requirePrivacyLibrary(req)
        : await resolveWriteLibrary(req);
      if (currentLibrary.libraryHash !== library.libraryHash) {
        release();
        res.status(409).json({ error: "The linked library changed during this request. Retry from the current library." });
        return;
      }
      const [deletedLibrary] = await db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
        .from(classscribePrivacyTombstonesTable)
        .where(eq(classscribePrivacyTombstonesTable.libraryHash, library.libraryHash)).limit(1);
      const [deletedUser] = library.userId
        ? await db.select({ libraryHash: classscribePrivacyTombstonesTable.libraryHash })
          .from(classscribePrivacyTombstonesTable)
          .where(eq(classscribePrivacyTombstonesTable.deletedUserHash, hash(library.userId))).limit(1)
        : [];
      if (deletedLibrary || deletedUser) {
        if (client) release();
        res.status(410).json({ error: "This account and private library have been deleted." });
        return;
      }
      next();
    } catch {
      release();
      res.status(503).json({ error: "Could not verify account privacy status." });
    }
  })();
};