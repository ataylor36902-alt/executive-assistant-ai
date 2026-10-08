import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  db, pool, classscribeEduLicenseGrantsTable as grants,
  classscribeEduInstitutionAgreementsTable as schools,
  classscribeEduInstructorAuditTable as audit,
  classscribeEduClientLicensesTable as licenses,
  classscribeEduClientSessionsTable as sessions,
} from "@workspace/db";
import eduRouter, { requireEduCredential } from "../src/routes/classscribe-edu.ts";

test("instructor history is administrator-only, agreement-scoped, bounded, and stable", async () => {
  const suffix = randomUUID();
  const ref = `history-a-${suffix}`, otherRef = `history-b-${suffix}`;
  const admin = `admin-${suffix}`, otherAdmin = `other-admin-${suffix}`, instructor = `instructor-${suffix}`;
  const users = [admin, otherAdmin, instructor];
  const expiresAt = new Date(Date.now() + 86400000);
  const approvedAt = new Date(Date.now() - 60000);
  const app = express();
  app.use((req, res, next) => {
    req.log = { error() {}, warn() {} };
    if (!getAuth(req).userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  });
  app.use("/api/edu", requireEduCredential);
  app.use("/api", eduRouter);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/edu/school/instructor-history`;
  async function request(query = "", user = admin) {
    const response = await fetch(`${base}${query}`, { headers: user ? { "x-test-user": user } : {} });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  try {
    await db.insert(schools).values([
      { signedAgreementRef: ref, adminUserId: admin, verifiedAt: approvedAt, expiresAt },
      { signedAgreementRef: otherRef, adminUserId: otherAdmin, verifiedAt: approvedAt, expiresAt },
    ]);
    await db.insert(grants).values(users.map(userId => ({
      userId, signedAgreementRef: userId === otherAdmin ? otherRef : ref, approvedAt, expiresAt,
    })));
    for (const userId of users) {
      const signedAgreementRef = userId === otherAdmin ? otherRef : ref;
      const [license] = await db.insert(licenses).values({
        licenseNumber: `history-license-${userId}`, ownerUserId: userId, signedAgreementRef,
        pinHash: "unused-test-hash", expiresAt,
      }).returning();
      await db.insert(sessions).values({
        licenseId: license.id, userId, clerkSessionId: `sess_${userId}`, signedAgreementRef, expiresAt,
      });
    }
    assert.equal((await request("", null)).status, 401);
    assert.equal((await request("", instructor)).status, 403);
    assert.equal((await request("", `outsider-${suffix}`)).status, 403);
    assert.deepEqual((await request()).body, { signedAgreementRef: ref, events: [], nextCursor: null });
    const occurredAt = new Date(Date.now() - 1000);
    const rows = await db.insert(audit).values(Array.from({ length: 25 }, (_, i) => ({
      signedAgreementRef: ref, issuerUserId: i % 2 ? admin : "former-admin",
      instructorUserId: `historical-instructor-${i}`, action: i % 2 ? "approved" : "revoked",
      occurredAt, expiresAt: i % 2 ? expiresAt : null,
    }))).returning();
    const [foreign] = await db.insert(audit).values({
      signedAgreementRef: otherRef, issuerUserId: otherAdmin, instructorUserId: "other-school-instructor",
      action: "approved", occurredAt, expiresAt,
    }).returning();
    const expectedIds = rows.map(row => row.id).sort().reverse();
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-store");
    assert.equal(first.body.events.length, 20);
    assert.deepEqual(first.body.events.map(row => row.id), expectedIds.slice(0, 20));
    assert.ok(first.body.events.some(row => row.issuerUserId === "former-admin"));
    assert.ok(first.body.events.every(row => row.occurredAt === occurredAt.toISOString()));
    assert.ok(first.body.events.every(row => row.action === "approved" ? row.expiresAt === expiresAt.toISOString() : row.expiresAt === null));
    assert.equal(first.body.nextCursor, expectedIds[19]);
    // A newly appended event does not shift the older continuation page.
    await db.insert(audit).values({
      signedAgreementRef: ref, issuerUserId: admin, instructorUserId: instructor,
      action: "approved", occurredAt: new Date(), expiresAt,
    });
    const second = await request(`?cursor=${first.body.nextCursor}`);
    assert.deepEqual(second.body.events.map(row => row.id), expectedIds.slice(20));
    assert.equal(second.body.nextCursor, null);
    assert.equal((await request("?limit=100")).body.events.length, 26);
    assert.equal((await request("?limit=1")).body.events.length, 1);
    assert.deepEqual((await request("", otherAdmin)).body.events.map(row => row.id), [foreign.id]);
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=bad", "limit=1&limit=2", "cursor=bad", `cursor=${randomUUID()}`, `cursor=${foreign.id}`]) {
      assert.equal((await request(`?${query}`)).status, 400, query);
    }
    assert.equal((await request(`?cursor=${first.body.nextCursor}`, otherAdmin)).status, 400);
    await db.update(schools).set({ expiresAt: approvedAt }).where(eq(schools.signedAgreementRef, ref));
    assert.equal((await request()).status, 403);
    await db.update(schools).set({ expiresAt, revokedAt: new Date() }).where(eq(schools.signedAgreementRef, ref));
    assert.equal((await request()).status, 403);
    await db.update(schools).set({ revokedAt: null }).where(eq(schools.signedAgreementRef, ref));
    await db.update(grants).set({ revokedAt: new Date() }).where(eq(grants.userId, admin));
    assert.equal((await request()).status, 403);
  } finally {
    await db.delete(audit).where(inArray(audit.signedAgreementRef, [ref, otherRef]));
    await db.delete(licenses).where(inArray(licenses.ownerUserId, users));
    await db.delete(grants).where(inArray(grants.userId, users));
    await db.delete(schools).where(inArray(schools.signedAgreementRef, [ref, otherRef]));
    server.close();
    await pool.end();
  }
});
