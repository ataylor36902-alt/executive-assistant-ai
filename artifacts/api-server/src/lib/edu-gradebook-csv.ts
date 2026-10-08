type ExportGradebook = {
  assignments: Array<{ id: string; title: string; points: number }>;
  students: Array<{
    studentId: string;
    name: string;
    grades: Array<{ assignmentId: string; status: string; score: number | null }>;
    totals: { earned: number; possible: number; gradedCount: number; ungradedCount: number; missingCount: number };
  }>;
};

function cell(value: string | number | null): string {
  let text = value === null ? "" : String(value);
  // Quoting alone does not prevent spreadsheet formula execution.
  if (typeof value === "string" && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

/** One row per enrolled student, with the same graded-only totals as the browser. */
export function eduGradebookCsv(book: ExportGradebook): string {
  const headers = [
    "Student ID", "Student name",
    ...book.assignments.flatMap(a => [
      `${a.title} [${a.id}] points`, `${a.title} [${a.id}] score`, `${a.title} [${a.id}] status`,
    ]),
    "Graded points earned", "Graded points possible", "Graded assignments", "Ungraded assignments", "Missing assignments",
  ];
  const rows = book.students.map(student => {
    const grades = new Map(student.grades.map(grade => [grade.assignmentId, grade]));
    return [
      student.studentId, student.name,
      ...book.assignments.flatMap(assignment => {
        const grade = grades.get(assignment.id);
        return [assignment.points, grade?.score ?? null, grade?.status ?? "missing"];
      }),
      student.totals.earned, student.totals.possible, student.totals.gradedCount,
      student.totals.ungradedCount, student.totals.missingCount,
    ];
  });
  // UTF-8 BOM preserves names in spreadsheet applications; RFC 4180 quoting/CRLF.
  return "\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
