/** Compare instants, not calendar days; the deadline itself is still on time. */
export function absentGradebookStatus(dueAt: Date | null, now: number) {
  if (dueAt === null) return "no_deadline" as const;
  return dueAt.getTime() < now ? "missing" as const : "not_submitted" as const;
}
