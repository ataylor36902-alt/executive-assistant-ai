import { Router, type RequestHandler } from "express";
import { classscribeLegacyDocumentsTable, db } from "@workspace/db";
import { aiConsentNotice, aiConsentPath, aiProcessingPath, readAiConsent } from "../lib/ai-consent";
import { assertPrivacyLibraryActive, resolveWriteLibrary } from "../lib/privacy-access";

const router = Router();

router.get("/privacy/ai-consent", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const library = await resolveWriteLibrary(req);
    await assertPrivacyLibraryActive(db, library.libraryCode, library.userId);
    res.json({ ...aiConsentNotice, accepted: await readAiConsent(library.libraryHash) });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 503;
    res.status(status).json({ code: "ai_consent_unavailable", error: "Could not verify AI permission for this library." });
  }
});

router.post("/privacy/ai-consent", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const body = req.body;
  if (!body || Array.isArray(body) || Object.keys(body).sort().join(",") !== "accepted,version" ||
      typeof body.accepted !== "boolean" || body.version !== aiConsentNotice.version) {
    res.status(400).json({ code: "invalid_ai_consent", error: "Review the current AI notice and explicitly allow or decline." });
    return;
  }
  try {
    // The shared request write lock serializes this change with library deletion.
    const library = await resolveWriteLibrary(req);
    await assertPrivacyLibraryActive(db, library.libraryCode, library.userId);
    const data = { ...aiConsentNotice, accepted: body.accepted, updatedAt: new Date().toISOString() };
    await db.insert(classscribeLegacyDocumentsTable).values({
      path: aiConsentPath(library.libraryHash), data,
    }).onConflictDoUpdate({ target: classscribeLegacyDocumentsTable.path, set: { data, updatedAt: new Date() } });
    res.json({ ...aiConsentNotice, accepted: body.accepted });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 503;
    res.status(status).json({ code: "ai_consent_unavailable", error: "Permission was not confirmed. No AI request should be started; retry when connected." });
  }
});

export const aiConsentGate: RequestHandler = async (req, res, next) => {
  if (req.method !== "POST" || !aiProcessingPath.test(req.path)) { next(); return; }
  try {
    const library = await resolveWriteLibrary(req);
    await assertPrivacyLibraryActive(db, library.libraryCode, library.userId);
    if (!await readAiConsent(library.libraryHash)) {
      res.status(403).json({
        code: "ai_consent_required",
        error: "Review and allow AI sharing in Privacy controls before using this feature. No AI or transcription request was started.",
      });
      return;
    }
    next();
  } catch (error) {
    const status = (error as { status?: number }).status ?? 503;
    res.status(status).json({ code: "ai_consent_unavailable", error: "Could not verify AI permission. No processing request was started." });
  }
};

export default router;
