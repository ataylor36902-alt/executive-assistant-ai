import { useState } from "react";
import { 
  useGetDashboardSummary, 
  useGetDashboardGlance, 
  useListCourses 
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  BookOpen, Clock, FileText, Calendar, Import, Plus, Bookmark, 
  BrainCircuit, AlertCircle, ChevronRight, FileDown
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { PlansWidget } from "@/components/PlansWidget";
import { format, isPast, isToday, isTomorrow, addDays, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatDateLabel(dateString?: string) {
  if (!dateString) return "";
  try {
    const date = parseISO(dateString);
    if (isNaN(date.getTime())) return "";
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    if (isPast(date)) return "Overdue";
    if (date < addDays(new Date(), 7)) return format(date, "EEEE");
    return format(date, "MMM d");
  } catch {
    return "";
  }
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [syllabusCourseSelectOpen, setSyllabusCourseSelectOpen] = useState(false);
  
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useGetDashboardSummary();
  const { data: glance, isLoading: glanceLoading, isError: glanceError } = useGetDashboardGlance();
  const { data: courses, isLoading: coursesLoading, isError: coursesError } = useListCourses();
  const upcomingExams = glance?.dueSoon.filter(item => item.kind === "exam") ?? [];

  if (summaryError) {
    return (
      <div className="p-8">
        <div className="bg-destructive/10 text-destructive p-4 rounded-md">
          Failed to load dashboard data. Please try again later.
        </div>
      </div>
    );
  }

  const handleImportSyllabus = () => {
    setSyllabusCourseSelectOpen(true);
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2">
            Dashboard
          </h1>
          <p className="text-muted-foreground text-lg">
            Welcome back. Here's your academic overview.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleImportSyllabus}>
            <Import className="w-4 h-4 mr-2" />
            Import Syllabus
          </Button>
          <Link href="/courses?create=true">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Course
            </Button>
          </Link>
        </div>
      </header>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card className="shadow-sm border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Courses</p>
              {summaryLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{summary?.courseCount || 0}</p>}
            </div>
            <BookOpen className="w-8 h-8 text-primary/40" />
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Lectures</p>
              {summaryLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{summary?.lectureCount || 0}</p>}
            </div>
            <FileText className="w-8 h-8 text-secondary/40" />
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Study Min</p>
              {summaryLoading ? <Skeleton className="h-7 w-12" /> : <p className="text-2xl font-bold">{summary?.studyMinutes || 0}</p>}
            </div>
            <Clock className="w-8 h-8 text-accent/40" />
          </CardContent>
        </Card>
        <Card className="shadow-sm border-border bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between h-full">
            <div>
              <p className="text-sm font-bold text-primary mb-1">Quick Record</p>
              <Link href="/record" className="text-xs font-medium underline text-primary hover:text-primary/80">Start now →</Link>
            </div>
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main Column - 2/3 width */}
        <div className="lg:col-span-2 space-y-8">
          {/* Due Soon */}
          <section>
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-xl font-serif font-bold flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-destructive" /> 
                Due Soon
              </h2>
            </div>
            
            {glanceLoading ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {[1, 2].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
              </div>
            ) : glanceError ? (
              <p role="alert" className="p-5 rounded-lg border text-destructive">Could not load upcoming dates. Please try again.</p>
            ) : glance?.dueSoon && glance.dueSoon.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {glance.dueSoon.slice(0, 8).map((item) => (
                  <Card key={item.id} className="border-border shadow-sm border-l-4 border-l-destructive overflow-hidden hover-elevate">
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                          {formatDateLabel(item.dueDate)}
                        </span>
                        <span className="text-xs text-muted-foreground uppercase font-semibold">{item.kind}</span>
                      </div>
                      <h3 className="font-bold text-base leading-tight mb-1 truncate" title={item.title}>{item.title}</h3>
                      <Link href={`/courses/${item.courseId}?tab=${item.source === "syllabus" ? "syllabus" : "dates"}`}>
                        <p className="text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer truncate">
                          {item.courseName}
                        </p>
                      </Link>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center bg-card rounded-xl border border-dashed border-border flex flex-col items-center">
                <Calendar className="w-8 h-8 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground mb-4">No upcoming confirmed dates.</p>
                <Button variant="outline" size="sm" onClick={handleImportSyllabus}>Import Syllabus</Button>
              </div>
            )}
          </section>

          {/* Courses Panel */}
          <section>
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-xl font-serif font-bold flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" /> 
                My Courses
              </h2>
              <Link href="/courses" className="text-sm text-primary font-medium hover:underline">
                View all
              </Link>
            </div>
            
            {coursesLoading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
              </div>
            ) : coursesError ? (
              <p role="alert" className="p-5 rounded-lg border text-destructive">Could not load your courses. Please try again.</p>
            ) : courses && courses.length > 0 ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {courses.slice(0, 6).map(course => (
                  <Link key={course.id} href={`/courses/${course.id}`}>
                    <Card className="h-full hover-elevate cursor-pointer border-border transition-all overflow-hidden flex flex-col group shadow-sm">
                      <div className="h-2 w-full" style={{ backgroundColor: course.color || 'hsl(var(--primary))' }} />
                      <CardContent className="p-4 flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            {course.subject}
                          </span>
                        </div>
                        <h3 className="font-serif font-bold text-base leading-tight mb-3 group-hover:text-primary transition-colors line-clamp-2">
                          {course.name}
                        </h3>
                        <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                          <FileText className="w-3.5 h-3.5" />
                          <span>{course.lectureCount} Lectures</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center bg-card rounded-xl border border-dashed border-border flex flex-col items-center">
                <p className="text-muted-foreground mb-4">You aren't enrolled in any courses.</p>
                <Link href="/courses?create=true">
                  <Button size="sm">Add a Course</Button>
                </Link>
              </div>
            )}
          </section>

          {/* Bookmarks */}
          <section>
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-xl font-serif font-bold flex items-center gap-2">
                <Bookmark className="w-5 h-5 text-secondary" /> 
                Recent Bookmarks
              </h2>
            </div>

            {glanceLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
              </div>
            ) : glanceError ? (
              <p role="alert" className="p-5 rounded-lg border text-destructive">Could not load bookmarks. Please try again.</p>
            ) : glance?.recentBookmarks && glance.recentBookmarks.length > 0 ? (
              <div className="grid sm:grid-cols-2 gap-4">
                {glance.recentBookmarks.map((bookmark) => (
                  <Link key={bookmark.id} href={`/lectures/${bookmark.lectureId}`}>
                    <Card className="hover-elevate cursor-pointer transition-all border-border hover:border-secondary/30 h-full shadow-sm">
                      <CardContent className="p-4 flex flex-col h-full">
                        <p className="text-sm font-medium italic text-foreground/80 mb-3 line-clamp-3">
                          "{bookmark.excerpt}"
                        </p>
                        <div className="mt-auto pt-3 border-t border-border/50">
                          <p className="text-xs text-muted-foreground font-semibold truncate mb-0.5">{bookmark.lectureTitle}</p>
                          <p className="text-[10px] text-muted-foreground/70 truncate">{bookmark.courseName}</p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center bg-card rounded-xl border border-dashed border-border flex flex-col items-center">
                <Bookmark className="w-8 h-8 text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground text-sm max-w-md">No bookmarks yet. Highlight text in a lecture transcript to save important moments.</p>
              </div>
            )}
          </section>
        </div>

        {/* Sidebar Column - 1/3 width */}
        <div className="space-y-8 flex flex-col">
          <section>
            <h2 className="text-xl font-serif font-bold flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-primary" /> Upcoming Exams
            </h2>
            <Card className="border-border shadow-sm">
              <CardContent className="p-0">
                {glanceLoading ? <div className="p-4"><Skeleton className="h-12 w-full" /></div> :
                  glanceError ? <p role="alert" className="p-5 text-sm text-destructive">Could not load exams. Please try again.</p> :
                    upcomingExams.length ? (
                      <div className="divide-y divide-border">
                        {upcomingExams.slice(0, 5).map(exam => (
                          <Link key={exam.id} href={`/courses/${exam.courseId}?tab=${exam.source === "syllabus" ? "syllabus" : "dates"}`}>
                            <div className="p-4 hover:bg-muted/30 transition-colors">
                              <p className="text-xs font-semibold text-primary">{formatDateLabel(exam.dueDate)}</p>
                              <p className="font-semibold text-sm">{exam.title}</p>
                              <p className="text-xs text-muted-foreground">{exam.courseName}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : <p className="p-5 text-sm text-muted-foreground">No confirmed exams in the next 30 days.</p>}
              </CardContent>
            </Card>
          </section>
          {/* Study Plans */}
          <div className="h-[400px]">
            <PlansWidget />
          </div>

          {/* Exam Center practice sets */}
          <section>
            <h2 className="text-xl font-serif font-bold flex items-center gap-2 mb-4">
              <BrainCircuit className="w-5 h-5 text-accent" /> 
              Practice Sets
            </h2>
            <Card className="border-border shadow-sm">
              <CardContent className="p-0">
                {glanceLoading ? (
                  <div className="p-4 space-y-3">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : glanceError ? (
                  <p role="alert" className="p-5 text-sm text-destructive">Could not load practice activity. Please try again.</p>
                ) : glance?.recentPracticeSets && glance.recentPracticeSets.length > 0 ? (
                  <div className="divide-y divide-border">
                    {glance.recentPracticeSets.slice(0, 4).map((set, i) => (
                      <Link key={i} href="/exam-center">
                        <div className="p-4 hover:bg-muted/30 transition-colors cursor-pointer group flex items-center justify-between">
                          <div className="overflow-hidden pr-3">
                            <h4 className="font-bold text-sm truncate group-hover:text-primary transition-colors">{set.lectureTitle}</h4>
                            <p className="text-xs text-muted-foreground truncate">{set.courseName}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center">
                    <p className="text-sm text-muted-foreground mb-3">No recent practice sets generated.</p>
                    <Link href="/exam-center">
                      <Button variant="outline" size="sm" className="w-full">Visit Exam Center</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>

      {/* Syllabus Import Course Selector */}
      <Dialog open={syllabusCourseSelectOpen} onOpenChange={setSyllabusCourseSelectOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Import Syllabus</DialogTitle>
            <DialogDescription>
              Select an existing course or create a new one to attach the syllabus.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {coursesLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : courses && courses.length > 0 ? (
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                {courses.map(course => (
                  <Link key={course.id} href={`/courses/${course.id}?importSyllabus=true`}>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start h-auto py-3 px-4 font-normal text-left flex items-center hover:border-primary/50"
                      onClick={() => setSyllabusCourseSelectOpen(false)}
                    >
                      <div className="w-3 h-3 rounded-full mr-3 shrink-0" style={{ backgroundColor: course.color || 'hsl(var(--primary))' }} />
                      <div className="overflow-hidden flex-1">
                        <div className="font-semibold truncate text-foreground">{course.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{course.subject} • {course.term}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground ml-2 shrink-0" />
                    </Button>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center p-4 bg-muted/20 rounded-md text-sm text-muted-foreground mb-4">
                No courses available.
              </div>
            )}
            
            <div className="mt-4 pt-4 border-t">
              <Link href="/courses?create=true&importSyllabus=true">
                <Button className="w-full" onClick={() => setSyllabusCourseSelectOpen(false)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create New Course Instead
                </Button>
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
