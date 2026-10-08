import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, classscribeLegacyDocumentsTable } from "@workspace/db";
import { ExtractMaterialTextResponse } from "@workspace/api-zod";
import { validUid } from "../lib/classscribe-legacy-access";

const router: IRouter = Router();
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 30_000;
const ACCEPTED_TYPES = new Set(["application/pdf", "text/plain"]);
const revokedPath = (uid: string) => `revoked/${createHash("sha256").update(uid).digest("hex")}`;

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error });
}

async function authorizeLibrary(req: Request, res: Response): Promise<boolean> {
  const uid = req.get("X-CS-User")?.trim() ?? "";
  if (!validUid(uid)) {
    fail(res, 403, "Not allowed");
    return false;
  }
  try {
    const [revoked] = await db.select({ path: classscribeLegacyDocumentsTable.path })
      .from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, revokedPath(uid)))
      .limit(1);
    if (revoked) {
      fail(res, 403, "This sync code has been replaced");
      return false;
    }
    return true;
  } catch (error) {
    req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Material extraction authorization check failed");
    fail(res, 503, "Material extraction is temporarily unavailable");
    return false;
  }
}

function parseUpload(req: Request, res: Response, next: () => void): void {
  const contentType = (req.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED_TYPES.has(contentType)) {
    fail(res, 415, "Upload a PDF or plain-text file");
    return;
  }
  const contentLength = Number(req.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    fail(res, 413, "File must be 8 MB or smaller");
    return;
  }
  express.raw({ type: [...ACCEPTED_TYPES], limit: MAX_UPLOAD_BYTES })(req, res, (error) => {
    if (error) {
      const status = typeof error === "object" && error !== null && "status" in error &&
        typeof error.status === "number" ? error.status : 400;
      fail(res, status, status === 413 ? "File must be 8 MB or smaller" : "Could not read uploaded file");
      return;
    }
    next();
  });
}

async function extractPdf(bytes: Buffer): Promise<{ text: string; hasExtractableText: boolean }> {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("Invalid PDF signature");
  }
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return {
      text: result.text,
      hasExtractableText: result.pages.some((page) => page.text.trim().length > 0),
    };
  } finally {
    await parser.destroy();
  }
}

router.post("/materials/extract", async (req, res, next): Promise<void> => {
  if (!(await authorizeLibrary(req, res))) return;
  parseUpload(req, res, () => {
    void (async () => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        fail(res, 400, "The uploaded file is empty");
        return;
      }

      const contentType = (req.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
      let text: string;
      if (contentType === "text/plain") {
        if (req.body.length >= 5 && (req.body as Buffer).subarray(0, 5).toString("ascii") === "%PDF-") {
          fail(res, 415, "The uploaded file does not match the declared plain-text type");
          return;
        }
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(req.body as Buffer);
        } catch {
          fail(res, 400, "The text file is not valid UTF-8");
          return;
        }
      } else {
        const bytes = req.body as Buffer;
        if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
          fail(res, 415, "The uploaded file does not match the declared PDF type");
          return;
        }
        try {
          const result = await extractPdf(bytes);
          if (!result.hasExtractableText) {
            fail(res, 422, "No selectable text was found. Scanned PDFs cannot be imported.");
            return;
          }
          text = result.text;
        } catch (error) {
          const hasSignature = bytes.subarray(0, 5).toString("ascii") === "%PDF-";
          if (!hasSignature) {
            fail(res, 415, "The uploaded file does not match the declared PDF type");
          } else {
            fail(res, 400, "The PDF is malformed or could not be read");
          }
          return;
        }
      }

      const originalLength = text.length;
      const response = ExtractMaterialTextResponse.parse({
        text: text.slice(0, MAX_TEXT_CHARS),
        truncated: originalLength > MAX_TEXT_CHARS,
        originalLength,
      });
      res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      res.status(200).json(response);
    })().catch(next);
  });
});

export default router;