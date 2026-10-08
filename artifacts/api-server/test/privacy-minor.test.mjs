import test from "node:test";
import assert from "node:assert/strict";
import { canSharePublicly, firstNameOnly, publicAuthorName } from "../src/lib/privacy-minor.ts";

test("minor public author names omit the private surname", () => {
  assert.equal(publicAuthorName("13-17", "Taylor Morgan"), "Taylor");
  assert.equal(firstNameOnly("  Taylor   Morgan  "), "Taylor");
});

test("class-group sharing is rejected for minors even without a write-time claim", () => {
  assert.equal(canSharePublicly("13-17"), false);
  assert.equal(canSharePublicly("13-17", true), false);
});

test("adult public author names and sharing behavior remain unchanged", () => {
  assert.equal(publicAuthorName("18+", "Taylor Morgan"), "Taylor Morgan");
  assert.equal(canSharePublicly("18+"), true);
  assert.equal(publicAuthorName(null, "Taylor Morgan"), "Taylor Morgan");
});