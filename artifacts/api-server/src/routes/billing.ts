import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { getLinkedLibraryCode } from "../lib/modern-library-link";
import {
  BillingError,
  createLibraryCheckout,
  createLibraryPortalSession,
  ensureRevenueCatCustomer,
  getRevenueCatAppUserId,
  getLibraryBillingStatus,
  reserveRecordingCount,
  finishRecordingCount,
  releaseRecordingCount,
  refreshRevenueCatBillingStatus,
  getBillingReadiness,
} from "../lib/classscribe-billing";
import { isRecord } from "../lib/classscribe-legacy-access";
import {
  completeCreditAction,
  createCreditCheckout,
  CreditsError,
  getCreditActionState,
  getCreditsBalanceForLibrary,
  getCreditsStatus,
  refundCreditAction,
  reserveCreditsForAction,
} from "../lib/classscribe-credits";
import { creditsConfig } from "../lib/credits-config";
import { hasPrivacyConsent } from "../lib/classscribe-consents";
import { requirePrivacyLibrary } from "../lib/privacy-access";

const router: IRouter = Router();

function libraryCode(req: Request): string {
  return req.get("X-CS-User")?.trim() ?? "";
}

async function authorizeLinkedCreditOwner(req: Request, res: Response, code: string): Promise<boolean> {
  const ownerId = (req as Request & { auth?: { userId?: string | null } }).auth?.userId;
  if (!ownerId) return true;
  try {
    const linkedCode = await getLinkedLibraryCode(ownerId);
    if (linkedCode && linkedCode !== code) {
      res.status(403).json({ code: "not_granted", error: "This billing account belongs to another authenticated owner." });
      return false;
    }
    return true;
  } catch {
    req.log.warn("Credits owner mapping could not be verified");
    res.status(503).json({ code: "billing_identity_unavailable", error: "The credits owner could not be verified. Please retry." });
    return false;
  }
}

function sendBillingError(res: Response, error: unknown): void {
  if (error instanceof CreditsError) {
    res.status(error.status).json({ code: error.code, error: error.message });
    return;
  }
  if (error instanceof BillingError) {
    res.status(error.httpStatus).json({ code: error.code, error: error.message });
    return;
  }
  res.status(503).json({
    code: "billing_unavailable",
    error: "Billing verification is temporarily unavailable. Please try again later.",
  });
}

