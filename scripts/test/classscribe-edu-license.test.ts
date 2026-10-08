import assert from "node:assert/strict";
import test from "node:test";
import { parseEduLicenseCommand, runEduLicenseCommand } from "../src/classscribe-edu-license-command.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const userId = "user_Abcdefghij0123456789";
const validGrantArgs = ["grant", userId, "agreement:9b4f0c81-89cf-4bdf-9d2b", "2027-01-01T00:00:00Z"];

test("operator command accepts only exact, well-formed grant and revoke arguments", () => {
  assert.equal(parseEduLicenseCommand(validGrantArgs, now).action, "grant");
  assert.deepEqual(parseEduLicenseCommand(["revoke", userId], now), { action: "revoke", userId });
  for (const args of [
    [...validGrantArgs, "extra"],
    ["grant", userId, "reference:valid"],
    ["revoke", userId, "extra"],
    ["revoke", userId, " ", " "],
  ]) assert.throws(() => parseEduLicenseCommand(args, now), /exactly/);
});

test("operator command rejects padded or malformed Clerk IDs and unsafe agreement references", () => {
  for (const badId of [" user_Abcdefghij0123456789", "user_Abcdefghij0123456789 ", "clerk_Abcdefghij0123456789", "user_short"]) {
    assert.throws(() => parseEduLicenseCommand(["revoke", badId], now), /Clerk user ID/);
  }
  for (const reference of ["", " agreement:0123456789", "agreement:0123456789 ", "https://example.org/secret", "ref; DROP TABLE", "x".repeat(201)]) {
    assert.throws(() => parseEduLicenseCommand(["grant", userId, reference, "2027-01-01T00:00:00Z"], now), /Agreement reference/);
  }
});

test("expiry requires a real future ISO date-time and explicit timezone", () => {
  for (const expiry of [
    "2027-01-01T00:00:00",
    "2027-02-30T00:00:00Z",
    "2027-01-01",
    "2025-12-31T23:59:59Z",
    "2027-01-01T00:00:00+14:01",
    "tomorrow",
  ]) {
    assert.throws(() => parseEduLicenseCommand(["grant", userId, "agreement:valid-ref-0123456", expiry], now));
  }
  assert.equal(parseEduLicenseCommand([
    "grant", userId, "agreement:valid-ref-0123456", "2027-01-01T03:00:00+03:00",
  ], now).action, "grant");
});

test("Clerk identity verification fails closed before license grant or revocation writes", async () => {
  let writes = 0;
  const query = async () => { writes += 1; return { rows: [{ user_id: userId }] }; };
  await assert.rejects(runEduLicenseCommand(validGrantArgs, {
    lookupClerkUser: async () => { throw new Error("Clerk unavailable"); },
    query,
    now,
  }), /Could not verify this account/);
  await assert.rejects(runEduLicenseCommand(validGrantArgs, {
    lookupClerkUser: async () => ({ id: "user_Different0123456789" }),
    query,
    now,
  }), /did not match/);
  await assert.rejects(runEduLicenseCommand(["revoke", userId], {
    lookupClerkUser: async () => { throw new Error("Clerk unavailable"); },
    query,
    now,
  }), /Could not verify this account/);
  assert.equal(writes, 0);
});

test("verified fixture identity may issue a parameterized grant/revocation write", async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const dependencies = {
    lookupClerkUser: async (id: string) => ({ id }),
    query: async (query: string, values: unknown[]) => {
      calls.push({ query, values });
      return { rows: [{ user_id: userId }] };
    },
    now,
  };
  const credentials = await runEduLicenseCommand(validGrantArgs, dependencies);
  assert.ok(credentials);
  assert.match(credentials.licenseNumber, /^EDU-[A-F0-9]{24}$/);
  assert.match(credentials.clientPin, /^\d{10}$/);
  assert.match(calls[0].query, /insert into classscribe_edu_license_grants/);
  assert.deepEqual(calls[0].values.slice(0, 2), [userId, "agreement:9b4f0c81-89cf-4bdf-9d2b"]);
  assert.match(calls[3].query, /insert into classscribe_edu_client_licenses/);
  assert.equal(calls[3].values[0], credentials.licenseNumber);
  assert.equal(calls[3].values[3].toString().includes(credentials.clientPin), false);
  await runEduLicenseCommand(["revoke", userId], dependencies);
  assert.match(calls[4].query, /update classscribe_edu_license_grants/);
  assert.match(calls[6].query, /delete from classscribe_edu_client_sessions/);
});

test("verified institutional agreement is recorded once, with an administrator and auditable revocation", async () => {
  const calls: Array<{ query: string; values: unknown[] }> = [];
  const dependencies = {
    lookupClerkUser: async (id: string) => ({ id }),
    query: async (query: string, values: unknown[]) => {
      calls.push({ query, values });
      return { rows: [{ signed_agreement_ref: "agreement:school-ref-123456" }] };
    },
    now,
  };
  assert.equal(parseEduLicenseCommand(["school", userId, "agreement:school-ref-123456", "2027-01-01T00:00:00Z"], now).action, "school");
  assert.throws(() => parseEduLicenseCommand(["revoke-school", userId, "not valid"], now), /Agreement reference/);
  assert.throws(() => parseEduLicenseCommand(["school", userId, "agreement:school-ref-123456", "2025-01-01T00:00:00Z"], now), /later/);
  const result = await runEduLicenseCommand(["school", userId, "agreement:school-ref-123456", "2027-01-01T00:00:00Z"], dependencies);
  assert.ok(result);
  assert.match(calls[0].query, /insert into classscribe_edu_institution_agreements/);
  assert.deepEqual(calls[0].values.slice(0, 2), ["agreement:school-ref-123456", userId]);
  assert.match(calls[1].query, /classscribe_edu_instructor_audit/);
  assert.equal(calls[2].values[3], userId);
  calls.length = 0;
  await runEduLicenseCommand(["revoke-school", userId, "agreement:school-ref-123456"], dependencies);
  assert.match(calls[0].query, /update classscribe_edu_institution_agreements/);
  assert.deepEqual(calls[0].values, ["agreement:school-ref-123456", userId]);
  assert.match(calls[1].query, /agreement-revoked/);
  await runEduLicenseCommand(["revoke-school", userId, "agreement:school-ref-123456"], {
    ...dependencies,
    lookupClerkUser: async () => { throw new Error("Deleted account"); },
  });
});