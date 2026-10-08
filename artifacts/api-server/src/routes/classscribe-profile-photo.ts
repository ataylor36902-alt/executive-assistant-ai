import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { db, classscribeLegacyDocumentsTable } from "@workspace/db";
import { isRecord, validUid } from "../lib/classscribe-legacy-access";
import { consumeLegacyRateBudget } from "../lib/classscribe-rate-limit";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { assertPrivacyLibraryActive, lockPrivacyLibraryWrite } from "../lib/privacy-access";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const PROFILE_PHOTO_UPLOAD_BUDGET = { global: 150, ip: 12, library: 8 } as const;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_FORMATS: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const UUID_WEBP = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;

const profilePhotoPath = (uid: string) => `data/users/${uid}/profilePhoto`;
const libraryHash = (uid: string) => createHash("sha256").update(uid).digest("hex");
const revokedPath = (uid: string) => `revoked/${libraryHash(uid)}`;

class PhotoRouteError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

function isPrivatePhotoPath(path: unknown, uid: string): path is string {
  if (typeof path !== "string") return false;
  const prefix = `/objects/classscribe-profile-photos/${libraryHash(uid)}/`;
  return path.startsWith(prefix) && UUID_WEBP.test(path.slice(prefix.length));
}

async function authenticatedLibrary(req: Request, res: Response): Promise<string | null> {
  const uid = req.get("X-CS-User")?.trim() ?? "";
  if (!validUid(uid)) {
    fail(res, 403, "Not allowed");
    return null;
  }
  try {
    if (await isRevoked(uid)) {
      fail(res, 403, "This sync code has been replaced");
      return null;
    }
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Profile photo authorization check failed");
    fail(res, 503, "Profile photo service is temporarily unavailable");
    return null;
  }
  return uid;
}

const requireLibrary: RequestHandler = (req, res, next) => {
  void authenticatedLibrary(req, res).then((uid) => {
    if (!uid) return;
    res.locals.profilePhotoUid = uid;
    next();
  }).catch((error: unknown) => sendFailure(req, res, error, "authorization"));
};

const throttleProfilePhotoUpload: RequestHandler = (req, res, next) => {
  const uid = res.locals.profilePhotoUid as string;
  const sourceIp = req.socket.remoteAddress || req.ip || "unknown";
  const ipHash = createHash("sha256").update(sourceIp).digest("hex");
  const uidHash = libraryHash(uid);
  void (async () => {
    try {
      const now = Date.now();
      if (!(await consumeLegacyRateBudget("global:profile-photo-upload", PROFILE_PHOTO_UPLOAD_BUDGET.global, now))) {
        fail(res, 429, "Profile photo uploads are temporarily at capacity. Try again in a minute.");
        return;
      }
      if (!(await consumeLegacyRateBudget(`ip:profile-photo-upload:${ipHash}`, PROFILE_PHOTO_UPLOAD_BUDGET.ip, now))) {
        fail(res, 429, "Too many profile photo uploads from this network. Try again in a minute.");
        return;
      }
      if (!(await consumeLegacyRateBudget(`library:profile-photo-upload:${uidHash}`, PROFILE_PHOTO_UPLOAD_BUDGET.library, now))) {
        fail(res, 429, "Too many profile photo uploads for this library. Try again in a minute.");
        return;
      }
      next();
    } catch (error) {
      sendFailure(req, res, error, "rate-limit");
    }
  })();
};

function requestLibraryUid(res: Response): string {
  return res.locals.profilePhotoUid as string;
}

async function isRevoked(uid: string): Promise<boolean> {
  const [row] = await db.select({ path: classscribeLegacyDocumentsTable.path })
    .from(classscribeLegacyDocumentsTable)
    .where(eq(classscribeLegacyDocumentsTable.path, revokedPath(uid)))
    .limit(1);
  return Boolean(row);
}

function parseImageBody(req: Request, res: Response, next: () => void): void {
  const contentType = (req.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(contentType)) {
    fail(res, 415, "Upload a JPEG, PNG, or WebP image");
    return;
  }
  const contentLength = Number(req.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    fail(res, 413, "Profile photo must be 3 MB or smaller");
    return;
  }
  // The app-level JSON parser ignores image/* bodies; parse only these image
  // requests here, with a hard limit before any decoding or storage operation.
  express.raw({ type: [...ACCEPTED_TYPES], limit: MAX_UPLOAD_BYTES })(req, res, (error) => {
    if (error) {
      const status = typeof error === "object" && error !== null && "status" in error &&
        typeof error.status === "number" ? error.status : 400;
      fail(res, status, status === 413 ? "Profile photo must be 3 MB or smaller" : "Could not read profile photo");
      return;
    }
    next();
  });
}

function sendFailure(req: Request, res: Response, error: unknown, operation: string): void {
  if (error instanceof PhotoRouteError) {
    fail(res, error.status, error.message);
    return;
  }
  req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, `Profile photo ${operation} failed`);
  fail(res, 503, "Profile photo service is temporarily unavailable");
}

async function deletePrivateObject(path: string, req: Request, context: string): Promise<void> {
  try {
    const file = await objectStorage.getObjectEntityFile(path);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) {
      req.log.warn({ context, errorType: error instanceof Error ? error.name : "unknown" }, "Profile photo object cleanup failed");
    }
  }
}

