import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
};

async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !replitToken) {
    throw new Error(
      "Stripe is not connected. Connect Stripe in the Integrations tab before creating products.",
    );
  }
  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: replitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Could not load the Stripe connection (${response.status}).`);
  }
  const payload = await response.json() as {
    items?: Array<{
      settings?: {
        secret?: unknown;
        api_key?: unknown;
        secret_key?: unknown;
        webhook_secret?: unknown;
      };
    }>;
  };
  const settings = payload.items?.[0]?.settings;
  const connectedSecret =
    typeof settings?.secret === "string" && settings.secret
      ? settings.secret
      : undefined;
  const apiKey = typeof settings?.api_key === "string" && settings.api_key
    ? settings.api_key
    : undefined;
  const secretKey = typeof settings?.secret_key === "string" && settings.secret_key
    ? settings.secret_key
    : undefined;
  const keys = [connectedSecret, apiKey, secretKey].filter(
    (value): value is string => Boolean(value),
  );
  if (
    keys.length === 0 ||
    keys.some((key) => !/^(sk|rk)_test_/.test(key)) ||
    new Set(keys).size > 1
  ) {
    throw new Error(
      "Stripe connection must provide one consistent secret API key.",
    );
  }
  return {
    secretKey: connectedSecret ?? apiKey ?? secretKey!,
    webhookSecret:
      typeof settings?.webhook_secret === "string" && settings.webhook_secret
        ? settings.webhook_secret
        : undefined,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  return new Stripe((await getStripeCredentials()).secretKey);
}

export async function getStripeConnectionWebhookSecret(): Promise<string | undefined> {
  return (await getStripeCredentials()).webhookSecret;
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe billing.");
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}