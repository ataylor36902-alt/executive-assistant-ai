import { useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSyllabusQueryKey,
  getListSyllabusAssignmentsQueryKey,
  useSetSyllabusAssignmentCompletion,
  type SyllabusAssignment,
  type Syllabus,
  type SyllabusAssignmentWithCourse,
} from "@workspace/api-client-react";

export function SyllabusAssignments({ items, showCourse = false }: {
  items: (SyllabusAssignment & { courseName?: string })[];
  showCourse?: boolean;
}) {
  const client = useQueryClient();
  const completion = useSetSyllabusAssignmentCompletion();
  const [error, setError] = useState("");
  const toggle = async (item: SyllabusAssignment) => {
    setError("");
    try {
      await completion.mutateAsync({ id: item.id, data: { completed: !item.completed } });
      client.setQueryData<SyllabusAssignmentWithCourse[]>(getListSyllabusAssignmentsQueryKey(), old =>
        old?.map(a => a.id === item.id ? { ...a, completed: !item.completed } : a));
      client.setQueryData<Syllabus>(getGetSyllabusQueryKey(item.courseId), old =>
        old ? { ...old, assignments: old.assignments.map(a => a.id === item.id ? { ...a, completed: !item.completed } : a) } : old);
      void client.invalidateQueries({ queryKey: getListSyllabusAssignmentsQueryKey() });
      void client.invalidateQueries({ queryKey: getGetSyllabusQueryKey(item.courseId) });
    } catch {
      setError("Could not save your coursework progress. Please try again.");
    }
  };
  if (!items.length) return <p className="text-sm text-muted-foreground">No confirmed coursework yet.</p>;
  return (
    <div className="space-y-2">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {items.map(item => (
        <div key={item.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
          <button
            type="button"
            disabled={completion.isPending}
            onClick={() => void toggle(item)}
            aria-label={`${item.completed ? "Mark incomplete" : "Mark complete"}: ${item.title}`}
            aria-pressed={item.completed}
            className="shrink-0 mt-0.5 text-primary disabled:opacity-50"
          >
            {item.completed ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5" />}
          </button>
          <span className="flex-1 min-w-0">
            <span className={`block font-medium ${item.completed ? "line-through text-muted-foreground" : ""}`}>{item.title}</span>
            <span className="text-xs text-muted-foreground">
              {showCourse && item.courseName ? `${item.courseName} · ` : ""}
              <span className="capitalize">{item.type}</span>
              {item.dueDate ? ` · Due ${item.dueDate}` : " · No confirmed date"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}