router.get("/profile-photo", requireLibrary, async (req, res): Promise<void> => {
  const uid = requestLibraryUid(res);
  try {
    const path = profilePhotoPath(uid);
    const data = await db.transaction(async (tx) => {
      await assertPrivacyLibraryActive(tx, uid);
      const [revoked] = await tx.select({ path: classscribeLegacyDocumentsTable.path })
        .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, revokedPath(uid))).limit(1);
      if (revoked) throw new PhotoRouteError(403, "This sync code has been replaced");
      const [row] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path)).limit(1);
      return isRecord(row?.data) && isPrivatePhotoPath(row.data.objectPath, uid) ? row.data.objectPath : null;
    });
    if (!data) {
      res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      res.status(404).end();
      return;
    }
    const file = await objectStorage.getObjectEntityFile(data);
    res.set({
      "Content-Type": "image/webp",
      "Content-Disposition": 'inline; filename="profile-photo.webp"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const stream = file.createReadStream();
    stream.on("error", (error) => {
      req.log.error({ errorType: error.name }, "Profile photo stream failed");
      if (res.headersSent) res.destroy(error);
      else fail(res, 503, "Profile photo service is temporarily unavailable");
    });
    stream.pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      res.status(404).end();
      return;
    }
    sendFailure(req, res, error, "read");
  }
});

router.post("/profile-photo", requireLibrary, throttleProfilePhotoUpload, parseImageBody, async (req, res): Promise<void> => {
  const uid = requestLibraryUid(res);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    fail(res, 400, "The profile photo is empty");
    return;
  }
  try {
    const input = req.body as Buffer;
    let source: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      source = await sharp(input, { failOn: "error", limitInputPixels: 16_000_000 }).metadata();
    } catch (error) {
      req.log.warn({ errorType: error instanceof Error ? error.name : "unknown" }, "Invalid profile photo image data");
      fail(res, 400, "The uploaded file is not a valid JPEG, PNG, or WebP image");
      return;
    }
    if (!source.format) {
      fail(res, 400, "The uploaded file is not a valid JPEG, PNG, or WebP image");
      return;
    }
    if (IMAGE_FORMATS[source.format] !== (req.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase()) {
      fail(res, 415, "The image content does not match its file type");
      return;
    }
    if (!source.width || !source.height || source.width * source.height > 16_000_000) {
      fail(res, 400, "The image dimensions are too large or invalid");
      return;
    }
    let webp: Buffer;
    try {
      webp = await sharp(input, { failOn: "error", limitInputPixels: 16_000_000 })
        .rotate()
        .resize(512, 512, { fit: "cover", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch (error) {
      req.log.warn({ errorType: error instanceof Error ? error.name : "unknown" }, "Profile photo image decoding failed");
      fail(res, 400, "The uploaded image could not be decoded; choose another JPEG, PNG, or WebP image");
      return;
    }
    const objectKey = `classscribe-profile-photos/${libraryHash(uid)}/${randomUUID()}.webp`;
    const objectPath = `/objects/${objectKey}`;
    try {
      await objectStorage.uploadObject(objectKey, webp, "image/webp");
    } catch (error) {
      await deletePrivateObject(objectPath, req, "failed-upload");
      throw error;
    }

    let previousPath: string | null = null;
    const updatedAt = new Date().toISOString();
    try {
      await db.transaction(async (tx) => {
        await lockPrivacyLibraryWrite(tx, uid);
        const [revoked] = await tx.select({ path: classscribeLegacyDocumentsTable.path })
          .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, revokedPath(uid))).limit(1);
        if (revoked) throw new PhotoRouteError(403, "This sync code has been replaced");
        const path = profilePhotoPath(uid);
        const [existing] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
          .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path)).limit(1);
        if (isRecord(existing?.data) && isPrivatePhotoPath(existing.data.objectPath, uid)) {
          previousPath = existing.data.objectPath;
        }
        const timestamp = new Date(updatedAt);
        const data = { objectPath, updatedAt };
        await tx.insert(classscribeLegacyDocumentsTable)
          .values({ path, data, createdAt: timestamp, updatedAt: timestamp })
          .onConflictDoUpdate({
            target: classscribeLegacyDocumentsTable.path,
            set: { data, updatedAt: timestamp },
          });
      });
    } catch (error) {
      await deletePrivateObject(objectPath, req, "failed-replacement");
      throw error;
    }
    if (previousPath && previousPath !== objectPath) {
      await deletePrivateObject(previousPath, req, "replaced-photo");
    }
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.status(200).json({ updatedAt });
  } catch (error) {
    sendFailure(req, res, error, "upload");
  }
});

router.delete("/profile-photo", requireLibrary, async (req, res): Promise<void> => {
  const uid = requestLibraryUid(res);
  try {
    let previousPath: string | null = null;
    await db.transaction(async (tx) => {
      await lockPrivacyLibraryWrite(tx, uid);
      const [revoked] = await tx.select({ path: classscribeLegacyDocumentsTable.path })
        .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, revokedPath(uid))).limit(1);
      if (revoked) throw new PhotoRouteError(403, "This sync code has been replaced");
      const path = profilePhotoPath(uid);
      const [existing] = await tx.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path)).limit(1);
      if (isRecord(existing?.data) && isPrivatePhotoPath(existing.data.objectPath, uid)) {
        previousPath = existing.data.objectPath;
      }
      await tx.delete(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, path));
    });
    if (previousPath) await deletePrivateObject(previousPath, req, "removed-photo");
    res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    res.status(204).end();
  } catch (error) {
    sendFailure(req, res, error, "delete");
  }
});

export default router;