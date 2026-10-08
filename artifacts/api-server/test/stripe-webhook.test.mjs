import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import Stripe from "stripe";
import app from "../src/app.ts";
import {
  accountPath, calls, documents, resetFixture, signingSecret, state, subscription,
} from "./fixtures/stripe-webhook.mjs";

// Unlike billing.test.mjs, these requests traverse the production HTTP route,
// raw-body parser, processStripeWebhook and real Stripe signature verification.
const signer = new Stripe("sk_test_local_webhook_signer");
const event = {
  id: "evt_signed_http_fixture",
  object: "event",
  type: "customer.subscription.updated",
  created: 1_790_000_001,
  livemode: false,
  data: { object: subscription },
};
// Whitespace/newlines ensure JSON parse + reserialization changes signed bytes.
const payload = `${JSON.stringify(event, null, 2)}\n`;
const sign = (body = payload, options = {}) => signer.webhooks.generateTestHeaderString({
  payload: body, secret: signingSecret, ...options,
});
let server;
let url;
let initialDocuments;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  url = `http://127.0.0.1:${server.address().port}/api/stripe/webhook`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});
beforeEach(() => {
  resetFixture();
  initialDocuments = structuredClone([...documents]);
});

async function post(body, signature, contentType = "application/json") {
  const headers = { "content-type": contentType };
  if (signature !== undefined) headers["stripe-signature"] = signature;
  const response = await fetch(url, { method: "POST", headers, body });
  return { status: response.status, body: await response.json() };
}

function assertNoProcessing() {
  assert.deepEqual([...documents], initialDocuments, "entitlements and event records must stay unchanged");
  assert.equal(calls.filter(call =>
    ["sync-client", "sync", "read", "transaction", "write", "subscription", "product"].includes(call.kind),
  ).length, 0, "untrusted events must not reach sync or entitlement processing");
}

test("missing signature is rejected at HTTP boundary without verification or writes", async () => {
  assert.deepEqual(await post(payload), {
    status: 400, body: { error: "Missing Stripe signature or raw request body." },
  });
  assert.deepEqual(calls, []);
  assertNoProcessing();
});

for (const [name, signature] of [
  ["malformed", () => "not-a-stripe-signature"],
  ["wrong signing secret", () => sign(payload, { secret: "whsec_untrusted_fixture" })],
  ["stale timestamp", () => sign(payload, { timestamp: 1 })],
]) {
  test(`${name} signature returns 400 and cannot mutate entitlements`, async () => {
    assert.deepEqual(await post(payload, signature()), {
      status: 400, body: { error: "Invalid Stripe webhook signature." },
    });
    assert.equal(calls.filter(call => call.kind === "verify").length, 1);
    assertNoProcessing();
  });
}

test("tampered event content is rejected even with an otherwise valid signature", async () => {
  const tampered = payload.replace('"livemode": false', '"livemode": true');
  assert.notEqual(tampered, payload);
  assert.equal((await post(tampered, sign())).status, 400);
  assertNoProcessing();
});

test("JSON-equivalent reserialization is not accepted under the original raw-body signature", async () => {
  const reserialized = JSON.stringify(JSON.parse(payload));
  assert.notEqual(reserialized, payload);
  assert.deepEqual(await post(reserialized, sign()), {
    status: 400, body: { error: "Invalid Stripe webhook signature." },
  });
  assertNoProcessing();
});

test("valid signature with a non-raw content type is rejected before billing", async () => {
  assert.deepEqual(await post(payload, sign(), "text/plain"), {
    status: 400, body: { error: "Missing Stripe signature or raw request body." },
  });
  assert.deepEqual(calls, []);
  assertNoProcessing();
});

test("signed event from the wrong Stripe environment cannot sync or update plans", async () => {
  const livePayload = JSON.stringify({ ...event, livemode: true });
  assert.deepEqual(await post(livePayload, sign(livePayload)), {
    status: 400,
    body: { error: "Stripe event does not match the connected payment environment." },
  });
  assert.equal(calls.filter(call => call.kind === "verify").length, 1);
  assertNoProcessing();
});

test("a valid raw-body signature verifies, syncs exact bytes, and processes entitlement once", async () => {
  const signature = sign();
  assert.deepEqual(await post(payload, signature), { status: 200, body: { received: true } });
  for (const kind of ["verify", "sync-client", "sync", "transaction", "subscription", "product"]) {
    assert.equal(calls.filter(call => call.kind === kind).length, 1, `${kind} must run once`);
  }
  for (const kind of ["verify", "sync"]) {
    const call = calls.find(call => call.kind === kind);
    assert.ok(Buffer.isBuffer(call.payload), `${kind} must receive a raw Buffer`);
    assert.deepEqual(call.payload, Buffer.from(payload));
    assert.equal(call.signature, signature);
  }
  const kinds = calls.map(call => call.kind);
  assert.ok(kinds.indexOf("verify") < kinds.indexOf("sync-client"));
  assert.ok(kinds.indexOf("sync") < kinds.indexOf("transaction"));
  assert.equal(documents.get(accountPath).data.plan, "student");
  assert.equal(calls.filter(call => call.kind === "write" && call.path === accountPath).length, 1);
  const eventRecords = [...documents.values()].filter(row => row.data.eventId === event.id);
  assert.equal(eventRecords.length, 1);
});

test("sync failure returns 503 without acknowledging or changing entitlements", async () => {
  state.syncError = true;
  assert.deepEqual(await post(payload, sign()), {
    status: 503, body: { error: "Stripe webhook processing is temporarily unavailable." },
  });
  assert.equal(calls.filter(call => call.kind === "sync").length, 1);
  assert.equal(calls.filter(call => call.kind === "transaction" || call.kind === "write").length, 0);
  assert.deepEqual([...documents], initialDocuments);
});
