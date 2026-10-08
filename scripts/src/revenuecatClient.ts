import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export async function revenueCatRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await connectors.proxy("revenuecat", path, {
    method,
    ...(body === undefined ? {} : { body }),
  });
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `RevenueCat API request failed (${response.status}) for ${method} ${path}: ${responseText.slice(0, 400)}`,
    );
  }

  if (!responseText) return {} as T;
  return JSON.parse(responseText) as T;
}

type RevenueCatPage<T> = { items?: T[]; next_page?: string };

const fetchRevenueCatPage = <T>(path: string): Promise<RevenueCatPage<T>> =>
  revenueCatRequest<RevenueCatPage<T>>(path);

export async function getRevenueCatPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let nextPage: string | undefined = path;

  while (nextPage) {
    const currentPath: string = nextPage;
    const pageResult: RevenueCatPage<T> = await fetchRevenueCatPage<T>(currentPath);
    items.push(...(pageResult.items ?? []));
    nextPage = typeof pageResult.next_page === "string" ? pageResult.next_page : undefined;
  }

  return items;
}