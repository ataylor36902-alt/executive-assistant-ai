import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StudyGuidePanel } from "../src/components/StudyGuidePanel";

test("web renders the saved guide from a fresh query after reload", () => {
  const guide = {
    id: "guide-id", courseId: "course-id",
    content: "# Big picture\nMock guide based on supplied material.",
    sources: [{ id: "lecture-id", title: "Cell division" }],
    updatedAt: "2026-09-24T12:00:00Z",
  };
  (globalThis as any).__studyGuideTestResponse = { guide: null };
  assert.match(renderToStaticMarkup(<StudyGuidePanel courseId="course-id" />), /No guide saved/);
  // A new tree with an uncached GET result models a full page reload, not a mutation cache update.
  (globalThis as any).__studyGuideTestResponse = process.env.GUIDE_TEST_FIXTURE
    ? JSON.parse(readFileSync(process.env.GUIDE_TEST_FIXTURE, "utf8"))
    : { guide };
  const page = renderToStaticMarkup(<StudyGuidePanel courseId="course-id" />);
  assert.match(page, /Mock guide based on supplied material/);
  assert.match(page, /Cell division/);
  assert.match(page, /Regenerate study guide/);
});