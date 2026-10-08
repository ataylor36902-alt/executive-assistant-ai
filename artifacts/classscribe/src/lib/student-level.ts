export const STUDENT_LEVELS = ["High School", "College", "Graduate", "Medical", "Law"] as const;

export type StudentLevel = typeof STUDENT_LEVELS[number];

export function getStudentLevel(metadata: Record<string, unknown> | undefined): StudentLevel {
  const value = metadata?.studentLevel;
  return STUDENT_LEVELS.find(level => level === value) ?? "College";
}