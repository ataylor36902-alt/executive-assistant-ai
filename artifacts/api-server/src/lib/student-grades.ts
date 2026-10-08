import type {
  StudentGradeAnalysis,
  StudentGradeAnalysisType,
  StudentGradebook,
  StudentGradeItem,
  StudentGradeListResponse,
} from "@workspace/api-zod";

export const STUDENT_GRADE_TYPES = ["assignment", "project", "quiz", "test"] as const;

const gradeScale = [
  { min: 93, letter: "A", points: 4 },
  { min: 90, letter: "A-", points: 3.7 },
  { min: 87, letter: "B+", points: 3.3 },
  { min: 83, letter: "B", points: 3 },
  { min: 80, letter: "B-", points: 2.7 },
  { min: 77, letter: "C+", points: 2.3 },
  { min: 73, letter: "C", points: 2 },
  { min: 70, letter: "C-", points: 1.7 },
  { min: 67, letter: "D+", points: 1.3 },
  { min: 63, letter: "D", points: 1 },
  { min: 60, letter: "D-", points: 0.7 },
  { min: 0, letter: "F", points: 0 },
] as const;

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

function enteredItems(items: StudentGradeItem[]): Array<StudentGradeItem & { earned: number }> {
  return items.filter((item): item is StudentGradeItem & { earned: number } => item.earned !== null);
}

export function calculateStudentGradeAverage(gradebook: StudentGradebook): number | null {
  const entered = enteredItems(gradebook.items);
  if (!entered.length) return null;
  if (!gradebook.weights) {
    const earned = entered.reduce((sum, item) => sum + item.earned, 0);
    const possible = entered.reduce((sum, item) => sum + item.possible, 0);
    return possible > 0 ? round(earned / possible * 100) : null;
  }

  let weightedPercent = 0;
  let countedWeight = 0;
  for (const type of STUDENT_GRADE_TYPES) {
    const weight = gradebook.weights[type];
    if (weight === 0) continue;
    const average = categoryAverage(entered, type);
    if (average === null) continue;
    weightedPercent += average * weight;
    countedWeight += weight;
  }
  return countedWeight > 0 ? round(weightedPercent / countedWeight) : null;
}

function categoryAverage(
  items: Array<StudentGradeItem & { earned: number }>,
  type: StudentGradeItem["type"],
): number | null {
  const typed = items.filter((item) => item.type === type);
  if (!typed.length) return null;
  const earned = typed.reduce((sum, item) => sum + item.earned, 0);
  const possible = typed.reduce((sum, item) => sum + item.possible, 0);
  return possible > 0 ? round(earned / possible * 100) : null;
}

function gradeFor(percent: number | null): { letter: string | null; points: number | null } {
  if (percent === null) return { letter: null, points: null };
  const grade = gradeScale.find((entry) => percent >= entry.min);
  return grade ? { letter: grade.letter, points: grade.points } : { letter: "F", points: 0 };
}

export function analyzeStudentGradebook(gradebook: StudentGradebook): StudentGradeAnalysis {
  const entered = enteredItems(gradebook.items);
  const averagePercent = gradebook.finalPercent ?? calculateStudentGradeAverage(gradebook);
  const grade = gradeFor(averagePercent);
  const byType: StudentGradeAnalysisType[] = STUDENT_GRADE_TYPES.map((type) => ({
    type,
    averagePercent: categoryAverage(entered, type),
  }));
  return {
    averagePercent,
    letter: grade.letter,
    gradePoints: grade.points,
    byType,
    // These are calculations from student-entered data, never an official grade.
    isEstimate: true,
  };
}

export function summarizeStudentGrades(
  courses: StudentGradeListResponse["courses"],
): StudentGradeListResponse["summary"] {
  let countedCredits = 0;
  let weightedGradePoints = 0;
  for (const course of courses) {
    const points = course.analysis.gradePoints;
    if (points === null || course.gradebook.credits === 0) continue;
    countedCredits += course.gradebook.credits;
    weightedGradePoints += points * course.gradebook.credits;
  }
  return {
    estimatedGpa: countedCredits > 0 ? round(weightedGradePoints / countedCredits, 2) : null,
    countedCredits: round(countedCredits),
  };
}
