import { Router, type IRouter, type Request } from "express";
import {
  savePrivacyConsent,
  validatePrivacyConsentInput,
  type PrivacyConsentConfig,
} from "../lib/classscribe-consents";
import { requirePrivacyLibrary } from "../lib/privacy-access";
import { privacyConsentConfig } from "../lib/privacy-config";

export type PrivacyLibrary = { libraryHash: string };
export type RequirePrivacyLibrary = (req: Request) => Promise<PrivacyLibrary | null>;

/**
 * Core wires this router to requirePrivacyLibrary(req) and the consent
 * statements/version from the shared privacy config.
 */
export function createPrivacyConsentsRouter(
  requirePrivacyLibrary: RequirePrivacyLibrary,
  config: PrivacyConsentConfig,
): IRouter {
  const router: IRouter = Router();

  router.post("/privacy/consents", async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    let library: PrivacyLibrary | null;
    try {
      library = await requirePrivacyLibrary(req);
    } catch (error) {
      const status = error && typeof error === "object" &&
        "status" in error && typeof error.status === "number" ? error.status : 503;
      res.status(status).json({
        code: status === 401 ? "unauthorized" : "privacy_library_unavailable",
        error: status === 401 ? "Send a valid legacy library bearer matching X-CS-User, or sign in." : "Could not verify your private library.",
      });
      return;
    }
    if (!library) {
      res.status(403).json({ code: "privacy_library_required", error: "A library owner is required to save recording consent." });
      return;
    }

    const validated = validatePrivacyConsentInput(req.body, config);
    if (!validated.valid) {
      res.status(400).json({ code: "invalid_consent", error: validated.error });
      return;
    }

    try {
      const result = await savePrivacyConsent(library.libraryHash, validated.input);
      if (!result.saved) {
        res.status(409).json({ code: "consent_session_conflict", error: "This recording session already has a different immutable consent record." });
        return;
      }
      res.status(result.idempotent ? 200 : 201).json({
        saved: true,
        id: result.consentId,
        consentId: result.consentId,
        idempotent: result.idempotent,
      });
    } catch (error) {
      req.log.error({ err: error }, "Could not persist privacy consent");
      res.status(503).json({ code: "privacy_consent_unavailable", error: "Could not save recording consent. Retry before recording." });
    }
  });

  return router;
}

const router = createPrivacyConsentsRouter(
  async req => requirePrivacyLibrary(req),
  privacyConsentConfig,
);

export default router;