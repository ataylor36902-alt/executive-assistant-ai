import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import Stripe from "stripe";
import { clerkMiddleware } from "@clerk/express";
import router from "./routes";
import classscribeLegacyRouter from "./routes/classscribe-legacy";
import classscribeEduInquiriesRouter from "./routes/classscribe-edu-inquiries";
import revenueCatWebhookRouter from "./routes/revenuecat-webhook";
import privacyRouter from "./routes/privacy";
import aiConsentRouter, { aiConsentGate } from "./routes/ai-consent";
import { privacyWriteLockMiddleware } from "./middlewares/privacy-write-lock";
import { logger, safeLogUrl } from "./lib/logger";
import { processStripeWebhook, StripeSetupError } from "./lib/classscribe-billing";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: safeLogUrl(req.url),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use("/api", revenueCatWebhookRouter);
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    if (!signature || Array.isArray(signature) || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Missing Stripe signature or raw request body." });
      return;
    }
    try {
      await processStripeWebhook(req.body, signature);
      res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        res.status(400).json({ error: "Invalid Stripe webhook signature." });
        return;
      }
      if (error instanceof StripeSetupError && error.code === "stripe_webhook_mode_mismatch") {
        res.status(400).json({ error: "Stripe event does not match the connected payment environment." });
        return;
      }
      req.log.error({ errorType: error instanceof Error ? error.name : "unknown" }, "Stripe webhook processing failed");
      res.status(503).json({ error: "Stripe webhook processing is temporarily unavailable." });
    }
  },
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
// Expose an optional Clerk identity to legacy billing routes while retaining
// their existing sync-code authorization for clients without a linked account.
app.use(clerkMiddleware());
app.use("/api", privacyWriteLockMiddleware);
app.use("/api", aiConsentRouter);
app.use("/api", aiConsentGate);
// Consent/config, privacy endpoints and the legacy bearer deletion flow must
// remain reachable outside the general authenticated API gate.
app.use("/api", privacyRouter);
app.use("/api", classscribeLegacyRouter);
// School inquiries are intentionally public so prospective institutions do not
// need a student account before contacting the ClassScribe EDU team.
app.use("/api", classscribeEduInquiriesRouter);
app.use("/api/courses/:id/syllabus/upload", express.raw({ type: ["application/pdf", "text/plain"], limit: "10mb" }));

app.use("/api", router);

export default app;
