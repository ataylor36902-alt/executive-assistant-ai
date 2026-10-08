import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getRevenueCatPages, revenueCatRequest } from "./revenuecatClient";

type Project = { id: string; name?: string };
type App = { id: string; name?: string; type?: string };
type WebhookIntegration = {
  id: string;
  project_id?: string;
  name?: string;
  url?: string;
  environment?: "production" | "sandbox" | null;
  event_types?: string[] | null;
  app_id?: string | null;
};

const INTEGRATION_NAME = "ClassScribe Test Store sandbox webhook";
const AUTH_CONTEXT = "classscribe-revenuecat-webhook-v1";
const EVENT_TYPES = [
  "initial_purchase",
  "renewal",
  "product_change",
  "cancellation",
  "billing_issue",
  "non_renewing_purchase",
  "uncancellation",
  "transfer",
  "subscription_paused",
  "expiration",
  "subscription_extended",
  "invoice_issuance",
  "temporary_entitlement_grant",
  "refund_reversed",
  "virtual_currency_transaction",
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

function validateDevHost(rawDomain: string): { hostname: string; url: string } {
  if (
    rawDomain.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*$/i.test(
      rawDomain,
    )
  ) {
    throw new Error(
      "REPLIT_DEV_DOMAIN must be a hostname only (no scheme, path, port, or credentials).",
    );
  }

  const parsed = new URL(`https://${rawDomain}/api/revenuecat/webhook`);
  const hostname = rawDomain.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== hostname ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/api/revenuecat/webhook" ||
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    !hostname.includes(".")
  ) {
    throw new Error("REPLIT_DEV_DOMAIN did not resolve to a safe public HTTPS hostname.");
  }
  return { hostname, url: parsed.toString().replace(/\/$/, "") };
}

function getAuthorizationHeader(): string {
  const override = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER;
  const value =
    override !== undefined
      ? override
      : `Bearer ${createHmac("sha256", requiredEnv("SESSION_SECRET"))
          .update(AUTH_CONTEXT, "utf8")
          .digest("hex")}`;
  if (!value || /[\r\n]/.test(value)) {
    throw new Error(
      "REVENUECAT_WEBHOOK_AUTH_HEADER must be non-empty and contain no line breaks.",
    );
  }
  return value;
}

function path(projectId: string, suffix: string): string {
  return `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;
}

function equalEventTypes(
  actual: string[] | null | undefined,
  expected: readonly string[],
): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((eventType) => actual.includes(eventType))
  );
}

function sanitizeError(error: unknown, authorizationHeader: string): string {
  let message = error instanceof Error ? error.message : "Unknown RevenueCat API error";
  if (authorizationHeader) {
    message = message.split(authorizationHeader).join("[REDACTED]");
  }
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

async function main(): Promise<void> {
  const projectId = requiredEnv("REVENUECAT_PROJECT_ID");
  const testStoreAppId = requiredEnv("REVENUECAT_TEST_STORE_APP_ID");
  const { hostname, url } = validateDevHost(requiredEnv("REPLIT_DEV_DOMAIN"));
  const authorizationHeader = getAuthorizationHeader();

  const projects = await getRevenueCatPages<Project>("/v2/projects?limit=100");
  const project = projects.find((item) => item.id === projectId);
  if (!project || project.name !== "ClassScribe") {
    throw new Error(
      "REVENUECAT_PROJECT_ID does not identify the ClassScribe RevenueCat project; no webhook changes made.",
    );
  }
  const apps = await getRevenueCatPages<App>(
    path(projectId, "/apps?limit=100"),
  );
  const testStoreApp = apps.find(
    (item) => item.id === testStoreAppId && item.type === "test_store",
  );
  if (!testStoreApp) {
    throw new Error(
      "REVENUECAT_TEST_STORE_APP_ID does not identify this project's Test Store app; no webhook changes made.",
    );
  }

  const integrationsPath = path(projectId, "/integrations/webhooks");
  const integrations = await getRevenueCatPages<WebhookIntegration>(
    `${integrationsPath}?limit=100`,
  );
  const namedMatches = integrations.filter(
    (item) => item.name === INTEGRATION_NAME,
  );
  if (namedMatches.length > 1) {
    throw new Error(
      `Found multiple integrations named "${INTEGRATION_NAME}"; resolve the ambiguity manually. No webhook changes made.`,
    );
  }
  const owned = namedMatches[0];
  if (
    owned &&
    (owned.project_id !== projectId ||
      owned.app_id !== testStoreAppId ||
      owned.environment !== "sandbox")
  ) {
    throw new Error(
      `Integration "${INTEGRATION_NAME}" exists outside the expected Test Store sandbox scope; it was not modified.`,
    );
  }

  const conflict = integrations.find(
    (item) =>
      item.id !== owned?.id &&
      (item.url === url ||
        (item.app_id === testStoreAppId && item.environment === "sandbox")),
  );
  if (conflict) {
    throw new Error(
      `Another webhook integration (${conflict.id}) already targets this endpoint or Test Store sandbox scope; it was not modified and no duplicate was created.`,
    );
  }

  const body = {
    name: INTEGRATION_NAME,
    url,
    authorization_header: authorizationHeader,
    environment: "sandbox",
    event_types: [...EVENT_TYPES],
    app_id: testStoreAppId,
  };

  let integrationId: string;
  let action: "created" | "updated";
  if (owned) {
    await revenueCatRequest(
      path(
        projectId,
        `/integrations/webhooks/${encodeURIComponent(owned.id)}`,
      ),
      "POST",
      body,
    );
    integrationId = owned.id;
    action = "updated";
  } else {
    const created = await revenueCatRequest<WebhookIntegration>(
      integrationsPath,
      "POST",
      body,
    );
    integrationId = created.id;
    action = "created";
  }

  const verifiedIntegrations =
    await getRevenueCatPages<WebhookIntegration>(
      `${integrationsPath}?limit=100`,
    );
  const verified = verifiedIntegrations.find(
    (item) => item.id === integrationId,
  );
  if (
    !verified ||
    verified.project_id !== projectId ||
    verified.name !== INTEGRATION_NAME ||
    verified.url !== url ||
    verified.environment !== "sandbox" ||
    verified.app_id !== testStoreAppId ||
    !equalEventTypes(verified.event_types, EVENT_TYPES)
  ) {
    throw new Error(
      "RevenueCat accepted the webhook request but the saved sandbox configuration did not match; inspect the integration in RevenueCat before retrying.",
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "verified",
        action,
        integrationId,
        projectId,
        testStoreAppId,
        name: INTEGRATION_NAME,
        url,
        hostname,
        environment: verified.environment,
        eventTypes: verified.event_types,
        authorizationHeaderSubmitted: true,
        authorizationHeaderLogged: false,
        appScope: "Test Store only",
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const authorizationHeader =
    process.env.REVENUECAT_WEBHOOK_AUTH_HEADER ??
    (process.env.SESSION_SECRET
      ? `Bearer ${createHmac("sha256", process.env.SESSION_SECRET)
          .update(AUTH_CONTEXT, "utf8")
          .digest("hex")}`
      : "");
  console.error(
    "RevenueCat sandbox webhook setup failed:",
    sanitizeError(error, authorizationHeader),
  );
  process.exitCode = 1;
});