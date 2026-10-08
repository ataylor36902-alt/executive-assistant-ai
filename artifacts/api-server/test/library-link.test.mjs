import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  classscribeCreditTransactionsTable,
  classscribeLegacyDocumentsTable,
} from "@workspace/db";
import libraryLinkRouter from "../src/routes/library-link.ts";
import legacyRouter from "../src/routes/classscribe-legacy.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const linkAccountPath = (id) => `private/library-links/accounts/${hash(id)}`;
const linkOwnerPath = (code) => `private/library-links/owners/${hash(code)}`;

test("authenticated library linking is proven, exclusive, encrypted, and survives code rotation", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousProject = process.env.REVENUECAT_PROJECT_ID;
  const previousProxy = globalThis.__scribeProxy;
  process.env.SESSION_SECRET = "library-link-test-session-secret";
  process.env.REVENUECAT_PROJECT_ID = "library-link-test";
  const account = `clerk_${randomUUID()}`;
  const otherAccount = `clerk_${randomUUID()}`;
  const code = `u_${randomUUID().replaceAll("-", "")}`;
  const otherCode = `u_${randomUUID().replaceAll("-", "")}`;
  const nextCode = `u_${randomUUID().replaceAll("-", "")}`;
  const noProfileCode = `u_${randomUUID().replaceAll("-", "")}`;
  const revokedCode = `u_${randomUUID().replaceAll("-", "")}`;
  const paths = [
    `data/users/${code}/profile`,
    `data/users/${otherCode}/profile`,
    `revoked/${hash(revokedCode)}`,
    linkAccountPath(account),
    linkAccountPath(otherAccount),
    linkOwnerPath(code),
    linkOwnerPath(otherCode),
    linkOwnerPath(nextCode),
    `members/${code}`,
    `members/${nextCode}`,
    `data/users/${code}/notes/test`,
    `data/users/${nextCode}/notes/test`,
    `revoked/${hash(code)}`,
  ];
  const creditHash = hash(code);
  paths.push(
    `private/classscribe-billing/accounts/${creditHash}`,
    `private/classscribe-billing/accounts/${hash(nextCode)}`,
    `private/classscribe-billing/aliases/${creditHash}`,
    `private/classscribe-billing/aliases/${hash(nextCode)}`,
  );
  const provisioned = new Set();
  globalThis.__scribeProxy = async (_connector, path, options = {}) => {
    const url = new URL(path, "https://revenuecat.test");
    if (url.pathname.endsWith("/customers") && options.method === "GET") {
      const appUserId = url.searchParams.get("search");
      return Response.json({ object: "list", items: provisioned.has(appUserId) ? [{
        object: "customer", id: appUserId, project_id: "library-link-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }] : [] });
    }
    if (url.pathname.endsWith("/customers") && options.method === "POST") {
      const body = JSON.parse(options.body);
      provisioned.add(body.id);
      return Response.json({
        object: "customer", id: body.id, project_id: "library-link-test",
        first_seen_at: Date.now(), last_seen_at: null, last_seen_app_version: null,
        last_seen_country: null, last_seen_platform: null, last_seen_platform_version: null,
      }, { status: 201 });
    }
    if (url.pathname.endsWith("/aliases") && options.method === "GET") {
      const customerId = url.pathname.split("/").at(-2);
      return Response.json({ object: "list", items: [{
        object: "customer.alias", id: customerId, created_at: Date.now(),
      }] });
    }
    if (url.pathname.endsWith("/virtual_currencies/transactions") && options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.adjustments, { CRD: 5 });
      assert.equal(body.reference, `credits-welcome-${creditHash}`);
      return Response.json({ object: "virtual_currency_transaction", id: "library-welcome" });
    }
    throw new Error(`Unexpected RevenueCat link test request: ${path}`);
  };
  const app = express();
  app.use(express.json());
  app.use("/api", libraryLinkRouter);
  app.use("/api", legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  const listening = new Promise((resolve) => server.once("listening", resolve));
  try {
    await db.insert(classscribeLegacyDocumentsTable).values([
      { path: `data/users/${code}/profile`, data: { name: "Student" } },
      { path: `data/users/${otherCode}/profile`, data: { name: "Other" } },
      { path: `revoked/${hash(revokedCode)}`, data: { nextHash: hash(nextCode) } },
      { path: `members/${code}`, data: { name: "Student" } },
      { path: `data/users/${code}/notes/test`, data: { note: "Retained" } },
    ]);
    await listening;
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const getLink = (id) => fetch(`${base}/library-link`, {
      headers: { "x-test-user": id },
    });
    const postLink = (id, codeValue) => fetch(`${base}/library-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": id },
      body: JSON.stringify({ code: codeValue }),
    });

    assert.equal((await fetch(`${base}/library-link`)).status, 401);
    assert.deepEqual(await (await getLink(account)).json(), { linked: false });
    assert.equal((await postLink(account, noProfileCode)).status, 400);
    assert.equal((await postLink(account, revokedCode)).status, 400);
    assert.equal((await postLink(account, code)).status, 200);
    assert.equal((await postLink(account, code)).status, 200);
    const linked = await getLink(account);
    assert.equal(linked.headers.get("cache-control"), "no-store");
    assert.deepEqual(await linked.json(), { linked: true, code });
    assert.equal((await postLink(otherAccount, code)).status, 409);
    assert.equal((await postLink(account, otherCode)).status, 409);
    delete process.env.SESSION_SECRET;
    assert.equal((await getLink(account)).status, 503);
    assert.equal((await postLink(account, code)).status, 503);
    process.env.SESSION_SECRET = "library-link-test-session-secret";

    const [storedAccount, storedOwner] = await Promise.all([
      db.select().from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, linkAccountPath(account))),
      db.select().from(classscribeLegacyDocumentsTable)
        .where(eq(classscribeLegacyDocumentsTable.path, linkOwnerPath(code))),
    ]);
    assert.equal(JSON.stringify(storedAccount[0].data).includes(code), false);
    assert.equal(JSON.stringify(storedOwner[0].data).includes(account), false);

    const rotate = await fetch(`${base}/db/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify({ confirm: true, nextCode }),
    });
    assert.equal(rotate.status, 200);
    assert.equal((await rotate.json()).code, nextCode);
    assert.deepEqual(await (await getLink(account)).json(), { linked: true, code: nextCode });
    assert.equal((await fetch(`${base}/db/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CS-User": code },
      body: JSON.stringify({ confirm: true, nextCode }),
    })).status, 200);
    const retained = await db.select().from(classscribeLegacyDocumentsTable)
      .where(eq(classscribeLegacyDocumentsTable.path, `data/users/${nextCode}/notes/test`));
    assert.equal(retained[0].data.note, "Retained");
  } finally {
    await db.delete(classscribeCreditTransactionsTable)
      .where(eq(classscribeCreditTransactionsTable.libraryHash, creditHash));
    await db.delete(classscribeLegacyDocumentsTable)
      .where(inArray(classscribeLegacyDocumentsTable.path, paths));
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousProject === undefined) delete process.env.REVENUECAT_PROJECT_ID;
    else process.env.REVENUECAT_PROJECT_ID = previousProject;
    if (previousProxy === undefined) delete globalThis.__scribeProxy;
    else globalThis.__scribeProxy = previousProxy;
  }
});