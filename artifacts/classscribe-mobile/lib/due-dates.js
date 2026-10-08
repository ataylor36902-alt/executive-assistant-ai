// New records use dateConfirmed. Legacy mobile records used dueConfirmed or dueSource.
// Explicitly false canonical confirmation always wins over older fields.
export function isConfirmedDue(assignment) {
  if (!assignment?.due) return false;
  if (assignment.dateConfirmed != null) return assignment.dateConfirmed === true;
  return assignment.dueConfirmed === true || assignment.dueSource === 'manual';
}

export function isConfirmedDeadlineAlert(assignment, courseIds, daysUntil, maxDays = 10) {
  if (!courseIds.has(assignment.courseId) || assignment.done || !isConfirmedDue(assignment)) return false;
  const days = daysUntil(assignment.due);
  return Number.isFinite(days) && days >= 0 && days <= maxDays;
}