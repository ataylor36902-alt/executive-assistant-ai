import { useState } from "react";
import { Calendar, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useStudyPlans } from "@/hooks/useStudyPlans";
import { useListSyllabusAssignments, useListSyllabusModules } from "@workspace/api-client-react";
import { SyllabusAssignments } from "@/components/SyllabusAssignments";

export default function Plans() {
  const { tasks, loading, error, busy, add, toggle, deleteTask } = useStudyPlans();
  const { data: coursework, isLoading: courseworkLoading, isError: courseworkError } = useListSyllabusAssignments();
  const { data: modules, isLoading: modulesLoading, isError: modulesError } = useListSyllabusModules();
  const [newTask, setNewTask] = useState("");
  const [actionError, setActionError] = useState("");
  const perform = async (action: () => Promise<void>) => {
    setActionError("");
    try { await action(); } catch { setActionError("Could not save your change. Please try again."); }
  };
  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    await perform(async () => { await add(newTask.trim()); setNewTask(""); });
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto flex flex-col h-full space-y-8">
      <header>
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2 flex items-center gap-3">
          <Calendar className="w-8 h-8 text-primary" /> Plans
        </h1>
        <p className="text-muted-foreground text-lg">
          Personal study tasks, synced across your devices.
        </p>
      </header>

      <Card className="border-border shadow-sm">
        <CardContent className="p-6 space-y-6">
          <form onSubmit={addTask} className="flex gap-3">
            <Input 
              placeholder="e.g. Review biology definitions chapter 4..." 
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              className="flex-1"
              maxLength={500}
            />
            <Button type="submit" disabled={!newTask.trim() || loading || busy}>
              <Plus className="w-4 h-4 mr-2" /> Add Plan
            </Button>
          </form>

          {(error || actionError) && <p role="alert" className="text-destructive text-sm">{error || actionError}</p>}
          {loading ? <p className="text-muted-foreground">Loading plans…</p> : error ? null : tasks.length > 0 ? (
            <div className="space-y-3">
              {tasks.map((task) => (
                <div key={task.id} className={`flex items-center justify-between p-3 rounded-lg border transition-all ${task.completed ? 'bg-muted/50 border-transparent' : 'bg-background border-border hover:border-primary/30'}`}>
                  <button 
                    onClick={() => void perform(() => toggle(task.id, !task.completed))}
                    disabled={busy}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    {task.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
                    <span className={`text-sm md:text-base ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                      {task.text}
                    </span>
                  </button>
                  <Button variant="ghost" size="icon" disabled={busy} aria-label="Delete plan" onClick={() => void perform(() => deleteTask(task.id))} className="text-muted-foreground hover:text-destructive shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 text-muted-foreground border border-dashed rounded-xl bg-muted/10">
              No plans yet. Add a study task to get started!
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="border-border shadow-sm">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-xl font-serif font-bold">Course modules</h2>
            <p className="text-sm text-muted-foreground">Confirmed units from your imported syllabi, in course order.</p>
          </div>
          {modulesLoading ? <p className="text-sm text-muted-foreground">Loading modules…</p> :
            modulesError ? <p role="alert" className="text-sm text-destructive">Could not load modules. Please try again.</p> :
              modules?.length ? <div className="space-y-3">{Array.from(new Set(modules.map(m => m.courseId))).map(courseId => (
                <div key={courseId} className="border rounded-lg p-3">
                  <h3 className="font-medium">{modules.find(m => m.courseId === courseId)?.courseName}</h3>
                  <ol className="list-decimal pl-5 text-sm text-muted-foreground">
                    {modules.filter(m => m.courseId === courseId).map(m => <li key={m.id}>{m.title}</li>)}
                  </ol>
                </div>
              ))}</div> : <p className="text-sm text-muted-foreground">No confirmed modules yet.</p>}
        </CardContent>
      </Card>
      <Card className="border-border shadow-sm">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-xl font-serif font-bold">Coursework from syllabi</h2>
            <p className="text-sm text-muted-foreground">Check off confirmed homework, readings, quizzes, exams and projects. Your progress is private to you.</p>
          </div>
          {courseworkLoading ? <p className="text-sm text-muted-foreground">Loading coursework…</p> :
            courseworkError ? <p role="alert" className="text-sm text-destructive">Could not load coursework. Please try again.</p> :
              <SyllabusAssignments items={coursework ?? []} showCourse />}
        </CardContent>
      </Card>
    </div>
  );
}
