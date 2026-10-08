import test from "node:test";
import assert from "node:assert/strict";
import { PreviewSyllabusResponse, ConfirmSyllabusBody } from "@workspace/api-zod";
import { normalizeSyllabusPreview } from "../src/lib/syllabus-proposals.ts";

test("dated and undated syllabus coursework survives preview and confirmation", () => {
  const text = "Unit 1: Cells. Quiz 1 due October 8, 2026. Read chapter 2.";
  const parsed = PreviewSyllabusResponse.parse({
    proposedName: "Biology", proposedSubject: "BIO 101", proposedTerm: "Fall 2026",
    dates: [{ title: "Quiz 1", kind: "exam", dueDate: "2026-10-08", sourceText: "Quiz 1 due October 8, 2026" }],
    modules: [{ title: "Unit 1: Cells", sourceText: "Unit 1: Cells" }],
    assignments: [
      { title: "Quiz 1", type: "quiz", dueDate: "2026-10-08", sourceText: "Quiz 1 due October 8, 2026" },
      { title: "Read chapter 2", type: "reading", dueDate: null, sourceText: "Read chapter 2" },
    ],
  });
  assert.ok(parsed.assignments[0].dueDate instanceof Date);

  const preview = JSON.parse(JSON.stringify({ ...parsed, ...normalizeSyllabusPreview(parsed, text) }));
  assert.equal(preview.dates[0].dueDate, "2026-10-08");
  assert.deepEqual(preview.assignments.map(a => a.dueDate), ["2026-10-08", null]);
  assert.ok(preview.assignments.every(a => a.dueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)));

  const confirmation = {
    name: preview.proposedName, subject: preview.proposedSubject, term: preview.proposedTerm,
    selectedDates: preview.dates, selectedModules: preview.modules, selectedAssignments: preview.assignments,
  };
  assert.deepEqual(ConfirmSyllabusBody.parse(confirmation).selectedAssignments.map(a => a.title),
    ["Quiz 1", "Read chapter 2"]);
  const legacy = ConfirmSyllabusBody.parse({
    name: preview.proposedName, subject: preview.proposedSubject, term: preview.proposedTerm,
    selectedDates: preview.dates,
  });
  assert.equal(legacy.selectedModules, undefined);
  assert.equal(legacy.selectedAssignments, undefined);
});