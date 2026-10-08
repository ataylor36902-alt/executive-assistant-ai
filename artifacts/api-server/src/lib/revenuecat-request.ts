import { ReplitConnectors } from "@replit/connectors-sdk";

const revenueCatApiOrigin = "https://api.revenuecat.com";
const revenueCatProjectPathPattern =
  /^\/v2\/projects(?:\?[^#]*)?$|^\/v2\/projects\/[A-Za-z0-9_-]{1,128}\/customers(?:\?[^#]*)?$|^\/v2\/projects\/[A-Za-z0-9_-]{1,128}\/customers\/[A-Za-z0-9_-]{1,1500}(?:\/(?:aliases|virtual_currencies(?:\/transactions)?))?(?:\?[^#]*)?$/;

export function hasRevenueCatCreditsApiKey(): boolean {
  return Boolean(process.env.REVENUECAT_CREDITS_API_KEY?.trim());
}

export async function revenueCatRequest(
  path: string,
  options: {
    method: "GET" | "POST" | "DELETE";
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<Response> {
  if (!revenueCatProjectPathPattern.test(path) || path.includes("://")) {
    throw new Error("RevenueCat request path is invalid.");
  }

  const apiKey = process.env.REVENUECAT_CREDITS_API_KEY?.trim();
  if (!apiKey) {
    return new ReplitConnectors().proxy("revenuecat", path, options);
  }

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Accept", "application/json");
  return fetch(new URL(path, revenueCatApiOrigin), {
    method: options.method,
    headers,
    ...(options.body ? { body: options.body } : {}),
  });
}