import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCourseGradesQueryKey, getGetGradesOverviewQueryKey, useGetCourseGrades, useUpdateCourseGrades } from "@workspace/api-client-react";
import type { GradeItem, GradeWeight } from "@workspace/api-client-react";
import { AlertCircle, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type GradeDraft = {
  creditHours: number | null;
  finalLetter: string;
  weights: GradeWeight[];
  items: GradeItem[];
};

export function CourseGradesPanel({ courseId }: { courseId: string }) {
  const queryClient = useQueryClient();
  const gradesQuery = useGetCourseGrades(courseId);
  const saveGrades = useUpdateCourseGrades();
  const [draft, setDraft] = useState<GradeDraft | null>(null);
  const [saveError, setSaveError] = useState("");
  const [importedWeightsUpdated, setImportedWeightsUpdated] = useState(false);
  const [weightsReviewChecked, setWeightsReviewChecked] = useState(false);
  const lastServerWeights = useRef<string | null>(null);

  useEffect(() => {
    const incoming = gradesQuery.data;
    if (!incoming) return;
    const incomingWeights = JSON.stringify(incoming.weights);
    const weightsChangedSinceLastFetch = lastServerWeights.current !== null && lastServerWeights.current !== incomingWeights;
    lastServerWeights.current = incomingWeights;
    if (weightsChangedSinceLastFetch && incoming.needsWeightReview) {
      setImportedWeightsUpdated(true);
      setWeightsReviewChecked(false);
    }
    setDraft(existing => {
      if (!existing) {
        return {
          creditHours: incoming.creditHours,
          finalLetter: incoming.finalLetter ?? "",
          weights: incoming.weights.map(weight => ({ ...weight })),
          items: incoming.items.map(item => ({ ...item })),
        };
      }

      // Refetches (such as after syllabus replacement) must not overwrite score edits.
      // Reconcile newly archived syllabus records into the draft while preserving the
      // draft item values, especially scorePercent.
      let changed = false;
      const incomingById = new Map(incoming.items.map(item => [item.id, item]));
      const mergedItems = existing.items.map(item => {
        const serverItem = incomingById.get(item.id);
        if (!serverItem || item.source !== "syllabus" || Boolean(item.archived) === Boolean(serverItem.archived)) return item;
        changed = true;
        return { ...item, archived: serverItem.archived };
      });
      const existingIds = new Set(existing.items.map(item => item.id));
      const newlyReceived = incoming.items.filter(item => !existingIds.has(item.id));
      if (newlyReceived.length) changed = true;
      const weights = weightsChangedSinceLastFetch && incoming.needsWeightReview
        ? incoming.weights.map(weight => ({ ...weight }))
        : existing.weights;
      if (!changed && weights === existing.weights) return existing;

      return { ...existing, weights, items: [...mergedItems, ...newlyReceived.map(item => ({ ...item }))] };
    });
  }, [gradesQuery.data]);

  const weightsTotal = useMemo(() => draft?.weights.reduce((total, item) => total + (Number(item.weight) || 0), 0) ?? 0, [draft]);

  const updateItem = (id: string, changes: Partial<GradeItem>) => {
    setDraft(current => current ? ({
      ...current,
      items: current.items.map(item => item.id === id ? { ...item, ...changes } : item),
    }) : current);
  };

  const save = () => {
    if (!draft) return;
    setSaveError("");
    if (draft.creditHours !== null && (!Number.isFinite(draft.creditHours) || draft.creditHours < 0 || draft.creditHours > 30)) {
      setSaveError("Credit hours must be between 0 and 30.");
      return;
    }
    if (draft.weights.some(weight => !weight.category.trim() || !Number.isFinite(Number(weight.weight)) || Number(weight.weight) < 0 || Number(weight.weight) > 100)) {
      setSaveError("Each category needs a name and a weight from 0 to 100%.");
      return;
    }
    if (new Set(draft.weights.map(weight => weight.category.trim().toLowerCase())).size !== draft.weights.length) {
      setSaveError("Category names must be unique.");
      return;
    }
    if (draft.items.some(item => !item.title.trim() || !item.category.trim() || (item.scorePercent !== null && (!Number.isFinite(Number(item.scorePercent)) || Number(item.scorePercent) < 0 || Number(item.scorePercent) > 100)))) {
      setSaveError("Each assignment needs a title and category. Scores must be between 0 and 100%.");
      return;
    }
    saveGrades.mutate({
      id: courseId,
      data: {
        creditHours: draft.creditHours,
        finalLetter: draft.finalLetter.trim() || null,
        weights: draft.weights.map(weight => ({ category: weight.category.trim(), weight: Number(weight.weight) })),
        items: draft.items.map(item => ({ ...item, scorePercent: item.scorePercent === null ? null : Number(item.scorePercent) })),
      },
    }, {
      onSuccess: async (saved) => {
        setImportedWeightsUpdated(false);
        setWeightsReviewChecked(false);
        setDraft({
          creditHours: saved.creditHours,
          finalLetter: saved.finalLetter ?? "",
          weights: saved.weights.map(weight => ({ ...weight })),
          items: saved.items.map(item => ({ ...item })),
        });
        queryClient.setQueryData(getGetCourseGradesQueryKey(courseId), saved);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetCourseGradesQueryKey(courseId) }),
          queryClient.invalidateQueries({ queryKey: getGetGradesOverviewQueryKey() }),
        ]);
      },
      onError: (error) => setSaveError(error instanceof Error ? error.message : "Could not save grades. Please try again."),
    });
  };

  const addWeight = () => setDraft(current => current ? ({
    ...current,
    weights: [...current.weights, { category: "", weight: 0 }],
  }) : current);

  const addManualItem = () => setDraft(current => current ? ({
    ...current,
    items: [...current.items, {
      id: `manual-${crypto.randomUUID()}`,
      title: "",
      category: current.weights[0]?.category || "",
      type: "assignment",
      source: "manual",
      scorePercent: null,
    }],
  }) : current);

  const removeArchivedItem = (item: GradeItem) => {
    if (!window.confirm(`Remove "${item.title}" from your gradebook? Its saved score will be discarded.`)) return;
    setDraft(current => current ? { ...current, items: current.items.filter(entry => entry.id !== item.id) } : current);
  };

  if (gradesQuery.isError) {
    return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Could not load this course gradebook. Refresh the page to try again.</div>;
  }
  if (gradesQuery.isLoading || !gradesQuery.data || !draft) {
    return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-56 w-full" /></div>;
  }

  const current = gradesQuery.data;
  const activeItems = draft.items.filter(item => !item.archived);
  const archivedItems = draft.items.filter(item => item.archived);
  return (
    <div className="space-y-6">
      {current.needsWeightReview && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border-2 border-amber-500/50 bg-amber-500/10 p-4 text-amber-950 dark:text-amber-100">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Imported syllabus weights are unconfirmed</p>
            <p className="mt-1 text-sm">Check the imported category weights below. Select “Confirm imported weights &amp; save grades” to confirm them. A current grade estimate will not be shown until this is saved.</p>
            {importedWeightsUpdated && <p className="mt-1 text-sm font-medium">A newer syllabus import changed the weights while this page was open. The new imported weights are shown; your assignment scores were preserved. Please review them before saving.</p>}
          </div>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Current course standing</CardTitle>
          <CardDescription>Provisional estimate from entered scores and category weights—not an official or final grade.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <div className="rounded-lg bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">Estimated current grade</p>
            <p className="mt-1 text-2xl font-semibold">{current.needsWeightReview ? "Review required" : current.currentPercent == null ? "Not available" : `${current.currentPercent.toFixed(1)}%`}</p>
            <p className="text-sm text-muted-foreground">{current.needsWeightReview ? "Estimate hidden until weights are confirmed" : current.currentLetter ? `Provisional ${current.currentLetter}` : "Add weights and scores for an estimate"}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grade-credit-hours">Credit hours</Label>
            <Input id="grade-credit-hours" type="number" min="0" max="30" step="0.5" value={draft.creditHours ?? ""} onChange={event => setDraft({ ...draft, creditHours: event.target.value === "" ? null : Number(event.target.value) })} placeholder="e.g. 3" />
            <p className="text-xs text-muted-foreground">Used for term GPA projections.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="grade-final-letter">Final letter grade (optional)</Label>
            <Input id="grade-final-letter" value={draft.finalLetter} onChange={event => setDraft({ ...draft, finalLetter: event.target.value.toUpperCase() })} placeholder="e.g. A-" maxLength={12} />
            <p className="text-xs text-muted-foreground">Enter only when you know your final course grade.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Category weights</CardTitle>
            <CardDescription>Set the syllabus grading breakdown. Weights should total 100%.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={addWeight}><Plus className="mr-1.5 h-4 w-4" /> Add category</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.weights.length === 0 && <p className="text-sm text-muted-foreground">No grading weights have been set.</p>}
          {draft.weights.map((weight, index) => (
            <div key={`${index}-${weight.category}`} className="grid grid-cols-[1fr_100px_40px] items-center gap-2">
              <Input aria-label={`Category ${index + 1}`} value={weight.category} maxLength={80} placeholder="Category name" onChange={event => {
                const category = event.target.value;
                setDraft({
                  ...draft,
                  weights: draft.weights.map((entry, i) => i === index ? { ...entry, category } : entry),
                  items: draft.items.map(item => item.category === weight.category ? { ...item, category } : item),
                });
              }} />
              <div className="relative">
                <Input aria-label={`${weight.category || "Category"} weight`} type="number" min="0" max="100" step="0.1" value={weight.weight} onChange={event => setDraft({ ...draft, weights: draft.weights.map((entry, i) => i === index ? { ...entry, weight: event.target.value === "" ? 0 : Number(event.target.value) } : entry) })} className="pr-7" />
                <span className="absolute right-2 top-2 text-sm text-muted-foreground">%</span>
              </div>
              <Button aria-label="Remove category" variant="ghost" size="icon" onClick={() => setDraft({ ...draft, weights: draft.weights.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${Math.abs(weightsTotal - 100) < 0.01 ? "bg-primary/5 text-primary" : "bg-amber-500/10 text-amber-800 dark:text-amber-300"}`}>
            {Math.abs(weightsTotal - 100) >= 0.01 && <AlertCircle className="h-4 w-4 shrink-0" />}
            Weights total {weightsTotal.toFixed(1)}%{Math.abs(weightsTotal - 100) >= 0.01 ? " — adjust to 100% for a complete projection." : " — complete."}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Assignments and exams</CardTitle>
            <CardDescription>Scores are percentages from 0 to 100. Leave an item blank until it is graded.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={addManualItem}><Plus className="mr-1.5 h-4 w-4" /> Add assignment</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeItems.length === 0 && <p className="text-sm text-muted-foreground">No active assignments yet. Add an assignment manually to track it.</p>}
          {activeItems.map(item => (
            <div key={item.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.8fr)_120px_auto] sm:items-center">
              <div className="space-y-1">
                <Input aria-label="Assignment title" value={item.title} maxLength={200} placeholder="Assignment name" onChange={event => updateItem(item.id, { title: event.target.value })} />
                <span className="text-xs text-muted-foreground">{item.source === "syllabus" ? "From syllabus" : "Manual"}{item.type ? ` · ${item.type}` : ""}</span>
              </div>
              <Input aria-label="Assignment category" list={`grade-categories-${courseId}`} value={item.category} placeholder="Category" onChange={event => updateItem(item.id, { category: event.target.value })} />
              <div className="relative">
                <Input aria-label={`Score for ${item.title}`} type="number" min="0" max="100" step="0.1" value={item.scorePercent ?? ""} placeholder="Ungraded" onChange={event => updateItem(item.id, { scorePercent: event.target.value === "" ? null : Number(event.target.value) })} className="pr-7" />
                <span className="absolute right-2 top-2 text-sm text-muted-foreground">%</span>
              </div>
              {item.source === "manual" ? <Button aria-label={`Remove ${item.title}`} variant="ghost" size="icon" onClick={() => setDraft({ ...draft, items: draft.items.filter(entry => entry.id !== item.id) })}><Trash2 className="h-4 w-4" /></Button> : <span className="hidden sm:block" />}
            </div>
          ))}
          <datalist id={`grade-categories-${courseId}`}>
            {draft.weights.filter(weight => weight.category.trim()).map((weight, index) => <option key={`${weight.category}-${index}`} value={weight.category} />)}
          </datalist>
        </CardContent>
      </Card>

      {archivedItems.length > 0 && (
        <Card className="border-muted-foreground/30 bg-muted/20">
          <CardHeader>
            <CardTitle>Removed from current syllabus — excluded from grade</CardTitle>
            <CardDescription>Archived syllabus items and their saved scores are retained here, but are excluded from current grade calculations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {archivedItems.map(item => (
              <div key={item.id} className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-muted-foreground">{item.category} · {item.type} · Saved score: {item.scorePercent == null ? "Ungraded" : `${item.scorePercent}%`}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => updateItem(item.id, { source: "manual", archived: false })}>
                    Keep as manual
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => removeArchivedItem(item)}>
                    Remove and discard score
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {saveError && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</div>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Changes stay here until you save. Saving updates your private course gradebook.</p>
          {current.needsWeightReview && (
            <label htmlFor="confirm-imported-weights" className="flex items-start gap-2 text-sm font-medium">
              <input id="confirm-imported-weights" type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={weightsReviewChecked} onChange={event => setWeightsReviewChecked(event.target.checked)} />
              I have reviewed these imported weights and confirm them.
            </label>
          )}
        </div>
        <Button onClick={save} disabled={saveGrades.isPending || (current.needsWeightReview && !weightsReviewChecked)} className="sm:min-w-36">
          {saveGrades.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {current.needsWeightReview ? "Confirm imported weights & save grades" : "Save grades"}
        </Button>
      </div>
    </div>
  );
}