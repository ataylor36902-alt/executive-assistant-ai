import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

type StripeCredentials = {
  secretKey: string;
  webhookSecret?: string;
  livemode: boolean;
};

export class StripeConnectionError extends Error {
  constructor(public readonly code: string) {
    super("Stripe connection is unavailable.");
    this.name = "StripeConnectionError";
  }
}

async function getStripeCredentials(): Promise<StripeCredentials> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const replitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !replitToken) {
    throw new StripeConnectionError("connection_runtime_identity_missing");
  }

  let response: Response;
  try {
    response = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
      {
        headers: {
          Accept: "application/json",
          X_REPLIT_TOKEN: replitToken,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new StripeConnectionError("connection_credential_request_failed");
  }
  if (!response.ok) {
    throw new StripeConnectionError(`connection_credential_http_${response.status}`);
  }

  let payload: {
    items?: Array<{
      settings?: {
        secret?: unknown;
        api_key?: unknown;
        secret_key?: unknown;
        webhook_secret?: unknown;
      };
    }>;
  };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new StripeConnectionError("connection_credential_response_invalid");
  }
  const settings = payload.items?.[0]?.settings;
  const connectedSecret = typeof settings?.secret === "string" && settings.secret
    ? settings.secret
    : undefined;
  const apiKey = typeof settings?.api_key === "string" && settings.api_key
    ? settings.api_key
    : undefined;
  const secretKey = typeof settings?.secret_key === "string" && settings.secret_key
    ? settings.secret_key
    : undefined;
  const keys = [connectedSecret, apiKey, secretKey]
    .filter((value): value is string => Boolean(value));
  if (
    keys.length === 0 ||
    keys.some((key) => !/^(sk|rk)_(test|live)_/.test(key)) ||
    new Set(keys).size > 1
  ) {
    throw new StripeConnectionError(
      new Set(keys).size > 1
        ? "stripe_api_key_fields_conflict"
        : "stripe_api_key_missing_or_invalid",
    );
  }
  return {
    secretKey: connectedSecret ?? apiKey ?? secretKey!,
    livemode: /^(sk|rk)_live_/.test(keys[0]!),
    webhookSecret:
      typeof settings?.webhook_secret === "string" && settings.webhook_secret
        ? settings.webhook_secret
        : undefined,
  };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Stripe billing.");
  }
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}

export async function getStripeConnectionWebhookSecret(): Promise<string | undefined> {
  const { webhookSecret } = await getStripeCredentials();
  return webhookSecret;
}

export async function getStripeConnectionLivemode(): Promise<boolean> {
  return (await getStripeCredentials()).livemode;
}