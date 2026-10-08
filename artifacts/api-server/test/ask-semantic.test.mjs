import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, pool, classscribeLegacyDocumentsTable as documents } from "@workspace/db";
import legacyRouter from "../src/routes/classscribe-legacy.ts";
import { aiConsentGate } from "../src/routes/ai-consent.ts";
import { aiConsentNotice, aiConsentPath } from "../src/lib/ai-consent.ts";
import { coverageNotice, keywordRank, preparePassages, semanticRank } from "../src/lib/ask-retrieval.ts";
import { privatePassages } from "../src/lib/ask-private-passages.ts";

test("semantic ranks meaning without lexical overlap and rejects invented passage numbers", async () => {
  const sources = [
    { id: "real", kind: "note", courseId: "course", title: "Biology", text: "Mitochondria synthesize ATP through oxidative phosphorylation." },
    { id: "other", kind: "note", courseId: "course", title: "Biology", text: "Chromosomes separate during mitosis." },
  ];
  const { candidates, coverage } = preparePassages(sources);
  assert.equal(keywordRank("cellular energy production", candidates).length, 0);
  const hits = await semanticRank("cellular energy production", candidates, async (system, input) => {
    assert.match(system, /synonyms and paraphrases/);
    assert.equal(input.includes('"id"'), false);
    return '{"matches":[0,0]}';
  });
  assert.deepEqual(hits, [sources[0]]);
  assert.equal(coverage.partial, false);
  for (const result of ['{"matches":[999]}', '{"matches":[-1]}', '{"matches":[0.5]}', '{"matches":["0"]}', "not json"]) {
    await assert.rejects(semanticRank("question", candidates, async () => result));
  }
});

test("coverage exposes passage and long-text limits with fair allocation", () => {
  const { candidates, coverage } = preparePassages([
    { id: "long", kind: "note", courseId: "c", title: "Long", text: "x".repeat(40_000) },
    { id: "short", kind: "note", courseId: "c", title: "Short", text: "A short note" },
  ], 3);
  assert.equal(candidates[1].id, "short");
  assert.equal(coverage.partial, true);
  assert.equal(coverage.truncatedSources, 1);
  assert.match(coverageNotice(coverage), /Partial search: searched 3 of/);
  assert.match(coverageNotice({ ...coverage, partial: false, truncatedSources: 0 }, true), /source-loading limit/);
});

test("private passage extraction excludes peers, shared work, examples, nested docs and audio", () => {
  const uid = "u_abcdefghijklmnop";
  const prefix = `data/users/${uid}/lib/`;
  const rows = [
    { path: `${prefix}courses/c`, data: {} },
    { path: `${prefix}lectures/l`, data: { courseId: "c", audio: "RAW_AUDIO", segs: [{ t: 17.25, x: "ATP" }, { x: "Untimed" }, { t: null, x: "Unknown time" }] } },
    { path: `${prefix}notes/n`, data: { courseId: "c", body: "Private note" } },
    { path: `${prefix}notes/shared`, data: { courseId: "c", body: "Peer work", sharedCopy: true } },
    { path: `${prefix}notes/peer`, data: { courseId: "c", body: "Peer private work", by: "another" } },
    { path: `${prefix}notes/example`, data: { courseId: "c", body: "Example", ex: true } },
    { path: `${prefix}notes/n/replies/r`, data: { courseId: "c", body: "Nested" } },
    { path: "data/users/u_otherotherotherot/lib/notes/n", data: { courseId: "c", body: "Other library" } },
  ];
  const passages = privatePassages(rows, uid, ["c"]);
  assert.deepEqual(passages.map(p => p.id), ["l", "n"]);
  assert.equal(passages[0].seconds, 17.25);
  assert.equal(JSON.stringify(passages).includes("RAW_AUDIO"), false);
  assert.deepEqual(privatePassages(rows, uid, ["otherCourse"]), []);
});

