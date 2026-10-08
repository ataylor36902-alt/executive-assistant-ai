import test from "node:test";
import assert from "node:assert/strict";
import {
  deletePrivacyConsentsForLectureWithStore,
  privacyConsentMatchesRecording,
  savePrivacyConsentWithStore,
  validatePrivacyConsentInput,
} from "../src/lib/classscribe-consents.ts";

const config = {
  version: "2025-01",
  statements: ["I agree to recording.", "I have read the privacy notice."],
};
const input = {
  sessionId: "recording-session-123",
  lectureId: "lecture-123",
  courseId: "course-123",
  version: config.version,
  statements: [...config.statements],
  platform: "web",
  appVersion: "1.2.3",
  accommodation: false,
};

function createStore() {
  const records = new Map();
  return {
    records,
    async find(libraryHash, sessionId) {
      return records.get(`${libraryHash}:${sessionId}`);
    },
    async insertIfAbsent(record) {
      const key = `${record.libraryHash}:${record.sessionId}`;
      if (!records.has(key)) records.set(key, record);
    },
    async deleteForLecture(libraryHash, lectureId) {
      let deleted = 0;
      for (const [key, record] of records) {
        if (record.libraryHash === libraryHash && record.lectureId === lectureId) {
          records.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
}

test("consent is saved once and stable session retries are idempotent", async () => {
  const store = createStore();
  const validated = validatePrivacyConsentInput(input, config);
  assert.equal(validated.valid, true);
  const first = await savePrivacyConsentWithStore(store, "library-a-hash", validated.input);
  const retry = await savePrivacyConsentWithStore(store, "library-a-hash", validated.input);

  assert.equal(first.saved, true);
  assert.equal(first.idempotent, false);
  assert.equal(retry.saved, true);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.consentId, first.consentId);
  assert.equal(store.records.size, 1);
});

test("a stable session cannot replace its immutable consent record", async () => {
  const store = createStore();
  const validated = validatePrivacyConsentInput(input, config);
  assert.equal(validated.valid, true);
  await savePrivacyConsentWithStore(store, "library-a-hash", validated.input);

  const changed = { ...validated.input, accommodation: true };
  assert.deepEqual(
    await savePrivacyConsentWithStore(store, "library-a-hash", changed),
    { saved: false, conflict: true },
  );
});

test("a prior session's consent cannot authorize a new recording session", async () => {
  const store = createStore();
  const validated = validatePrivacyConsentInput(input, config);
  assert.equal(validated.valid, true);
  await savePrivacyConsentWithStore(store, "library-a-hash", validated.input);
  const saved = await store.find("library-a-hash", input.sessionId);

  assert.equal(privacyConsentMatchesRecording(saved, {
    sessionId: "new-recording-session",
    lectureId: input.lectureId,
    courseId: input.courseId,
  }), false);
  assert.equal(privacyConsentMatchesRecording(saved, {
    sessionId: input.sessionId,
    lectureId: "different-lecture",
    courseId: input.courseId,
  }), false);
  assert.equal(privacyConsentMatchesRecording(saved, {
    sessionId: input.sessionId,
    lectureId: input.lectureId,
    courseId: input.courseId,
  }), true);
});

test("consent records are isolated by library ownership", async () => {
  const store = createStore();
  const validated = validatePrivacyConsentInput(input, config);
  assert.equal(validated.valid, true);
  await savePrivacyConsentWithStore(store, "library-a-hash", validated.input);

  assert.equal(await store.find("library-b-hash", input.sessionId), undefined);
});

test("deleting a lecture's consent never deletes another library's record", async () => {
  const store = createStore();
  const validated = validatePrivacyConsentInput(input, config);
  assert.equal(validated.valid, true);
  await savePrivacyConsentWithStore(store, "library-a-hash", validated.input);
  await savePrivacyConsentWithStore(store, "library-b-hash", validated.input);

  assert.equal(
    await deletePrivacyConsentsForLectureWithStore(store, "library-a-hash", input.lectureId),
    1,
  );
  assert.equal(await store.find("library-a-hash", input.sessionId), undefined);
  assert.ok(await store.find("library-b-hash", input.sessionId));
});

test("missing consent fields and non-current version or exact text are rejected", () => {
  assert.equal(validatePrivacyConsentInput({ ...input, sessionId: undefined }, config).valid, false);
  assert.equal(validatePrivacyConsentInput({ ...input, version: "old-version" }, config).valid, false);
  assert.equal(validatePrivacyConsentInput({
    ...input,
    statements: ["I agree to recording.", "Edited text"],
  }, config).valid, false);
});