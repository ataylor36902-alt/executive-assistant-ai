import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import healthRouter from "./health";
import classscribeRouter from "./classscribe";
import classscribeAskRouter from "./classscribeAsk";
import notesRouter from "./notes";
import studyPlansRouter from "./study-plans";
import studyGuidesRouter from "./study-guides";
import gradesRouter from "./grades";
import libraryLinkRouter from "./library-link";
import classscribeEduRouter, { requireEduCredential, requireEduCourseAgreement } from "./classscribe-edu";
import classscribeEduLearningRouter from "./classscribe-edu-learning";
import classscribeEduMediaRouter from "./classscribe-edu-media";
import classscribeCreditsRouter from "./classscribe-credits";
import privacyConsentsRouter from "./privacy-consents";
import { isPrivacyDeletedUser } from "../lib/privacy-access";

const router: IRouter = Router();

router.use(healthRouter);
router.use(privacyConsentsRouter);
router.use((req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});
router.use(async (req, res, next) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    if (await isPrivacyDeletedUser(userId)) {
      res.status(410).json({ error: "This account and private library have been deleted." });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: "Could not verify account privacy status." });
  }
});
router.use(libraryLinkRouter);
router.use(classscribeCreditsRouter);
// Shared gate is intentionally mounted before every EDU feature router so
// subsequently-added /edu routers inherit the same per-Clerk-session check.
router.use("/edu", requireEduCredential);
router.use("/edu/courses/:id", requireEduCourseAgreement);
router.use(classscribeEduRouter);
router.use(classscribeEduLearningRouter);
router.use(classscribeEduMediaRouter);
router.use(classscribeRouter);
router.use(classscribeAskRouter);
router.use(notesRouter);
router.use(studyPlansRouter);
router.use(studyGuidesRouter);
router.use(gradesRouter);

export default router;
