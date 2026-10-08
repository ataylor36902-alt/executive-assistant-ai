import { useState } from "react";
import { Calendar, Plus, Trash2, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useStudyPlans } from "@/hooks/useStudyPlans";

export function PlansWidget() {
  const { tasks, loading, error, busy, add, toggle, deleteTask } = useStudyPlans();
  const [newTask, setNewTask] = useState("");
  const [actionError, setActionError] = useState("");
  const perform = async (action: () => Promise<void>) => {
    setActionError("");
    try { await action(); } catch { setActionError("Could not save your change. Try again."); }
  };
  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    await perform(async () => { await add(newTask.trim()); setNewTask(""); });
  };

  return (
    <Card className="border-border shadow-sm flex flex-col h-full">
      <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
        <CardTitle className="text-lg font-serif font-bold flex justify-between items-center">
          <span className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" /> Study Plans
          </span>
          <span className="text-[10px] font-mono font-bold tracking-tight bg-muted-foreground/20 text-muted-foreground px-2 py-0.5 rounded uppercase">
            Synced
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex-1 flex flex-col overflow-hidden">
        <form onSubmit={addTask} className="flex gap-2 mb-4">
          <Input 
            placeholder="Add task..." 
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
             maxLength={500}
            className="flex-1 h-9"
          />
          <Button type="submit" disabled={!newTask.trim() || loading || busy} size="sm" className="h-9">
            <Plus className="w-4 h-4" />
          </Button>
        </form>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {(error || actionError) && <p role="alert" className="text-destructive text-sm">{error || actionError}</p>}
          {loading ? <p className="text-muted-foreground text-sm">Loading plans…</p> : error ? null : tasks.length > 0 ? (
            tasks.map((task) => (
              <div key={task.id} className={`flex items-start justify-between p-2.5 rounded-lg border transition-all ${task.completed ? 'bg-muted/30 border-transparent' : 'bg-background border-border hover:border-primary/30'}`}>
                <button 
                  onClick={() => void perform(() => toggle(task.id, !task.completed))}
                  disabled={busy}
                  className="flex items-start gap-2.5 flex-1 text-left"
                  type="button"
                >
                  {task.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <span className={`text-sm ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {task.text}
                  </span>
                </button>
                <Button variant="ghost" size="icon" disabled={busy} aria-label="Delete plan" onClick={() => void perform(() => deleteTask(task.id))} className="w-6 h-6 text-muted-foreground hover:text-destructive shrink-0 ml-2">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm border border-dashed rounded-xl bg-muted/10 h-full flex flex-col items-center justify-center">
              No plans yet. Add a study task!
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
