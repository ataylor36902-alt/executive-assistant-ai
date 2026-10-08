import type Stripe from "stripe";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import {
  getStripeConnectionWebhookSecret,
  getStripeSync,
  getUncachableStripeClient,
} from "./stripeClient";

class StripeSeedReadinessError extends Error {
  constructor(public readonly code: string) {
    super("Stripe billing readiness was not proven.");
  }
}

const plans = [
  {
    id: "student",
    name: "ClassScribe Student",
    amount: 799,
    description: "40 recording hours per month and unlimited courses.",
  },
  {
    id: "pro",
    name: "ClassScribe Pro",
    amount: 1299,
    description: "120 recording hours per month and unlimited courses.",
  },
] as const;

async function findOrCreatePlan(
  stripe: Stripe,
  plan: (typeof plans)[number],
): Promise<void> {
  const productList = await stripe.products.list({ active: true, limit: 100 });
  let product = productList.data.find(
    (item) => item.metadata.classscribe_plan === plan.id,
  );
  if (!product) {
    product = await stripe.products.create({
      name: plan.name,
      description: plan.description,
      metadata: { classscribe_plan: plan.id },
    });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const matchingPrice = prices.data.find(
    (price) =>
      price.currency === "usd" &&
      price.unit_amount === plan.amount &&
      price.recurring?.interval === "month",
  );
  if (matchingPrice) {
    if (matchingPrice.metadata.classscribe_plan !== plan.id) {
      await stripe.prices.update(matchingPrice.id, {
        metadata: { classscribe_plan: plan.id },
      });
    }
    return;
  }

  await stripe.prices.create({
    product: product.id,
    unit_amount: plan.amount,
    currency: "usd",
    recurring: { interval: "month" },
    metadata: { classscribe_plan: plan.id },
  });
}

async function seedClassScribePlans(): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const databaseUrl = process.env.DATABASE_URL;
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!databaseUrl || !domain) throw new StripeSeedReadinessError("required_runtime_configuration_missing");

  await stripe.accounts.retrieve(null);
  const webhookUrl = `https://${domain}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const endpoint = endpoints.data.find((item) => item.url === webhookUrl && item.status === "enabled");
  if (!endpoint) throw new StripeSeedReadinessError("managed_webhook_not_enabled");

  const result = await pool.query<{ id: string; secret: string | null }>(
    'select id, secret from "stripe"."_managed_webhooks" where id = $1 and url = $2 limit 1',
    [endpoint.id, webhookUrl],
  );
  const managedSecret = result.rows[0]?.secret;
  if (typeof managedSecret !== "string" || !managedSecret.startsWith("whsec_")) {
    throw new StripeSeedReadinessError("managed_webhook_secret_missing");
  }
  const connectionSecret = await getStripeConnectionWebhookSecret();
  if (connectionSecret) {
    const expected = Buffer.from(managedSecret);
    const supplied = Buffer.from(connectionSecret);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new StripeSeedReadinessError("managed_webhook_secret_mismatch");
    }
  }

  const sync = await getStripeSync();
  const payloadJson = JSON.stringify({
    id: "evt_classscribe_seed_readiness",
    object: "event",
    created: 0,
    data: { object: {} },
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "classscribe.seed.readiness",
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: payloadJson,
    secret: managedSecret,
  });
  try {
    await sync.processWebhook(Buffer.from(payloadJson), signature);
    await sync.syncBackfill({ object: "all" });
  } catch {
    throw new StripeSeedReadinessError("stripe_sync_readiness_check_failed");
  }

  for (const plan of plans) {
    await findOrCreatePlan(stripe, plan);
  }
}

seedClassScribePlans().catch((error: unknown) => {
  const reason = error instanceof StripeSeedReadinessError
    ? error.code
    : error instanceof Error
      ? error.name
      : "unknown";
  console.error(`ClassScribe Stripe plan seeding did not run (${reason}).`);
  process.exitCode = 1;
});