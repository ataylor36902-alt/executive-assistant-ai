import { revenueCatRequest } from "./revenuecatClient";
import { randomUUID } from "node:crypto";

type Resource = Record<string, unknown> & {
  id: string;
  name?: string;
  display_name?: string;
  lookup_key?: string;
  type?: string;
  app_id?: string;
  store_identifier?: string;
  is_current?: boolean;
};

type PublicApiKey = { id?: string; key?: unknown };

type Webhook = {
  id: string;
  name?: string;
  project_id?: string;
  app_id?: string | null;
  environment?: string | null;
  url?: string;
  authorization_header?: unknown;
};

const projectPath = (projectId: string, suffix: string) =>
  `/v2/projects/${encodeURIComponent(projectId)}${suffix}`;

let apiQueue: Promise<void> = Promise.resolve();

function get<T>(path: string): Promise<T> {
  const request = apiQueue.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return revenueCatRequest<T>(path);
  });
  apiQueue = request.then(
    () => undefined,
    () => undefined,
  );
  return request;
}

async function getPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let nextPage: string | undefined = path;
  while (nextPage) {
    const page: { items?: T[]; next_page?: string } =
      await get<{ items?: T[]; next_page?: string }>(nextPage);
    items.push(...(page.items ?? []));
    nextPage =
      typeof page.next_page === "string" ? page.next_page : undefined;
  }
  return items;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.length > 0;
}

function credentialFlags(app: Resource): Record<string, boolean> {
  const candidates: Record<string, unknown> = {
    appStoreCredential: app.app_store_credentials,
    playStoreCredential: app.play_store_credentials,
    genericCredential: app.credentials,
    hasAppStoreCredentials: app.has_app_store_credentials,
    hasPlayStoreCredentials: app.has_play_store_credentials,
    hasCredentials: app.has_credentials,
    appStoreSharedSecret:
      (app.app_store as Record<string, unknown> | undefined)?.shared_secret,
    playStoreServiceAccount:
      (app.play_store as Record<string, unknown> | undefined)
        ?.service_account_credentials,
  };
  return Object.fromEntries(
    Object.entries(candidates).map(([name, value]) => [
      name,
      typeof value === "boolean" ? value : nonEmpty(value) || Boolean(value && typeof value === "object"),
    ]),
  );
}

function hasAnyCredentialMetadata(app: Resource): boolean {
  return [
    "app_store_credentials",
    "play_store_credentials",
    "credentials",
    "has_app_store_credentials",
    "has_play_store_credentials",
    "has_credentials",
  ].some((key) => Object.prototype.hasOwnProperty.call(app, key));
}

function appMetadata(app: Resource) {
  const appStore =
    app.app_store && typeof app.app_store === "object"
      ? (app.app_store as Record<string, unknown>)
      : {};
  const playStore =
    app.play_store && typeof app.play_store === "object"
      ? (app.play_store as Record<string, unknown>)
      : {};
  return {
    bundleId:
      typeof appStore.bundle_id === "string"
        ? appStore.bundle_id
        : typeof app.bundle_id === "string"
          ? app.bundle_id
          : null,
    packageName:
      typeof playStore.package_name === "string"
        ? playStore.package_name
        : typeof app.package_name === "string"
          ? app.package_name
          : null,
  };
}

function publicKeyEnvironmentName(app: Resource): string | undefined {
  if (app.type === "test_store") return "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY";
  if (app.type === "app_store") return "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY";
  if (app.type === "play_store") return "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY";
  return undefined;
}

