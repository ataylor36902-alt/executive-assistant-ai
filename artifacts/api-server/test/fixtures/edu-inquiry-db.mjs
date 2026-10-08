import assert from "node:assert/strict";

const counters = new Map();
export const inquiryWrites = [];

export const classscribeLegacyRateLimitsTable = {
  scope: "scope",
  windowStartedAt: "window_started_at",
  requestCount: "request_count",
};

export const db = {
  insert(table) {
    assert.equal(table, classscribeLegacyRateLimitsTable, "Inquiries must not write subscription or billing tables");
    return {
      values({ scope, windowStartedAt }) {
        assert.ok(scope === "global:edu-inquiry" || scope.startsWith("ip:edu-inquiry:"));
        inquiryWrites.push(scope);
        let requestCount = 0;
        return {
          onConflictDoUpdate() {
            const window = windowStartedAt.getTime();
            const previous = counters.get(scope);
            requestCount = previous?.window === window ? previous.count + 1 : 1;
            counters.set(scope, { window, count: requestCount });
            return this;
          },
          async returning() {
            return [{ requestCount }];
          },
        };
      },
    };
  },
  delete() {
    return { where: async () => [] };
  },
};