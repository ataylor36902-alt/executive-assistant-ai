import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/react";
import { Link } from "wouter";
import { useListCourses, useAskClassscribe } from "@workspace/api-client-react";
import type { AskClassscribeCitation, AskAnswerResult } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BookOpen, ChevronRight, Loader2, MessageSquare, Quote } from "lucide-react";

const ALL_COURSES = "__all_courses";
const ALL_TERMS = "__all_terms";

function getCitationHref(citation: AskClassscribeCitation) {
  if (citation.kind === "lecture" && citation.lectureId) {
    const timestamp = typeof citation.seconds === "number" && Number.isFinite(citation.seconds) && citation.seconds >= 0
      ? `?t=${encodeURIComponent(citation.seconds)}`
      : "";
    return `/lectures/${encodeURIComponent(citation.lectureId)}${timestamp}`;
  }
  if (citation.kind === "practice-attempt" && citation.lectureId) {
    return `/lectures/${encodeURIComponent(citation.lectureId)}`;
  }
  if (citation.kind === "note") {
    return `/ask/source/note/${encodeURIComponent(citation.noteId ?? citation.id)}`;
  }
  if (citation.kind === "assignment") {
    return `/ask/source/assignment/${encodeURIComponent(citation.assignmentId ?? citation.id)}`;
  }
  if (citation.kind === "syllabus") {
    return `/ask/source/syllabus/${encodeURIComponent(citation.courseId)}`;
  }
  return "/courses";
}

