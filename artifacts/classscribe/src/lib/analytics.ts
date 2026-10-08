type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void | Promise<unknown>;
    };
  }
}

/** Best-effort analytics; never wait for it or expose tracker failures to users. */
export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;
  try {
    void Promise.resolve(window.umami?.track(name, data)).catch(() => {
      // A rejected tracker request must not affect the successful app action.
    });
  } catch {
    // A missing or broken tracker must not affect the successful app action.
  }
}
