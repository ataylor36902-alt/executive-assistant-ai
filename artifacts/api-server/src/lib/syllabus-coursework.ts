import { and, eq, inArray } from "drizzle-orm";
import { db, syllabusAssignmentCompletionsTable, syllabusAssignmentsTable } from "@workspace/db";

export async function personalAssignments(assignments: (typeof syllabusAssignmentsTable.$inferSelect)[], userId: string) {
  if (!assignments.length) return [];
  const completions = await db.select({ assignmentId: syllabusAssignmentCompletionsTable.assignmentId })
    .from(syllabusAssignmentCompletionsTable)
    .where(and(
      eq(syllabusAssignmentCompletionsTable.userId, userId),
      inArray(syllabusAssignmentCompletionsTable.assignmentId, assignments.map(a => a.id)),
    ));
  const completed = new Set(completions.map(c => c.assignmentId));
  return assignments.map(a => ({ ...a, completed: completed.has(a.id) }));
}

export const syllabusTitleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLowerCase();

// A date remains confirmed on its own even when it cannot identify exactly one
// coursework item. Compare the stored due date too: a matching title alone does
// not establish that a coursework due date was actually set.
export function syllabusDateLinks<
  D extends { title: string; dueDate: string },
  A extends { title: string; dueDate: string | null },
>(dates: D[], assignments: A[]): (D & { linkStatus: "linked" | "ambiguous" | "standalone" })[] {
  const dateCounts = new Map<string, number>();
  const assignmentGroups = new Map<string, A[]>();
  for (const date of dates) {
    const key = syllabusTitleKey(date.title);
    dateCounts.set(key, (dateCounts.get(key) ?? 0) + 1);
  }
  for (const assignment of assignments) {
    const key = syllabusTitleKey(assignment.title);
    assignmentGroups.set(key, [...(assignmentGroups.get(key) ?? []), assignment]);
  }
  return dates.map(date => {
    const key = syllabusTitleKey(date.title);
    const matches = assignmentGroups.get(key) ?? [];
    const linkStatus = matches.length && (matches.length > 1 || (dateCounts.get(key) ?? 0) > 1)
      ? "ambiguous"
      : matches.length === 1 && matches[0].dueDate === date.dueDate
        ? "linked" : "standalone";
    return { ...date, linkStatus };
  });
}

// Preserve identity when an item has a unique type/title match. For repeated titles,
// only an unambiguous due date match can identify the same coursework.
export function matchCoursework(
  old: (typeof syllabusAssignmentsTable.$inferSelect)[],
  incoming: { title: string; type: string; dueDate: string | null }[],
) {
  const key = (title: string, type: string) => `${type}\0${title.trim().replace(/\s+/g, " ").toLowerCase()}`;
  const oldGroups = new Map<string, typeof old>();
  const newGroups = new Map<string, number[]>();
  old.forEach(item => oldGroups.set(key(item.title, item.type), [...(oldGroups.get(key(item.title, item.type)) ?? []), item]));
  incoming.forEach((item, i) => newGroups.set(key(item.title, item.type), [...(newGroups.get(key(item.title, item.type)) ?? []), i]));
  const matches = new Map<number, string>();
  for (const [group, newIndices] of newGroups) {
    const candidates = oldGroups.get(group) ?? [];
    if (candidates.length === 1 && newIndices.length === 1) {
      matches.set(newIndices[0], candidates[0].id);
    } else {
      for (const i of newIndices) {
        const dueDate = incoming[i].dueDate;
        if (!dueDate) continue;
        const sameDateOld = candidates.filter(c => c.dueDate === dueDate);
        const sameDateNew = newIndices.filter(n => incoming[n].dueDate === dueDate);
        if (sameDateOld.length === 1 && sameDateNew.length === 1) matches.set(i, sameDateOld[0].id);
      }
    }
  }
  return matches;
}