router.get("/credits/status", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const code = libraryCode(req);
  if (!(await authorizeLinkedCreditOwner(req, res, code))) return;
  try {
    res.json(await getCreditsStatus(code));
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.post("/credits/checkout", async (req, res): Promise<void> => {
  if (!isRecord(req.body) ||
    Object.keys(req.body).some((key) => !["packId", "returnUrl"].includes(key)) ||
    typeof req.body.packId !== "string" ||
    typeof req.body.returnUrl !== "string" ||
    req.body.returnUrl.length > 2_000) {
    res.status(400).json({ code: "invalid_argument", error: "Choose a valid credit pack and return URL." });
    return;
  }
  res.set("Cache-Control", "no-store");
  const code = libraryCode(req);
  if (!(await authorizeLinkedCreditOwner(req, res, code))) return;
  try {
    res.json(await createCreditCheckout(code, req.body.packId, req.body.returnUrl));
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.get("/billing/status", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  if (req.query.refresh !== undefined && req.query.refresh !== "1") {
    res.status(400).json({
      code: "invalid_argument",
      error: "The only supported billing status refresh value is refresh=1.",
    });
    return;
  }
  try {
    const code = libraryCode(req);
    if (req.query.refresh === "1" && process.env.REVENUECAT_PROJECT_ID) {
      await refreshRevenueCatBillingStatus(code);
    }
    const status = await getLibraryBillingStatus(code, undefined, req.query.refresh === "1");
    res.json({ ...status, billingReadiness: getBillingReadiness() });
  } catch (error) {
    sendBillingError(res, error);
  }
});

function validRecordingRequest(body: unknown, allowCreditOptions = false): body is {
  recordingId: string;
  useCredits?: boolean;
  requestId?: string;
  consentId?: string;
  sessionId?: string;
  lectureId?: string;
  courseId?: string;
} {
  if (!isRecord(body) || typeof body.recordingId !== "string" ||
    body.recordingId.length === 0 || body.recordingId.length > 200) return false;
  const allowedKeys = allowCreditOptions
    ? ["recordingId", "useCredits", "requestId", "consentId", "sessionId", "lectureId", "courseId"]
    : ["recordingId"];
  const validId = (value: unknown) =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  return Object.keys(body).every((key) => allowedKeys.includes(key)) &&
    (body.useCredits === undefined || typeof body.useCredits === "boolean") &&
    (body.requestId === undefined ||
      (typeof body.requestId === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(body.requestId))) &&
    (!allowCreditOptions || (
      typeof body.consentId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.consentId) &&
      validId(body.sessionId) && body.sessionId === body.recordingId &&
      validId(body.lectureId) && validId(body.courseId)
    ));
}

router.post("/billing/recordings/reserve", async (req, res): Promise<void> => {
  if (!validRecordingRequest(req.body, true)) {
    res.status(400).json({ code: "invalid_argument", error: "A recording ID, current session, lecture, course, and consent record are required." });
    return;
  }
  res.set("Cache-Control", "no-store");
  try {
    const uid = libraryCode(req);
    const { recordingId, useCredits, consentId, sessionId, lectureId, courseId } = req.body;
    let library;
    try {
      library = await requirePrivacyLibrary(req);
    } catch (error) {
      const status = error && typeof error === "object" &&
        "status" in error && typeof error.status === "number" ? error.status : 503;
      res.status(status).json({
        code: "privacy_library_unavailable",
        error: "Could not verify your private library before recording.",
      });
      return;
    }
    if (library.libraryCode !== uid || !await hasPrivacyConsent(
      library.libraryHash, consentId!, sessionId!, lectureId!, courseId!,
    )) {
      res.status(409).json({
        code: "recording_consent_required",
        error: "Save current consent for this recording session, lecture, and course before reserving a new recording.",
      });
      return;
    }
    const requestId = createHash("sha256").update(`saved-recording:${uid}:${recordingId}`).digest("hex");
    const requestHash = createHash("sha256").update(JSON.stringify({ uid, recordingId })).digest("hex");
    const result = await reserveRecordingCount(uid, recordingId);
    if (result.allowed) {
      res.json(result);
      return;
    }
    if (useCredits !== true) {
      const balance = await getCreditsBalanceForLibrary(uid);
      res.status(402).json({
        code: "credits_required",
        error: `You've saved all ${result.status.recordingCountLimit} recordings for this month.`,
        cost: creditsConfig.costs.savedRecording,
        balance,
        action: "savedRecording",
        requestId,
        billing: result.status,
      });
      return;
    }
    if (req.body.requestId !== requestId) {
      res.status(400).json({
        code: "request_id_required",
        error: "Reuse the requestId from the credits_required response.",
      });
      return;
    }
    const claim = await reserveCreditsForAction(
      uid, "saved-recording", requestId, requestHash, creditsConfig.costs.savedRecording,
    );
    if (claim.replay) {
      res.json(claim.response);
      return;
    }
    try {
      const paidReservation = await reserveRecordingCount(uid, recordingId, true);
      if (!paidReservation.allowed) {
        await refundCreditAction(uid, claim.actionId, creditsConfig.costs.savedRecording, "saved recording");
        res.status(402).json({ code: "plan_limit", error: "The saved recording quota changed. Please retry." });
        return;
      }
      res.json(paidReservation);
    } catch (error) {
      await refundCreditAction(uid, claim.actionId, creditsConfig.costs.savedRecording, "saved recording");
      throw error;
    }
  } catch (error) {
    if (error instanceof CreditsError && error.code === "insufficient_credits") {
      let balance: number | undefined;
      try { balance = await getCreditsBalanceForLibrary(libraryCode(req)); } catch {}
      res.status(422).json({
        code: "insufficient_credits",
        error: error.message,
        cost: creditsConfig.costs.savedRecording,
        ...(balance !== undefined ? { balance } : {}),
        action: "savedRecording",
      });
    } else sendBillingError(res, error);
  }
});

router.post("/billing/recordings/finish", async (req, res): Promise<void> => {
  if (!validRecordingRequest(req.body)) {
    res.status(400).json({ code: "invalid_argument", error: "A recordingId is required." });
    return;
  }
  res.set("Cache-Control", "no-store");
  try {
    const uid = libraryCode(req);
    const recordingId = req.body.recordingId;
    const requestId = createHash("sha256").update(`saved-recording:${uid}:${recordingId}`).digest("hex");
    const result = await finishRecordingCount(uid, recordingId);
    const actionState = await getCreditActionState(uid, "saved-recording", requestId);
    if (!result.finished) {
      if (result.limitReached &&
        (actionState?.status === "reserved" || actionState?.status === "debited")) {
        await refundCreditAction(uid, actionState.actionId, creditsConfig.costs.savedRecording, "saved recording");
      }
      if (result.limitReached) {
        res.status(402).json({
          code: "plan_limit",
          error: `This saved recording could not be counted in its original month because the ${result.status.recordingCountLimit}-recording limit has been reached.`,
          billing: result.status,
        });
        return;
      }
      res.status(409).json({ code: "reservation_not_found", error: "No pending recording reservation was found." });
      return;
    }
    if (actionState?.status === "reserved" || actionState?.status === "debited") {
      await completeCreditAction(actionState.actionId, { ok: true, billing: result.status });
    }
    res.json({ ok: true, billing: result.status });
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.post("/billing/recordings/release", async (req, res): Promise<void> => {
  if (!validRecordingRequest(req.body)) {
    res.status(400).json({ code: "invalid_argument", error: "A recordingId is required." });
    return;
  }
  res.set("Cache-Control", "no-store");
  try {
    const uid = libraryCode(req);
    const recordingId = req.body.recordingId;
    const requestId = createHash("sha256").update(`saved-recording:${uid}:${recordingId}`).digest("hex");
    const released = await releaseRecordingCount(uid, recordingId);
    if (released) {
      const actionState = await getCreditActionState(uid, "saved-recording", requestId);
      if (actionState?.status === "reserved" || actionState?.status === "debited" ||
        actionState?.status === "refunding") {
        await refundCreditAction(uid, actionState.actionId, creditsConfig.costs.savedRecording, "saved recording");
      }
    }
    res.json({ ok: true });
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.get("/billing/revenuecat/identity", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const appUserId = await getRevenueCatAppUserId(libraryCode(req));
    await ensureRevenueCatCustomer(appUserId);
    res.json({ appUserId });
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.post("/billing/revenuecat/refresh", async (req, res): Promise<void> => {
  if (req.body !== undefined &&
    (!isRecord(req.body) || Object.keys(req.body).length > 0)) {
    res.status(400).json({
      code: "invalid_argument",
      error: "RevenueCat refresh does not accept a client-supplied identity or plan.",
    });
    return;
  }
  res.set("Cache-Control", "no-store");
  try {
    res.json(await refreshRevenueCatBillingStatus(libraryCode(req)));
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.post("/billing/checkout", async (req, res): Promise<void> => {
  if (!isRecord(req.body) ||
    Object.keys(req.body).some((key) => !["plan", "returnUrl"].includes(key)) ||
    (req.body.returnUrl !== undefined &&
      (typeof req.body.returnUrl !== "string" || req.body.returnUrl.length > 2_000))) {
    res.status(400).json({ code: "invalid_argument", error: "Invalid checkout request." });
    return;
  }
  try {
    res.json(await createLibraryCheckout(
      libraryCode(req),
      req.body.plan,
      req.body.returnUrl,
    ));
  } catch (error) {
    sendBillingError(res, error);
  }
});

router.post("/billing/portal", async (req, res): Promise<void> => {
  if (req.body !== undefined && (!isRecord(req.body) ||
    Object.keys(req.body).some((key) => key !== "returnUrl") ||
    (req.body.returnUrl !== undefined &&
      (typeof req.body.returnUrl !== "string" || req.body.returnUrl.length > 2_000)))) {
    res.status(400).json({ code: "invalid_argument", error: "Invalid billing portal request." });
    return;
  }
  try {
    res.json(await createLibraryPortalSession(libraryCode(req), req.body?.returnUrl));
  } catch (error) {
    sendBillingError(res, error);
  }
});

export default router;