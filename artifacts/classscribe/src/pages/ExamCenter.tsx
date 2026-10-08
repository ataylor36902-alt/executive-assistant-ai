import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useListCourses, useListCourseLectures, useAnalyzeLecture, getListCourseLecturesQueryKey, getGetCourseGradesQueryKey, getGetPracticeProgressQueryKey, useGetPracticeProgress, useSubmitPracticeAttempt, useGetCourseGrades, useGetGradeScale, useCalculateNeededGrade } from "@workspace/api-client-react";
import type { NeededGradeResult, QuizQuestion, PracticeAttemptResult } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, FileText, CheckCircle2, RefreshCw } from "lucide-react";
import { StudyGuidePanel } from "@/components/StudyGuidePanel";

export default function ExamCenter() {
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState("");
  const [lectureId, setLectureId] = useState("");
  const [difficulty, setDifficulty] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [generated, setGenerated] = useState<{ lectureId: string; questions: QuizQuestion[] } | null>(null);
  const [results, setResults] = useState<Record<string, PracticeAttemptResult>>({});
  const [answerError, setAnswerError] = useState("");
  const [neededItemId, setNeededItemId] = useState("");
  const [targetLetter, setTargetLetter] = useState("");
  const [neededResult, setNeededResult] = useState<NeededGradeResult | null>(null);

  const { data: courses, isLoading: coursesLoading } = useListCourses();
  const { data: lectures, isLoading: lecturesLoading } = useListCourseLectures(courseId, { 
    query: { enabled: !!courseId, queryKey: getListCourseLecturesQueryKey(courseId) }
  });
  const analyzeMutation = useAnalyzeLecture();
  const submitAttempt = useSubmitPracticeAttempt();
  const progress = useGetPracticeProgress({ query: { queryKey: getGetPracticeProgressQueryKey(), refetchOnMount: "always", refetchOnWindowFocus: "always" } });
  const { data: gradebook, isLoading: gradesLoading, isError: gradesError } = useGetCourseGrades(courseId, {
    query: { enabled: !!courseId, queryKey: getGetCourseGradesQueryKey(courseId) },
  });
  const { data: gradeScale, isLoading: scaleLoading, isError: scaleError } = useGetGradeScale();
  const neededGrade = useCalculateNeededGrade();
  const activeGradeItems = gradebook?.items.filter(item => !item.archived) ?? [];
  const ungradedItems = activeGradeItems.filter(item => item.scorePercent === null);
  const selectedNeededItem = ungradedItems.find(item => item.id === neededItemId);
  const weightsComplete = !!gradebook?.weights.length && Math.abs(gradebook.weightsTotal - 100) < 0.01;
  const categoriesMapped = !!gradebook && activeGradeItems.every(item => gradebook.weights.some(weight => weight.category === item.category));

  const selectedLecture = lectures?.find(l => l.id === lectureId);
  const questions = generated?.lectureId === lectureId ? generated.questions : selectedLecture?.quizQuestions ?? [];
  const courseLectures = progress.data?.lectures.filter(l => !courseId || l.courseId === courseId) ?? [];
  const answered = courseLectures.reduce((sum, l) => sum + l.answered, 0);
  const correct = courseLectures.reduce((sum, l) => sum + l.correct, 0);
  const weakTopics = progress.data?.topics.filter(t => (!courseId || t.courseId === courseId) && t.correct < t.answered) ?? [];

  const handleGenerate = () => {
    if (!selectedLecture?.transcript) return;
    setGenerated(null); setResults({});
    analyzeMutation.mutate(
      { id: selectedLecture.id, data: { transcript: selectedLecture.transcript, difficulty } },
      {
        onSuccess: (data) => {
          setGenerated({ lectureId: selectedLecture.id, questions: data.quizQuestions });
          queryClient.invalidateQueries({ queryKey: getListCourseLecturesQueryKey(courseId) });
        }
      }
    );
  };

  const handleAnswer = async (question: QuizQuestion, selectedIndex: number) => {
    if (!lectureId || submitAttempt.isPending) return;
    setAnswerError("");
    try {
      const result = await submitAttempt.mutateAsync({ id: lectureId, data: { questionId: question.id, selectedIndex } });
      setResults(previous => ({ ...previous, [question.id]: result }));
      await queryClient.invalidateQueries({ queryKey: getGetPracticeProgressQueryKey() });
    } catch (error) {
      setAnswerError(error instanceof Error ? error.message : "Could not save your answer. Try again.");
    }
  };

  const handleNeededGrade = () => {
    if (!courseId || !selectedNeededItem || !targetLetter) return;
    setNeededResult(null);
    neededGrade.mutate({ id: courseId, data: { itemId: selectedNeededItem.id, targetLetter } }, {
      onSuccess: setNeededResult,
    });
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto flex flex-col h-full space-y-8">
      <header>
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2 flex items-center gap-3">
          <FileText className="w-8 h-8 text-primary" /> Exam Center
        </h1>
        <p className="text-muted-foreground text-lg">
          Generate practice questions from your lecture transcripts and test your knowledge.
        </p>
      </header>

      <div className="grid md:grid-cols-3 gap-8">
        <Card className="border-border shadow-sm md:col-span-1 h-fit">
          <CardHeader>
            <CardTitle>Setup Practice</CardTitle>
            <CardDescription>Select material to test.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course">Course</Label>
               <Select value={courseId} onValueChange={(val) => { setCourseId(val); setLectureId(""); setGenerated(null); setResults({}); setNeededItemId(""); setNeededResult(null); }}>
                <SelectTrigger id="course">
                  <SelectValue placeholder={coursesLoading ? "Loading..." : "Select a course"} />
                </SelectTrigger>
                <SelectContent>
                  {courses?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="lecture">Lecture</Label>
              <Select 
                value={lectureId} 
                 onValueChange={(val) => { setLectureId(val); setGenerated(null); setResults({}); }}
                disabled={!courseId || lecturesLoading || !lectures?.length}
              >
                <SelectTrigger id="lecture">
                  <SelectValue placeholder={lecturesLoading ? "Loading..." : !courseId ? "Select a course first" : lectures?.length ? "Select a lecture" : "No lectures available"} />
                </SelectTrigger>
                <SelectContent>
                  {lectures?.map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="difficulty">Difficulty</Label>
               <Select value={difficulty} onValueChange={(val: "beginner" | "intermediate" | "advanced") => { setDifficulty(val); }}>
                <SelectTrigger id="difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selectedLecture && !selectedLecture.transcript && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                This lecture has no transcript.
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button 
              onClick={handleGenerate} 
              disabled={!selectedLecture?.transcript || analyzeMutation.isPending}
              className="w-full"
            >
              {analyzeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Generate Questions
            </Button>
          </CardFooter>
        </Card>

        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Your practice progress</CardTitle><CardDescription>Based only on your saved answers, across web and mobile.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {progress.isPending ? <p>Loading progress…</p> : progress.isError ? <p role="alert" className="text-destructive">Progress could not be loaded.</p> : answered === 0 ?
                <p className="text-muted-foreground">No answers saved{courseId ? " in this course" : ""} yet. Answer a question to start tracking progress.</p> : <>
                  <p className="font-semibold">{correct} correct of {answered} answered · {Math.round(correct / answered * 100)}% of attempts</p>
                  {courseLectures.map(l => <p key={l.lectureId} className="text-muted-foreground">{l.title}: {l.correct}/{l.answered} correct</p>)}
                  <p className="font-semibold">Topics to revisit</p>
                  {weakTopics.length ? weakTopics.map(t => <p key={`${t.courseId}-${t.topic.toLowerCase()}`} className="text-muted-foreground">{t.topic} · {t.courseName} · {t.correct}/{t.answered} correct across {t.lectureCount} {t.lectureCount === 1 ? "lecture" : "lectures"}</p>) : <p className="text-muted-foreground">No missed answers yet.</p>}
                </>}
            </CardContent>
          </Card>
          <Card className="border-primary/20 shadow-sm">
            <CardHeader>
              <CardTitle>What do I need?</CardTitle>
              <CardDescription>Estimate the score needed on an ungraded assignment or exam to reach a target letter grade.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!courseId ? (
                <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">Choose a course in Setup Practice to see its gradebook assignments.</p>
              ) : gradesLoading ? (
                <p className="text-sm text-muted-foreground">Loading course grades…</p>
              ) : gradesError ? (
                <p role="alert" className="text-sm text-destructive">Could not load this course gradebook.</p>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="needed-item">Ungraded assignment or exam</Label>
                      <Select value={neededItemId} onValueChange={value => { setNeededItemId(value); setNeededResult(null); }}>
                        <SelectTrigger id="needed-item"><SelectValue placeholder={ungradedItems.length ? "Choose an item" : "No ungraded items"} /></SelectTrigger>
                        <SelectContent>
                          {ungradedItems.map(item => <SelectItem key={item.id} value={item.id}>{item.title} · {item.category}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="needed-letter">Target letter grade</Label>
                      <Select value={targetLetter} onValueChange={value => { setTargetLetter(value); setNeededResult(null); }}>
                        <SelectTrigger id="needed-letter"><SelectValue placeholder={scaleLoading ? "Loading scale…" : "Choose a target"} /></SelectTrigger>
                        <SelectContent>
                          {gradeScale?.entries.map(entry => <SelectItem key={entry.letter} value={entry.letter}>{entry.letter}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {scaleError && <p role="alert" className="text-sm text-destructive">Could not load your grading scale. Try again later.</p>}
                  {gradebook?.needsWeightReview && (
                    <div role="alert" className="rounded-md border-2 border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-950 dark:text-amber-100">
                      Imported syllabus weights are unconfirmed. Review and save them in the course Grades tab before calculating a needed score.
                      <Link href={`/courses/${courseId}?tab=grades`}><span className="cursor-pointer pl-1 font-medium underline">Review course weights</span></Link>
                    </div>
                  )}
                  {gradebook && (!weightsComplete || !categoriesMapped) && (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                      {!weightsComplete ? `This course’s category weights total ${gradebook.weightsTotal}%, not 100%. ` : ""}
                      {!categoriesMapped ? "Some assignment categories do not match a saved weight. " : ""}
                      Complete the weights in the course Grades tab before calculating; a score would otherwise imply unsupported precision.
                      <Link href={`/courses/${courseId}?tab=grades`}><span className="cursor-pointer pl-1 font-medium underline">Open course Grades</span></Link>
                    </div>
                  )}
                  {gradebook && weightsComplete && categoriesMapped && (
                    <p className="text-xs text-muted-foreground">The estimate depends on the saved category weights and currently entered scores. It is not a promise of a final grade.</p>
                  )}
                  <Button onClick={handleNeededGrade} disabled={!selectedNeededItem || !targetLetter || !weightsComplete || !categoriesMapped || gradebook?.needsWeightReview || neededGrade.isPending}>
                    {neededGrade.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Calculate needed score
                  </Button>
                  {neededGrade.isError && <p role="alert" className="text-sm text-destructive">Could not calculate the needed score. Check the saved scores and weights, then try again.</p>}
                  {neededResult && selectedNeededItem && !gradebook?.needsWeightReview && weightsComplete && categoriesMapped && (
                    <div className="rounded-lg border bg-primary/5 p-4">
                      <p className="font-semibold">{neededResult.requiredPercent == null ? neededResult.message : `${neededResult.requiredPercent.toFixed(1)}% needed`}</p>
                      {neededResult.requiredPercent != null && <p className="mt-1 text-sm">{neededResult.message}</p>}
                      <p className="mt-2 text-sm text-muted-foreground">{neededResult.assumption}</p>
                      <p className="mt-2 text-xs text-muted-foreground">Conditional estimate only; actual results depend on your instructor’s grading and remaining coursework.</p>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {analyzeMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border rounded-xl bg-card/50 border-dashed">
              <Loader2 className="w-10 h-10 animate-spin text-primary/50 mb-4" />
              <p>Analyzing lecture and generating questions...</p>
            </div>
          ) : analyzeMutation.isError ? (
            <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
              Failed to generate questions. Please try again.
            </div>
          ) : questions.length > 0 ? (
            <div className="space-y-4">
              <h3 className="font-bold text-xl mb-4 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-primary" /> Practice Questions
              </h3>
               <p className="text-sm text-muted-foreground">Answers are saved privately. The answer key is generated from lecture material; check your notes if it looks wrong.</p>
               {questions.map((q, idx) => {
                 const result = results[q.id];
                 return <Card key={q.id}>
                   <CardHeader><CardDescription>{q.topic}</CardDescription><CardTitle className="text-base">{idx + 1}. {q.prompt}</CardTitle></CardHeader>
                   <CardContent className="space-y-2">
                     {q.options.map((option, optionIndex) => <Button key={optionIndex} type="button" variant="outline" disabled={!!result || submitAttempt.isPending} onClick={() => handleAnswer(q, optionIndex)}
                       className={`w-full h-auto min-h-10 whitespace-normal text-left justify-start ${result?.correctIndex === optionIndex ? "border-primary bg-primary/10" : result?.selectedIndex === optionIndex ? "border-destructive" : ""}`}>{option}</Button>)}
                     {result && <div role="status" className="space-y-2 text-sm">
                       <p className={result.correct ? "text-primary" : "text-destructive"}>{result.correct ? "Correct · answer saved" : "Not quite · answer saved"}</p>
                       {!result.correct && <p>Answer key: {q.options[result.correctIndex]}</p>}
                       <Button variant="link" onClick={() => setResults(previous => { const next = { ...previous }; delete next[q.id]; return next; })}>Try again (counts as another attempt)</Button>
                     </div>}
                   </CardContent>
                 </Card>;
               })}
               {answerError && <p role="alert" className="text-destructive">Answer not saved: {answerError}</p>}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border rounded-xl bg-card/50 border-dashed text-center px-4">
              <FileText className="w-12 h-12 mb-4 opacity-20" />
              <h3 className="text-lg font-bold text-foreground mb-2">Ready to test yourself?</h3>
               <p className="max-w-sm">{selectedLecture ? "No answerable questions saved for this lecture yet. Analyze its transcript to make a quiz." : "Select a course and lecture to answer saved practice questions."}</p>
            </div>
          )}
        </div>
      </div>
      {courseId && <StudyGuidePanel key={courseId} courseId={courseId} />}
    </div>
  );
}