test("real evidence route enforces consent, library/scope isolation, edits and deletes", async () => {
  const uid = `u_${randomUUID().replaceAll("-", "")}`;
  const other = `u_${randomUUID().replaceAll("-", "")}`;
  const prefix = `data/users/${uid}/lib/`;
  const consentPath = aiConsentPath(createHash("sha256").update(uid).digest("hex"));
  const rows = [
    { path: `${prefix}courses/c`, data: { semester: "Fall", title: "Biology" } },
    { path: `${prefix}courses/spring`, data: { semester: "Spring" } },
    { path: `${prefix}lectures/l`, data: { courseId: "c", title: "Respiration", audio: "AUDIO_MUST_NOT_LEAVE", segs: [{ t: 17.25, x: "Mitochondria synthesize ATP through oxidative phosphorylation." }] } },
    { path: `${prefix}notes/n`, data: { courseId: "c", title: "Note", body: "Cell membranes contain lipids." } },
    { path: `${prefix}notes/outside`, data: { courseId: "spring", title: "Other term", body: "OUT_OF_SCOPE" } },
    { path: `${prefix}notes/shared`, data: { courseId: "c", sharedCopy: true, body: "SHARED_PRIVATE_WORK" } },
    { path: `data/users/${other}/lib/notes/peer`, data: { courseId: "c", body: "OTHER_LIBRARY" } },
  ];
  const originalFetch = globalThis.fetch;
  let rankCalls = 0;
  let action = "none";
  let providerInput = "";
  globalThis.fetch = async (url, options) => {
    if (!String(url).endsWith("/v1/messages")) return originalFetch(url, options);
    rankCalls++;
    const body = JSON.parse(options.body);
    providerInput = body.messages[0].content;
    const passages = JSON.parse(providerInput).passages;
    if (action === "delete") await db.delete(documents).where(inArray(documents.path, [`${prefix}lectures/l`]));
    if (action === "edit") await db.update(documents).set({ data: { courseId: "c", title: "Edited", segs: [{ t: 17.25, x: "Updated content" }] } }).where(inArray(documents.path, [`${prefix}lectures/l`]));
    if (action === "malformed") return new Response(JSON.stringify({ content: [{ type: "text", text: '{"matches":[9999]}' }] }));
    const number = passages.find(p => p.title === "Respiration" || p.title === "Edited")?.number;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ matches: number === undefined ? [] : [number] }) }] }));
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn() {}, error() {} }; next(); });
  app.use("/api", aiConsentGate, legacyRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = body => originalFetch(`${base}/api/ai/evidence`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-CS-User": uid },
    body: JSON.stringify(body),
  });
  try {
    await db.insert(documents).values(rows);
    const body = { query: "cellular energy production", courseIds: ["c"], mode: "semantic" };
    let response = await request(body);
    assert.equal(response.status, 403);
    assert.equal(rankCalls, 0);
    await db.insert(documents).values({ path: consentPath, data: { version: aiConsentNotice.version, accepted: true } });
    response = await request(body);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    let result = await response.json();
    assert.equal(result.hits[0].id, "l");
    assert.equal(result.hits[0].seconds, 17.25);
    for (const forbidden of [uid, other, "AUDIO_MUST_NOT_LEAVE", "OUT_OF_SCOPE", "SHARED_PRIVATE_WORK", "OTHER_LIBRARY"]) {
      assert.equal(providerInput.includes(forbidden), false);
    }
    const callsBeforeKeyword = rankCalls;
    response = await request({ ...body, mode: "keyword", query: "oxidative" });
    assert.equal(response.status, 200);
    assert.equal(rankCalls, callsBeforeKeyword);
    action = "edit";
    response = await request(body);
    result = await response.json();
    assert.equal(result.hits.length, 0);
    assert.match(result.notice, /changed during this search/);
    action = "none";
    response = await request(body);
    result = await response.json();
    assert.equal(result.hits[0].title, "Edited");
    assert.equal(result.hits[0].text, "Updated content");
    action = "delete";
    response = await request(body);
    result = await response.json();
    assert.equal(result.hits.length, 0);
    action = "none";
    response = await request(body);
    assert.equal((await response.json()).hits.length, 0);
    action = "malformed";
    response = await request(body);
    assert.equal(response.status, 503);
    response = await request({ ...body, courseIds: ["../peer"] });
    assert.equal(response.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    await db.delete(documents).where(inArray(documents.path, [...rows.map(r => r.path), consentPath]));
    await new Promise(resolve => server.close(resolve));
    await pool.end();
  }
});
