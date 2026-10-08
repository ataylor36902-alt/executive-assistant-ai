import test from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { privacyLogRedactions, safeLogUrl } from "../src/lib/logger.ts";

test("privacy logger redacts study content, upload bodies, credentials, and provider errors", () => {
  const records = [];
  const log = pino({ redact: privacyLogRedactions }, {
    write(record) { records.push(JSON.parse(record)); },
  });
  log.error({
    transcript: "private transcript",
    prompt: "private prompt",
    audio: "private audio bytes",
    body: "private request body",
    nested: {
      token: "opaque-download-token", apiKey: "provider-secret", key: "private object key",
      content: "private provider payload", question: "private student question",
    },
    deeplyNested: { provider: { payload: { transcript: "private deeply nested transcript" } } },
    err: { message: "provider echoed private request content" },
  }, "provider request failed");
  const serialized = JSON.stringify(records[0]);
  for (const secret of [
    "private transcript", "private prompt", "private audio bytes", "private request body",
    "opaque-download-token", "provider-secret", "private object key", "private provider payload",
    "private student question", "private deeply nested transcript", "provider echoed private request content",
  ]) assert.equal(serialized.includes(secret), false);
});

test("privacy export token paths are redacted before request URL logging", () => {
  assert.equal(
    safeLogUrl("/api/privacy/export/download/opaque-token?debug=1"),
    "/api/privacy/export/download/[redacted]",
  );
  assert.equal(
    safeLogUrl("/api/privacy/download/opaque-token"),
    "/api/privacy/download/[redacted]",
  );
  assert.equal(safeLogUrl("/api/privacy/status?token=not-logged"), "/api/privacy/status");
});