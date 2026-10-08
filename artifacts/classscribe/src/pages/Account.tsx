import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetGradeScaleQueryKey, getGetGradesOverviewQueryKey, useGetGradeScale, useGetGradesOverview, useUpdateGradeScale } from "@workspace/api-client-react";
import type { GradeScaleEntry } from "@workspace/api-client-react";
import { AlertCircle, Loader2, Plus, Save, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getStudentLevel, STUDENT_LEVELS, type StudentLevel } from "@/lib/student-level";

const ALL_TERMS = "all";

export default function Account() {
  const { user } = useUser();
  const [levelSaving, setLevelSaving] = useState(false);
  const [levelError, setLevelError] = useState("");
  const [savedLevel, setSavedLevel] = useState<StudentLevel | null>(null);
  const studentLevel = savedLevel ?? getStudentLevel(user?.unsafeMetadata as Record<string, unknown> | undefined);
  const changeStudentLevel = async (level: StudentLevel) => {
    if (!user || levelSaving || level === studentLevel) return;
    setLevelError("");
    setLevelSaving(true);
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, studentLevel: level } });
      setSavedLevel(level);
    } catch {
      setLevelError("Could not save your student level. Please try again.");
    } finally {
      setLevelSaving(false);
    }
  };
  const queryClient = useQueryClient();
  const overviewQuery = useGetGradesOverview();
  const scaleQuery = useGetGradeScale();
  const updateScale = useUpdateGradeScale();
  const [term, setTerm] = useState(ALL_TERMS);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [scaleDraft, setScaleDraft] = useState<GradeScaleEntry[] | null>(null);
  const [scaleError, setScaleError] = useState("");

  useEffect(() => {
    if (scaleQuery.data && scaleDraft === null) setScaleDraft(scaleQuery.data.entries.map(entry => ({ ...entry })));
  }, [scaleQuery.data, scaleDraft]);

  const terms = useMemo(() => [...new Set((overviewQuery.data?.courses ?? []).map(course => course.term).filter(Boolean))], [overviewQuery.data]);
  const courses = useMemo(() => {
    const all = overviewQuery.data?.courses ?? [];
    return term === ALL_TERMS ? all : all.filter(course => course.term === term);
  }, [overviewQuery.data, term]);
  const scaleEntries = scaleQuery.data?.entries ?? overviewQuery.data?.scale.entries ?? [];

  const rows = courses.map(course => {
    const letter = overrides[course.courseId] || course.finalLetter || (course.needsWeightReview ? "" : course.currentLetter || "");
    const scaleEntry = scaleEntries.find(entry => entry.letter === letter);
    const isWhatIf = !!overrides[course.courseId];
    const isFinal = !isWhatIf && !!course.finalLetter;
    return { course, letter, points: scaleEntry?.points, isWhatIf, isFinal };
  });
  const weighted = rows.reduce((sum, row) => {
    if (row.course.creditHours == null || row.course.creditHours <= 0 || row.points == null) return sum;
    return { points: sum.points + row.points * row.course.creditHours, credits: sum.credits + row.course.creditHours };
  }, { points: 0, credits: 0 });
  const gpa = weighted.credits ? weighted.points / weighted.credits : null;
  const isEstimate = rows.some(row => !row.isFinal && !!row.letter);
  const allFinal = rows.length > 0 && rows.every(row => row.isFinal && row.course.creditHours != null && row.points != null);
  const hasUnconfirmedWeights = courses.some(course => course.needsWeightReview);

  const saveScale = () => {
    if (!scaleDraft) return;
    const normalized = scaleDraft.map(entry => ({ ...entry, letter: entry.letter.trim() }));
    const letters = normalized.map(entry => entry.letter.toLowerCase());
    if (normalized.length < 2 || normalized.some(entry => !entry.letter || !Number.isFinite(entry.minPercent) || entry.minPercent < 0 || entry.minPercent > 100 || !Number.isFinite(entry.points) || entry.points < 0 || entry.points > 5) || new Set(letters).size !== letters.length) {
      setScaleError("Add at least two entries. Letters must be unique, thresholds 0–100, and GPA points 0–5.");
      return;
    }
    setScaleError("");
    updateScale.mutate({ data: { entries: normalized } }, {
      onSuccess: async saved => {
        setScaleDraft(saved.entries.map(entry => ({ ...entry })));
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetGradeScaleQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetGradesOverviewQueryKey() }),
        ]);
      },
      onError: error => setScaleError(error instanceof Error ? error.message : "Could not save the grading scale. Please try again."),
    });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col space-y-8 p-6 md:p-10">
      <header>
        <h1 className="mb-2 flex items-center gap-3 font-serif text-3xl font-bold text-foreground md:text-4xl"><Settings2 className="h-8 w-8 text-primary" /> Account &amp; grades</h1>
        <p className="text-lg text-muted-foreground">Review your credit-weighted term GPA and personalize your school grading scale.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Your student level</CardTitle>
          <CardDescription>Choose where you are now. This appears on your <Link href="/plans" data-testid="link-account-plans" className="font-semibold text-primary underline underline-offset-2">ClassScribe plans</Link> page and is saved to your profile.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Student level">
            {STUDENT_LEVELS.map(level => (
              <button key={level} type="button" disabled={!user || levelSaving} onClick={() => void changeStudentLevel(level)} aria-pressed={studentLevel === level} data-testid={`button-level-${level.toLowerCase().replace(" ", "-")}`} className={`min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${studentLevel === level ? "border-[hsl(var(--plans-green))] bg-[hsl(var(--plans-green-soft))] text-[hsl(var(--plans-green-ink))]" : "border-border bg-card text-muted-foreground hover:border-[hsl(var(--plans-green))]"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
                {level}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground" aria-live="polite" data-testid="status-student-level">{levelSaving ? "Saving your level…" : `Current level: ${studentLevel}`}</p>
          {levelError && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="error-student-level">{levelError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Term GPA</CardTitle>
            <CardDescription>Courses with a known letter grade and credit hours contribute to the calculation.</CardDescription>
          </div>
          <div className="w-full space-y-2 sm:w-56">
            <Label htmlFor="gpa-term">Term</Label>
            <Select value={term} onValueChange={setTerm}>
              <SelectTrigger id="gpa-term"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TERMS}>All terms</SelectItem>
                {terms.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {overviewQuery.isError ? (
            <p role="alert" className="rounded-md bg-destructive/5 p-4 text-sm text-destructive">Could not load your grade overview. Refresh the page to try again.</p>
          ) : overviewQuery.isLoading ? <Skeleton className="h-24 w-full" /> : (
            <>
              <div className="mb-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-primary/5 p-4">
                  <p className="text-sm text-muted-foreground">{allFinal ? "Final term GPA" : isEstimate ? "Estimated term GPA" : "Term GPA (partial)"}</p>
                  <p className="mt-1 text-3xl font-semibold">{gpa == null ? "—" : gpa.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="text-sm text-muted-foreground">Credits included</p>
                  <p className="mt-1 text-2xl font-semibold">{weighted.credits || "—"}</p>
                </div>
                <div className="flex items-start gap-2 rounded-lg border p-4 text-sm text-muted-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {allFinal ? "Calculated from final course grades weighted by credit hours." : isEstimate ? "Estimate uses provisional course grades and/or what-if overrides; it is not an official GPA." : "Partial calculation: courses missing a grade, grading-scale match, or credit hours are excluded."}
                  {hasUnconfirmedWeights && <span className="mt-1 block">Provisional grades for courses with unconfirmed imported weights are excluded until reviewed and saved.</span>}
                </div>
              </div>
              {courses.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No courses found for this term.</p>
              ) : (
                <div className="space-y-3">
                  {rows.map(({ course, letter, points, isWhatIf, isFinal }) => (
                    <div key={course.courseId} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[minmax(0,1fr)_120px_150px_170px] md:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{course.courseName}</p>
                        <p className="text-sm text-muted-foreground">{course.term} · {course.creditHours == null ? "Credit hours not set" : `${course.creditHours} credits`}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Current / final</p>
                        <p className="font-medium">{course.finalLetter ? `Final ${course.finalLetter}` : course.needsWeightReview ? "Imported weights need review" : course.currentLetter ? `Provisional ${course.currentLetter}` : "No grade yet"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Contribution</p>
                        <p className="font-medium">{points == null ? "Not included" : `${letter} · ${points.toFixed(2)} pts`}</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground" htmlFor={`what-if-${course.courseId}`}>What-if letter override</Label>
                        <Select value={overrides[course.courseId] ?? "__course_default"} onValueChange={value => setOverrides(current => {
                          const next = { ...current };
                          if (value === "__course_default") delete next[course.courseId];
                          else next[course.courseId] = value;
                          return next;
                        })}>
                          <SelectTrigger id={`what-if-${course.courseId}`} aria-label={`What-if grade for ${course.courseName}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__course_default">Use {course.finalLetter ? "final" : course.currentLetter ? "provisional" : "no grade"}</SelectItem>
                            {scaleEntries.map(entry => <SelectItem key={entry.letter} value={entry.letter}>{entry.letter}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {isWhatIf && <p className="text-xs text-primary">What-if estimate · not saved</p>}
                        {!isWhatIf && !isFinal && !course.needsWeightReview && course.currentLetter && <p className="text-xs text-muted-foreground">Provisional estimate</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>School grading scale</CardTitle>
            <CardDescription>Set the minimum percentage and GPA points for each letter. What-if changes above are never saved.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setScaleDraft(current => [...(current ?? []), { letter: "", minPercent: 0, points: 0 }])} disabled={!scaleDraft || scaleDraft.length >= 20}><Plus className="mr-1.5 h-4 w-4" /> Add row</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {scaleQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">Could not load your school grading scale.</p>
          ) : scaleQuery.isLoading || !scaleDraft ? <Skeleton className="h-32 w-full" /> : (
            <>
              {scaleDraft.map((entry, index) => (
                <div key={index} className="grid grid-cols-[minmax(80px,1fr)_minmax(90px,1.2fr)_minmax(90px,1fr)_40px] items-end gap-2 sm:gap-3">
                  <div className="space-y-1"><Label className="text-xs" htmlFor={`scale-letter-${index}`}>Letter</Label><Input id={`scale-letter-${index}`} value={entry.letter} maxLength={12} onChange={event => setScaleDraft(current => current?.map((row, i) => i === index ? { ...row, letter: event.target.value } : row) ?? null)} /></div>
                  <div className="space-y-1"><Label className="text-xs" htmlFor={`scale-min-${index}`}>Minimum %</Label><Input id={`scale-min-${index}`} type="number" min="0" max="100" step="0.1" value={entry.minPercent} onChange={event => setScaleDraft(current => current?.map((row, i) => i === index ? { ...row, minPercent: event.target.value === "" ? 0 : Number(event.target.value) } : row) ?? null)} /></div>
                  <div className="space-y-1"><Label className="text-xs" htmlFor={`scale-points-${index}`}>GPA points</Label><Input id={`scale-points-${index}`} type="number" min="0" max="5" step="0.01" value={entry.points} onChange={event => setScaleDraft(current => current?.map((row, i) => i === index ? { ...row, points: event.target.value === "" ? 0 : Number(event.target.value) } : row) ?? null)} /></div>
                  <Button variant="ghost" size="icon" aria-label={`Remove scale row ${entry.letter || index + 1}`} onClick={() => setScaleDraft(current => current?.filter((_, i) => i !== index) ?? null)} disabled={scaleDraft.length <= 2}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              {scaleError && <p role="alert" className="text-sm text-destructive">{scaleError}</p>}
              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">{scaleQuery.data?.customized ? "Customized school scale" : "Default scale"} · Changes apply to your personal GPA projections.</p>
                <Button onClick={saveScale} disabled={updateScale.isPending}>
                  {updateScale.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save grading scale
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}