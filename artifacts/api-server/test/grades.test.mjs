import test from "node:test";
import assert from "node:assert/strict";
import { currentGrade, neededGrade, proposedWeights, weightsFromText, validScale } from "../src/lib/grades.ts";

const weights = [{ category: "Homework", weight: 60 }, { category: "Exams", weight: 40 }];
const items = [
  { id: "homework", category: "Homework", scorePercent: 90, title: "Homework 1" },
  { id: "midterm", category: "Exams", scorePercent: null, title: "the midterm" },
];

test("current grade normalizes only completed weighted categories", () => {
  assert.equal(currentGrade(items, weights), 90);
  assert.equal(currentGrade(items, [{ category: "Homework", weight: 50 }]), null);
  assert.equal(currentGrade(items.map(item => ({ ...item, scorePercent: null })), weights), null);
  assert.equal(currentGrade([...items, { id: "quiz", category: "Unweighted", scorePercent: 0 }], weights), 90);
});

test("needed grade solves the actual category average and marks impossible outcomes", () => {
  assert.equal(neededGrade(items, weights, "midterm", 87).requiredPercent, 82.5);
  assert.equal(neededGrade([
    ...items, { id: "exam1", category: "Exams", scorePercent: 80, title: "Exam 1" },
  ], weights, "midterm", 87).requiredPercent, 85);
  assert.ok(neededGrade(items, weights, "midterm", 99).requiredPercent > 100);
  assert.equal(neededGrade(items, weights, "homework", 87).requiredPercent, null);
  assert.equal(neededGrade(items, [], "midterm", 87).requiredPercent, null);
});

test("syllabus weight evidence must be exact and cannot total over 100%", () => {
  const text = "Homework: 60%\nExams: 40%\nMaybe attendance matters.";
  assert.deepEqual(weightsFromText(text).map(({ category, weight }) => ({ category, weight })), weights);
  assert.deepEqual(proposedWeights([{ category: "Attendance", weight: 10, sourceText: "Attendance: 10%" }], text), []);
  assert.deepEqual(proposedWeights([
    { category: "Homework", weight: 70, sourceText: "Homework: 60%" },
    { category: "Exams", weight: 40, sourceText: "Exams: 40%" },
  ], text), [{ category: "Exams", weight: 40, sourceText: "Exams: 40%" }]);
});

test("a school scale must have unambiguous cutoffs and a 0% floor", () => {
  assert.equal(validScale([{ letter: "A", minPercent: 90 }, { letter: "F", minPercent: 0 }]), true);
  assert.equal(validScale([{ letter: "A", minPercent: 90 }, { letter: "A", minPercent: 0 }]), false);
  assert.equal(validScale([{ letter: "A", minPercent: 90 }, { letter: "F", minPercent: 50 }]), false);
});