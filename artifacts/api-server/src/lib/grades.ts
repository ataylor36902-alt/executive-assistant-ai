import type { GradeItem, GradeScaleEntry, GradeWeight } from "@workspace/db";

export const defaultScale: GradeScaleEntry[] = [
  { letter: "A", minPercent: 93, points: 4 },
  { letter: "A-", minPercent: 90, points: 3.7 },
  { letter: "B+", minPercent: 87, points: 3.3 },
  { letter: "B", minPercent: 83, points: 3 },
  { letter: "B-", minPercent: 80, points: 2.7 },
  { letter: "C+", minPercent: 77, points: 2.3 },
  { letter: "C", minPercent: 73, points: 2 },
  { letter: "C-", minPercent: 70, points: 1.7 },
  { letter: "D+", minPercent: 67, points: 1.3 },
  { letter: "D", minPercent: 63, points: 1 },
  { letter: "D-", minPercent: 60, points: 0.7 },
  { letter: "F", minPercent: 0, points: 0 },
];

export function validScale(entries: GradeScaleEntry[]) {
  const labels = entries.map(entry => entry.letter.trim());
  return labels.every(Boolean) && new Set(labels).size === labels.length &&
    new Set(entries.map(entry => entry.minPercent)).size === entries.length &&
    entries.some(entry => entry.minPercent === 0);
}

export function letterFor(percent: number | null, scale: GradeScaleEntry[]): string | null {
  if (percent === null) return null;
  return [...scale].sort((a, b) => b.minPercent - a.minPercent)
    .find(entry => percent >= entry.minPercent)?.letter ?? null;
}

export function currentGrade(items: GradeItem[], weights: GradeWeight[]): number | null {
  if (!weights.length || Math.abs(weights.reduce((sum, row) => sum + row.weight, 0) - 100) > 0.01) return null;
  let earned = 0;
  let completedWeight = 0;
  for (const { category, weight } of weights) {
    if (!weight) continue;
    const scores = items.filter(item => !item.archived && item.category === category && item.scorePercent !== null)
      .map(item => item.scorePercent as number);
    if (!scores.length) continue;
    earned += weight * (scores.reduce((sum, score) => sum + score, 0) / scores.length);
    completedWeight += weight;
  }
  return completedWeight ? Math.round(earned / completedWeight * 10) / 10 : null;
}

export function neededGrade(items: GradeItem[], weights: GradeWeight[], itemId: string, threshold: number) {
  const item = items.find(row => row.id === itemId);
  if (!item) return { requiredPercent: null, message: "Choose an assignment or exam in the course gradebook." };
  if (item.archived) return { requiredPercent: null, message: "This item is no longer in the current syllabus. Review it in the Grades tab first." };
  if (item.scorePercent !== null) return { requiredPercent: null, message: "This item already has a score. Clear it first to try a target." };
  if (!weights.length || Math.abs(weights.reduce((sum, row) => sum + row.weight, 0) - 100) > 0.01) {
    return { requiredPercent: null, message: "Set category weights to a total of 100% in the course Grades tab first." };
  }
  const targetWeight = weights.find(row => row.category === item.category)?.weight ?? 0;
  if (!targetWeight) return { requiredPercent: null, message: "Give this item's category a nonzero weight in the course Grades tab first." };
  let earnedOther = 0;
  let countedWeight = targetWeight;
  for (const { category, weight } of weights) {
    if (!weight || category === item.category) continue;
    const scores = items.filter(row => !row.archived && row.category === category && row.scorePercent !== null)
      .map(row => row.scorePercent as number);
    if (!scores.length) continue;
    earnedOther += weight * scores.reduce((sum, score) => sum + score, 0) / scores.length;
    countedWeight += weight;
  }
  const existing = items.filter(row => !row.archived && row.category === item.category && row.scorePercent !== null)
    .map(row => row.scorePercent as number);
  const sum = existing.reduce((total, score) => total + score, 0);
  const required = (threshold * countedWeight - earnedOther) * (existing.length + 1) / targetWeight - sum;
  const requiredPercent = Math.round(required * 10) / 10;
  if (requiredPercent > 100) return { requiredPercent, message: "Even 100% on this item would not reach that target with the graded work counted here." };
  if (requiredPercent <= 0) return { requiredPercent: 0, message: "Based on graded work and this item alone, the target is already met." };
  return { requiredPercent, message: `You need ${requiredPercent}% on ${item.title} to reach this target based on graded work so far.` };
}

type SourceWeight = GradeWeight & { sourceText: string };
export function proposedWeights(input: unknown, text: string): SourceWeight[] {
  if (!Array.isArray(input)) return [];
  const rows: SourceWeight[] = [];
  for (const raw of input) {
    if (!raw || typeof raw.category !== "string" || typeof raw.weight !== "number" ||
        typeof raw.sourceText !== "string" || !Number.isFinite(raw.weight) ||
        raw.weight < 0 || raw.weight > 100 || !text.includes(raw.sourceText.trim()) ||
        !raw.sourceText.trim() || !raw.category.trim()) continue;
    const category = raw.category.trim().slice(0, 80);
    const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const evidence = raw.sourceText.trim().match(new RegExp(`(?:^|[^A-Za-z])${escaped}[^\\d%]{0,32}(\\d{1,3}(?:\\.\\d+)?)\\s*%`, "i"));
    if (!evidence || Math.abs(Number(evidence[1]) - raw.weight) > 0.001) continue;
    if (rows.some(row => row.category.toLowerCase() === category.toLowerCase())) continue;
    rows.push({ category, weight: raw.weight, sourceText: raw.sourceText.trim().slice(0, 500) });
  }
  return rows.length <= 30 && rows.reduce((sum, row) => sum + row.weight, 0) <= 100.01 ? rows : [];
}

// For syllabi imported before grade-weight extraction was introduced. Never infer a
// policy from a loose percentage in prose: only a labeled category on one line.
export function weightsFromText(text: string): SourceWeight[] {
  const matches = text.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^([A-Za-z][A-Za-z /&-]{2,45})\s*[:\t–-]\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$/);
    return match ? [{ category: match[1].trim(), weight: Number(match[2]), sourceText: line.trim() }] : [];
  });
  const result = proposedWeights(matches, text);
  return Math.abs(result.reduce((sum, row) => sum + row.weight, 0) - 100) < 0.01 ? result : [];
}

export function categoryFor(type: string, title: string, weights: GradeWeight[]) {
  const name = title.toLowerCase();
  const candidates = type === "exam" ? ["midterm", "final", "exam", "test"] :
    type === "quiz" ? ["quiz"] : type === "project" ? ["project", "lab"] :
      type === "reading" ? ["reading", "participation"] : ["homework", "assignment"];
  const matching = weights.find(row =>
    candidates.some(word => row.category.toLowerCase().includes(word) &&
      (word !== "midterm" && word !== "final" || name.includes(word))));
  return matching?.category ?? ({ exam: "Exams", quiz: "Quizzes", project: "Projects", reading: "Readings" }[type] ?? "Homework");
}