export default function AskClassScribe() {
  const { user } = useUser();
  const [courseId, setCourseId] = useState(ALL_COURSES);
  const [term, setTerm] = useState(ALL_TERMS);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskAnswerResult | null>(null);
  const [focusedCitation, setFocusedCitation] = useState<AskClassscribeCitation | null>(null);
  const requestGeneration = useRef(0);
  const questionInput = useRef<HTMLTextAreaElement>(null);

  const { data: courses, isLoading: coursesLoading, isError: coursesError } = useListCourses();
  const askMutation = useAskClassscribe();
  const askLimitReached = (askMutation.error as { data?: { code?: string } } | null)?.data?.code === "ask_limit_reached";
  const terms = useMemo(
    () => [...new Set((courses ?? []).map(course => course.term).filter((value): value is string => !!value))].sort(),
    [courses],
  );

  useEffect(() => {
    requestGeneration.current += 1;
    setCourseId(ALL_COURSES);
    setTerm(ALL_TERMS);
    setQuestion("");
    setResult(null);
    setFocusedCitation(null);
  }, [user?.id]);

  const clearAnswer = () => {
    requestGeneration.current += 1;
    setResult(null);
    setFocusedCitation(null);
  };

  const handleAsk = () => {
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length < 3 || trimmedQuestion.length > 500) return;
    const generation = ++requestGeneration.current;
    setResult(null);
    const data = {
      question: trimmedQuestion,
      ...(courseId !== ALL_COURSES ? { courseId } : {}),
      ...(term !== ALL_TERMS ? { term } : {}),
    };
    askMutation.mutate({ data }, {
      onSuccess: response => {
        if (generation === requestGeneration.current) {
          setResult(response);
        }
      },
    });
  };

  const askAboutCitation = (citation: AskClassscribeCitation) => {
    requestGeneration.current += 1;
    setResult(null);
    setFocusedCitation(citation);
    setQuestion(`Using this cited excerpt: “${citation.excerpt}”\n\nFollow-up: `);
    requestAnimationFrame(() => questionInput.current?.focus());
  };

  const selectedCitation = focusedCitation;

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col space-y-8 p-6 md:p-10">
      <header>
        <h1 className="mb-2 flex items-center gap-3 font-serif text-3xl font-bold text-foreground md:text-4xl">
          <MessageSquare className="h-8 w-8 text-primary" /> Ask ClassScribe
        </h1>
        <p className="text-lg text-muted-foreground">
          Ask questions grounded in your course material, with links back to their sources.
        </p>
      </header>

      <div className="grid gap-8 md:grid-cols-2">
        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle>Choose a scope</CardTitle>
            <CardDescription>Search across all courses or narrow your answer to a course and term.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ask-course">Course</Label>
              <Select value={courseId} onValueChange={value => {
                setCourseId(value);
                clearAnswer();
              }}>
                <SelectTrigger id="ask-course" data-testid="select-ask-course">
                  <SelectValue placeholder={coursesLoading ? "Loading courses..." : "Choose course scope"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_COURSES}>All courses</SelectItem>
                  {courses?.map(course => (
                    <SelectItem key={course.id} value={course.id}>{course.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ask-term">Term</Label>
              <Select value={term} onValueChange={value => {
                setTerm(value);
                clearAnswer();
              }}>
                <SelectTrigger id="ask-term" data-testid="select-ask-term">
                  <SelectValue placeholder="Choose term scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TERMS}>All terms</SelectItem>
                  {terms.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {coursesError && <p role="alert" className="text-sm text-destructive" data-testid="error-ask-courses">Could not load your courses. Refresh and try again.</p>}
          </CardContent>
        </Card>

        <Card className="flex flex-col border-border shadow-sm">
          <CardHeader>
            <CardTitle>Your question</CardTitle>
            <CardDescription>
              {selectedCitation ? `Following up on “${selectedCitation.title}”.` : "Ask about your courses. Answers include citations when available."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col space-y-4">
            <Textarea
              ref={questionInput}
              data-testid="input-ask-question"
              placeholder="What were the main causes of..."
              className="min-h-[120px] flex-1 resize-none"
              value={question}
              onChange={event => {
                requestGeneration.current += 1;
                setQuestion(event.target.value);
                setResult(null);
              }}
              disabled={askMutation.isPending}
            />
            <Button
              onClick={handleAsk}
              data-testid="button-ask-question"
              disabled={question.trim().length < 3 || question.trim().length > 500 || askMutation.isPending}
              className="w-full"
            >
              {askMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-2 h-4 w-4" />}
              Ask Question
            </Button>
          </CardContent>
        </Card>
      </div>

      {askMutation.isError && <p role="alert" className="text-sm text-destructive" data-testid="error-ask-question">{askLimitReached ? "You’ve reached your monthly Ask limit. Your question is still here; try again after the reset." : "Could not answer this question. Check your sign-in and try again."}</p>}
      {question.length > 500 && <p role="alert" className="text-sm text-destructive" data-testid="error-ask-question-length">Keep your question under 500 characters.</p>}
      {(result || askMutation.isPending) && (
        <Card className="border-primary/20 bg-primary/5 shadow-sm" data-testid="card-ask-answer">
          <CardHeader className="border-b border-primary/10 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-primary">
              <BookOpen className="h-5 w-5" /> Answer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            {askMutation.isPending ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-8 text-muted-foreground" role="status">
                <Loader2 className="h-8 w-8 animate-spin text-primary/50" />
                <p>Searching your course material...</p>
              </div>
            ) : result && (
              <>
                <div className="max-w-none whitespace-pre-wrap text-foreground leading-relaxed" data-testid="text-ask-answer">
                  {result.answer}
                </div>
                {result.citations.length > 0 ? (
                  <section className="space-y-3" aria-label="Answer citations">
                    <h2 className="text-sm font-semibold">Sources</h2>
                    {result.citations.map(citation => (
                      <article key={citation.id} className="rounded-lg border bg-background p-4" data-testid={`citation-${citation.id}`}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link href={getCitationHref(citation)} data-testid={`link-citation-${citation.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                              {citation.kind === "practice-attempt" ? `Practice attempt · Review lecture: ${citation.title.replace(/^Practice attempt:\s*/i, "")}` : citation.title}
                              <ChevronRight className="inline h-3 w-3" aria-hidden="true" />
                            </Link>
                            <p className="text-xs text-muted-foreground">{citation.courseName} · {citation.kind}</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => askAboutCitation(citation)}
                            data-testid={`button-followup-${citation.id}`}
                          >
                            <Quote className="mr-1.5 h-3.5 w-3.5" /> Ask about excerpt
                          </Button>
                        </div>
                        <blockquote className="mt-3 border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground" data-testid={`text-citation-excerpt-${citation.id}`}>
                          {citation.excerpt}
                        </blockquote>
                      </article>
                    ))}
                  </section>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-ask-no-citations">No source citations were returned for this answer.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}