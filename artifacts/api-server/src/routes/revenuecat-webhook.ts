import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { BillingError, processRevenueCatWebhook } from "../lib/classscribe-billing";
import { processCreditsRevenueCatWebhook } from "../lib/classscribe-credits";

const router: IRouter = Router();
export const REVENUECAT_WEBHOOK_AUTH_CONTEXT = "classscribe-revenuecat-webhook-v1";

export function expectedRevenueCatWebhookAuthorization(): string | undefined {
  const configuredValue = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
  if (configuredValue !== undefined) {
    return configuredValue.length > 0 ? configuredValue : undefined;
  }
  const sessionSecret = process.env.SESSION_SECRET;
  if (typeof sessionSecret !== "string" || sessionSecret.length === 0) return undefined;
  const digest = createHmac("sha256", sessionSecret)
    .update(REVENUECAT_WEBHOOK_AUTH_CONTEXT)
    .digest("hex");
  return `Bearer ${digest}`;
}

function authorizeRevenueCatWebhook(req: Request, res: Response, next: NextFunction): void {
  const expectedValue = expectedRevenueCatWebhookAuthorization();
  const suppliedValue = req.get("Authorization");
  if (typeof expectedValue !== "string" || expectedValue.length === 0) {
    res.status(503).json({ error: "RevenueCat webhook authentication is not configured." });
    return;
  }
  if (typeof suppliedValue !== "string") {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  const expected = Buffer.from(expectedValue);
  const supplied = Buffer.from(suppliedValue);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}

router.post(
  "/revenuecat/webhook",
  authorizeRevenueCatWebhook,
  express.json({ limit: "256kb" }),
  async (req, res): Promise<void> => {
    try {
      await processRevenueCatWebhook(req.body);
      await processCreditsRevenueCatWebhook(req.body);
      res.status(200).json({ received: true });
    } catch (error) {
      if (error instanceof BillingError) {
        res.status(error.httpStatus).json({ error: error.message, code: error.code });
        return;
      }
      res.status(503).json({ error: "RevenueCat webhook processing is temporarily unavailable." });
    }
  },
);

router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: "Invalid RevenueCat webhook request." });
});

export default router;