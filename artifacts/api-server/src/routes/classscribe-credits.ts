import { getAuth } from "@clerk/express";
import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { CreditsError, adjustCreditsForLibraryCode } from "../lib/classscribe-credits";

const router: IRouter = Router();

function configuredOwners(): Set<string> {
  return new Set((process.env.CLASSSCRIBE_CREDITS_OWNER_CLERK_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
}

router.post("/credits/admin/adjust", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  const owners = configuredOwners();
  if (!userId || !owners.size) {
    res.status(503).json({ code: "admin_not_configured", error: "Credits administration is not configured." });
    return;
  }
  if (!owners.has(userId)) {
    res.status(403).json({ code: "not_granted", error: "Not allowed." });
    return;
  }
  const libraryCode = req.get("X-CS-User")?.trim() ?? "";
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) ||
    Object.keys(req.body).some((key) => !["amount", "reason"].includes(key)) ||
    !Number.isSafeInteger(req.body.amount) || req.body.amount === 0 ||
    Math.abs(req.body.amount) > 100_000 ||
    typeof req.body.reason !== "string" || !req.body.reason.trim() || req.body.reason.length > 200) {
    res.status(400).json({ code: "invalid_argument", error: "A non-zero credit amount and reason are required." });
    return;
  }
  try {
    const requestedEventId = req.get("Idempotency-Key");
    const eventId = typeof requestedEventId === "string" &&
        /^[A-Za-z0-9_-]{8,160}$/.test(requestedEventId)
      ? `admin-${userId}-${createHash("sha256").update(libraryCode).digest("hex")}-${requestedEventId}`
      : `admin-${userId}-${randomUUID()}`;
    await adjustCreditsForLibraryCode(
      libraryCode,
      req.body.amount,
      req.body.reason,
      "admin",
      eventId,
    );
    res.json({ ok: true });
  } catch (error) {
    if (error instanceof CreditsError) {
      res.status(error.status).json({ code: error.code, error: error.message });
      return;
    }
    res.status(503).json({ code: "credits_unavailable", error: "Credits administration is temporarily unavailable." });
  }
});

export default router;