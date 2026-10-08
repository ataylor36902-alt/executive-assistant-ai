export function calendarDate(value: Date | string | null): string | null {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export function normalizeSyllabusPreview<
  D extends { dueDate: Date | string | null; sourceText: string },
  M extends { sourceText: string },
  A extends { dueDate: Date | string | null; sourceText: string },
>(parsed: { dates: D[]; modules: M[]; assignments: A[] }, text: string) {
  const quoted = (item: { sourceText: string }) => item.sourceText.length > 0 && text.includes(item.sourceText);
  return {
    dates: parsed.dates.filter(d => d.dueDate && quoted(d))
      .map(d => ({ ...d, dueDate: calendarDate(d.dueDate) })),
    modules: parsed.modules.filter(quoted),
    assignments: parsed.assignments.filter(quoted)
      .map(a => ({ ...a, dueDate: calendarDate(a.dueDate) })),
  };
}