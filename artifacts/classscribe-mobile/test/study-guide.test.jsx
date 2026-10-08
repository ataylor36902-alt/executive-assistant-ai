import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Guide from "../app/guide";

test("phone renders the saved guide from a fresh query after reload", () => {
  const guide = {
    id: "guide-id", courseId: "course-id",
    content: "# Big picture\nMock guide based on supplied material.",
    sources: [{ id: "lecture-id", title: "Cell division" }],
    updatedAt: "2026-09-24T12:00:00Z",
  };
  const response = process.env.GUIDE_TEST_FIXTURE
    ? JSON.parse(readFileSync(process.env.GUIDE_TEST_FIXTURE, "utf8"))
    : { guide };
  const course = { id: "course-id", code: "TEST", name: "Study guide test", guides: {} };
  globalThis.__studyGuideStore = {
    course: () => course, all: () => ({}), lecturesOf: () => [],
    notesOf: () => [], lecture: () => null,
  };
  assert.match(renderToStaticMarkup(<Guide />), /Generate study guide/);
  // A new screen/store instance models re-opening the saved guide after a reload.
  globalThis.__studyGuideStore = {
    ...globalThis.__studyGuideStore,
    course: () => ({
      ...course,
      guides: { finals: { text: response.guide.content, ai: true, at: Date.parse(response.guide.updatedAt) } },
    }),
  };
  const page = renderToStaticMarkup(<Guide />);
  assert.match(page, /Mock guide based on supplied material/);
  assert.match(page, /Written with AI/);
  assert.match(page, /Regenerate/);
});