async function probePublicOfferings(app: Resource) {
  const envName = publicKeyEnvironmentName(app);
  const key = envName ? process.env[envName] : undefined;
  if (!key) return { status: "key_missing" };
  try {
    // Read-only RevenueCat v1 offerings endpoint; never print the key or probe identity.
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${randomUUID()}/offerings`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "X-Platform": app.type === "play_store" ? "android" : "ios",
        },
      },
    );
    if (!response.ok) return { status: `http_${response.status}` };
    const data = (await response.json()) as {
      current_offering_id?: string;
      offerings?: Array<{
        identifier?: string;
        packages?: Array<{
          identifier?: string;
          platform_product_identifier?: string;
          price?: unknown;
        }>;
      }>;
    };
    const current = data.offerings?.find(
      (offering) => offering.identifier === data.current_offering_id,
    );
    return {
      status: "ok",
      currentOfferingId: data.current_offering_id ?? null,
      packages:
        current?.packages?.map((pkg) => ({
          identifier: pkg.identifier ?? null,
          platformProductIdentifier: pkg.platform_product_identifier ?? null,
          includesPrice: pkg.price != null,
        })) ?? [],
    };
  } catch {
    return { status: "network_error" };
  }
}

function safeUrl(rawUrl: unknown) {
  if (typeof rawUrl !== "string") {
    return { host: null, path: null, isLiveUrl: false, isDevUrl: false };
  }
  try {
    const url = new URL(rawUrl);
    const host = url.hostname;
    const pathname = url.pathname;
    const exactWebhookPath = pathname === "/api/revenuecat/webhook";
    const devHost = process.env.REPLIT_DEV_DOMAIN?.toLowerCase();
    return {
      host,
      path: pathname,
      isLiveUrl:
        url.protocol === "https:" &&
        host === "class-scribe.replit.app" &&
        exactWebhookPath,
      isDevUrl:
        url.protocol === "https:" &&
        Boolean(devHost) &&
        host.toLowerCase() === devHost &&
        exactWebhookPath,
    };
  } catch {
    return { host: null, path: null, isLiveUrl: false, isDevUrl: false };
  }
}

function safePriceResult(raw: unknown) {
  const items = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" &&
        Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : [];
  return items.map((item) => {
    const price = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: typeof price.id === "string" ? price.id : null,
      amountMicros:
        typeof price.amount_micros === "number" ? price.amount_micros : null,
      currency: typeof price.currency === "string" ? price.currency : null,
      isCurrent: typeof price.is_current === "boolean" ? price.is_current : null,
    };
  });
}

function resourceItems(raw: unknown): Resource[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const product = (item as { product?: unknown }).product;
    return product && typeof product === "object"
      ? [product as Resource]
      : [item as Resource];
  });
}

async function main(): Promise<void> {
  const projects = await getPages<Resource>("/v2/projects?limit=100");
  const classScribeProjects = projects.filter(
    (project) => project.name === "ClassScribe",
  );
  const auditProjects = await Promise.all(
    classScribeProjects.map(async (project) => {
      const [apps, products, entitlements, offerings, webhooks] =
        await Promise.all([
          getPages<Resource>(
            projectPath(project.id, "/apps?limit=100"),
          ),
          getPages<Resource>(
            projectPath(project.id, "/products?limit=100"),
          ),
          getPages<Resource>(
            projectPath(project.id, "/entitlements?limit=100"),
          ),
          getPages<Resource>(
            projectPath(project.id, "/offerings?limit=100"),
          ),
          getPages<Webhook>(
            projectPath(project.id, "/integrations/webhooks?limit=100"),
          ),
        ]);

      const publicKeysByApp = await Promise.all(
        apps.map(async (app) => {
          const keys = await getPages<PublicApiKey>(
            projectPath(
              project.id,
              `/apps/${encodeURIComponent(app.id)}/public_api_keys?limit=100`,
            ),
          );
          const key = keys.find((item) => typeof item.key === "string")?.key;
          const envName = publicKeyEnvironmentName(app);
          const envKey = envName ? process.env[envName] : undefined;
          return {
            appId: app.id,
            hasPublicKey: nonEmpty(key),
            comparisonEnvironmentKey: envName ?? null,
            environmentKeyPresent: nonEmpty(envKey),
            exactKeyMatch: nonEmpty(key) && nonEmpty(envKey) && key === envKey,
          };
        }),
      );
      const publicOfferings = await Promise.all(
        apps.map(async (app) => ({ appId: app.id, result: await probePublicOfferings(app) })),
      );

      const offeringDetailsByApp = await Promise.all(
        apps.map(async (app) => {
          const currentOfferings = await Promise.all(
            offerings
              .filter((offering) => offering.is_current === true)
              .map(async (offering) => {
                const packages = await getPages<Resource>(
                  projectPath(
                    project.id,
                    `/offerings/${encodeURIComponent(offering.id)}/packages?limit=100`,
                  ),
                );
                const details = await Promise.all(
                  packages.map(async (pkg) => {
                    const linkedProducts = resourceItems(
                      await get(
                        projectPath(
                          project.id,
                          `/packages/${encodeURIComponent(pkg.id)}/products`,
                        ),
                      ),
                    );
                    const productIds = linkedProducts
                      .map((link) =>
                        typeof link.product_id === "string"
                          ? link.product_id
                          : typeof link.id === "string"
                            ? link.id
                            : null,
                      )
                      .filter((id): id is string => id !== null);
                    return {
                      packageId: pkg.id,
                      packageLookupKey: pkg.lookup_key ?? null,
                      packageDisplayName: pkg.display_name ?? pkg.name ?? null,
                      appProducts: products
                        .filter(
                          (product) =>
                            product.app_id === app.id &&
                            productIds.includes(product.id),
                        )
                        .map((product) => ({
                          id: product.id,
                          storeIdentifier: product.store_identifier ?? null,
                        })),
                    };
                  }),
                );
                return {
                  id: offering.id,
                  lookupKey: offering.lookup_key ?? null,
                  displayName: offering.display_name ?? offering.name ?? null,
                  packages: details.filter((pkg) => pkg.appProducts.length > 0),
                };
              }),
          );
          return { appId: app.id, offerings: currentOfferings };
        }),
      );

      const testStoreApps = apps.filter((app) => app.type === "test_store");
      const testStoreProducts = products.filter((product) =>
        testStoreApps.some((app) => app.id === product.app_id),
      );
      const testStorePrices = await Promise.all(
        testStoreProducts.map(async (product) => {
          const prices = await get(
            projectPath(
              project.id,
              `/products/${encodeURIComponent(product.id)}/test_store_prices`,
            ),
          );
          return {
            productId: product.id,
            storeIdentifier: product.store_identifier ?? null,
            prices: safePriceResult(prices),
          };
        }),
      );

      const testStoreEntitlements = await Promise.all(
        entitlements.map(async (entitlement) => {
          const links = resourceItems(
            await get(
              projectPath(
                project.id,
                `/entitlements/${encodeURIComponent(entitlement.id)}/products`,
              ),
            ),
          );
          const linkedIds = links
            .map((link) =>
              typeof link.product_id === "string"
                ? link.product_id
                : typeof link.id === "string"
                  ? link.id
                  : null,
            )
            .filter((id): id is string => id !== null);
          const linkedTestProducts = testStoreProducts
            .filter((product) => linkedIds.includes(product.id))
            .map((product) => ({
              id: product.id,
              storeIdentifier: product.store_identifier ?? null,
            }));
          return linkedTestProducts.length
            ? {
                id: entitlement.id,
                lookupKey: entitlement.lookup_key ?? null,
                displayName:
                  entitlement.display_name ?? entitlement.name ?? null,
                testStoreProducts: linkedTestProducts,
              }
            : null;
        }),
      );

      return {
        id: project.id,
        apps: apps.map((app) => {
          const keyStatus = publicKeysByApp.find((item) => item.appId === app.id);
          return {
            id: app.id,
            name: app.name ?? null,
            type: app.type ?? null,
            ...appMetadata(app),
            storeCredentialFlags: credentialFlags(app),
            storeCredentialMetadataReadable: hasAnyCredentialMetadata(app),
            publicKey: {
              exists: keyStatus?.hasPublicKey ?? false,
              comparedEnvironmentKey:
                keyStatus?.comparisonEnvironmentKey ?? null,
              environmentKeyPresent: keyStatus?.environmentKeyPresent ?? false,
              exactEnvironmentKeyMatch: keyStatus?.exactKeyMatch ?? false,
            },
            publicOfferings: publicOfferings.find((item) => item.appId === app.id)?.result ?? null,
            currentOfferings:
              offeringDetailsByApp.find((item) => item.appId === app.id)
                ?.offerings ?? [],
          };
        }),
        testStore: {
          prices: testStorePrices,
          entitlements: testStoreEntitlements.filter(
            (item): item is NonNullable<typeof item> => item !== null,
          ),
        },
        webhooks: webhooks.map((webhook) => ({
          id: webhook.id,
          name: webhook.name ?? null,
          scope: {
            projectId: webhook.project_id ?? project.id,
            appId: webhook.app_id ?? null,
            environment: webhook.environment ?? null,
          },
          ...safeUrl(webhook.url),
          authorizationHeaderFieldPresent: Object.prototype.hasOwnProperty.call(
            webhook,
            "authorization_header",
          ),
          authorizationHeaderValuePresent: nonEmpty(
            webhook.authorization_header,
          ),
          authorizationHeaderReadable:
            typeof webhook.authorization_header === "string",
        })),
      };
    }),
  );

  console.log(
    JSON.stringify(
      {
        classScribeProjectCount: classScribeProjects.length,
        projects: auditProjects,
        offeringsEndpointCheck: {
          checked: true,
          result: "public_keys_checked",
          reason:
            "GET /v1/subscribers/{temporary_uuid}/offerings was queried with each platform's public key. This endpoint returns package and product identifiers, not the App Store or Play Store's localized prices. Native StoreKit/Google Billing must resolve those prices on an installed build.",
        },
        apiMethodsUsed: ["GET"],
        secretsOrSubscriberDataLogged: false,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/RevenueCat API request failed \((\d{3})\)/)?.[1];
  console.error(
    status
      ? `RevenueCat read-only audit failed with HTTP ${status}. Response details are suppressed to prevent disclosure of credentials or API response data.`
      : "RevenueCat read-only audit failed. Details are suppressed to prevent disclosure of credentials or API response data.",
  );
  process.exitCode = 1;
});