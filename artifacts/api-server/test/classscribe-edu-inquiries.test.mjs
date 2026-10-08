import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import eduInquiriesRouter, { parseEduInquiry } from "../src/routes/classscribe-edu-inquiries.ts";
import { SUPPORT_EMAIL } from "../src/lib/classscribe-support-email.ts";
import { inquiryWrites } from "./fixtures/edu-inquiry-db.mjs";

const validInquiry = {
  name: "Morgan Lee",
  email: "morgan@north.example",
  school: "North University",
  role: "IT director",
  message: "Interested in campus access.",
};

async function postInquiry(body) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { warn() {} };
    next();
  });
  app.use(eduInquiriesRouter);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await fetch(`http://127.0.0.1:${server.address().port}/edu-inquiries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("EDU inquiry trims and validates school contact details", () => {
  assert.deepEqual(parseEduInquiry({
    ...validInquiry,
    name: " Morgan Lee ",
    email: " morgan@north.example ",
    message: " Interested in campus access. ",
  }), validInquiry);
  assert.equal(parseEduInquiry({ ...validInquiry, email: "not-an-email" }), null);
  assert.equal(parseEduInquiry({ ...validInquiry, role: "R".repeat(121) }), null);
  assert.equal(parseEduInquiry({ ...validInquiry, extra: "unsupported" }), null);
});

test("public EDU inquiry sends to the established support contact and confirms provider acceptance", async () => {
  const previousProxy = globalThis.__scribeProxy;
  const calls = [];
  const writesBefore = inquiryWrites.length;
  globalThis.__scribeProxy = async (name, path, options) => {
    assert.equal(name, "google-mail");
    calls.push({ path, options });
    if (path === "/gmail/v1/users/me/profile") return Response.json({ emailAddress: "support@classscribe.example" });
    if (path === "/gmail/v1/users/me/messages/send") return Response.json({ id: "accepted-message" });
    return new Response(null, { status: 404 });
  };
  try {
    const response = await postInquiry(validInquiry);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.deepEqual(inquiryWrites.slice(writesBefore).map((scope) => scope.split(":")[0]), ["global", "ip"]);
    assert.deepEqual(calls.map((call) => call.path), [
      "/gmail/v1/users/me/profile",
      "/gmail/v1/users/me/messages/send",
    ]);
    const send = calls.find((call) => call.path === "/gmail/v1/users/me/messages/send");
    const mime = Buffer.from(JSON.parse(send.options.body).raw, "base64url").toString("utf8");
    assert.ok(mime.includes(`To: <${SUPPORT_EMAIL}>`));
    assert.ok(mime.includes("Reply-To: morgan@north.example"));
    const emailBody = Buffer.from(mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
    assert.ok(emailBody.includes("North University"));
  } finally {
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("EDU inquiry reports delivery failure instead of showing a false confirmation", async () => {
  const previousProxy = globalThis.__scribeProxy;
  globalThis.__scribeProxy = async (_name, path) => path === "/gmail/v1/users/me/profile"
    ? Response.json({ emailAddress: "support@classscribe.example" })
    : new Response(null, { status: 503 });
  try {
    const response = await postInquiry(validInquiry);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      code: "unavailable",
      error: "Your inquiry could not be sent right now. Please try again later.",
    });
  } finally {
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("missing provider acknowledgement and connector errors are retryable, never accepted", async (t) => {
  const previousProxy = globalThis.__scribeProxy;
  try {
    for (const [name, sendResult] of [
      ["missing message ID", () => Response.json({})],
      ["empty message ID", () => Response.json({ id: "" })],
      ["invalid provider JSON", () => new Response("not JSON")],
      ["connector exception", () => { throw new Error("Simulated mail outage"); }],
    ]) {
      await t.test(name, async () => {
        globalThis.__scribeProxy = async (connector, path) => {
          assert.equal(connector, "google-mail");
          if (path === "/gmail/v1/users/me/profile") return Response.json({ emailAddress: "support@classscribe.example" });
          assert.equal(path, "/gmail/v1/users/me/messages/send");
          return sendResult();
        };
        const response = await postInquiry(validInquiry);
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.code, "unavailable");
        assert.match(body.error, /try again later/i);
        assert.equal("accepted" in body, false);
      });
    }
  } finally {
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("a failed provider send leaves the inquiry retryable without changing a plan", async () => {
  const previousProxy = globalThis.__scribeProxy;
  let attempts = 0;
  globalThis.__scribeProxy = async (connector, path) => {
    assert.equal(connector, "google-mail");
    if (path === "/gmail/v1/users/me/profile") return Response.json({ emailAddress: "support@classscribe.example" });
    assert.equal(path, "/gmail/v1/users/me/messages/send");
    return ++attempts === 1
      ? new Response(null, { status: 503 })
      : Response.json({ id: "retry-accepted" });
  };
  try {
    const failed = await postInquiry(validInquiry);
    assert.equal(failed.status, 503);
    assert.equal("accepted" in await failed.json(), false);
    const retried = await postInquiry(validInquiry);
    assert.equal(retried.status, 200);
    assert.deepEqual(await retried.json(), { accepted: true });
    assert.equal(attempts, 2);
  } finally {
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});

test("inquiries cannot request a subscription or billing operation", async () => {
  const writesBefore = inquiryWrites.length;
  const response = await postInquiry({ ...validInquiry, plan: "edu", priceId: "test-price" });
  assert.equal(response.status, 400);
  assert.equal(inquiryWrites.length, writesBefore);
});