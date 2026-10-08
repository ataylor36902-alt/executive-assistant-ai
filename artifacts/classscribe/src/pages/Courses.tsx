import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  useListCourses, 
  useCreateCourse, 
  useJoinCourse,
  getListCoursesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, FileText, Search, Library, Loader2, CalendarDays, Clock3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const createCourseSchema = z.object({
  name: z.string().min(1, "Course name is required"),
  subject: z.string().min(1, "Subject is required"),
  term: z.string().min(1, "Term is required (e.g., Fall 2024)"),
  color: z.string().min(1, "Color is required"),
});

const joinCourseSchema = z.object({
  code: z.string().min(1, "Invite code is required"),
});

const orderedDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function getNextClass(course: { meetings: { days: string[]; start: string }[] }) {
  const now = new Date();
  let next: Date | null = null;
  for (const meeting of course.meetings ?? []) {
    for (const day of meeting.days) {
      const dayOffset = (orderedDays.indexOf(day as typeof orderedDays[number]) - ((now.getDay() + 6) % 7) + 7) % 7;
      if (dayOffset < 0 || !/^\d{2}:\d{2}$/.test(meeting.start)) continue;
      const [hours, minutes] = meeting.start.split(":").map(Number);
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + dayOffset);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
      if (!next || candidate < next) next = candidate;
    }
  }
  return next;
}

export default function Courses() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Check URL params for intents
  const searchParams = new URLSearchParams(window.location.search);
  const createIntent = searchParams.get("create") === "true";
  const importSyllabusIntent = searchParams.get("importSyllabus") === "true";

  useEffect(() => {
    if (createIntent && !createOpen) {
      setCreateOpen(true);
    }
  }, [createIntent, createOpen]);

  const { data: courses, isLoading } = useListCourses();
  
  const createCourse = useCreateCourse();
  const joinCourse = useJoinCourse();

  const createForm = useForm<z.infer<typeof createCourseSchema>>({
    resolver: zodResolver(createCourseSchema),
    defaultValues: {
      name: "",
      subject: "",
      term: "",
      color: "#1F2A93",
    },
  });

  const joinForm = useForm<z.infer<typeof joinCourseSchema>>({
    resolver: zodResolver(joinCourseSchema),
    defaultValues: { code: "" },
  });

  const onCreateSubmit = (data: z.infer<typeof createCourseSchema>) => {
    createCourse.mutate({ data }, {
      onSuccess: (course) => {
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setCreateOpen(false);
        createForm.reset();
        toast({ title: "Course created", description: `${course.name} has been added.` });
        if (importSyllabusIntent) {
          setLocation(`/courses/${course.id}?importSyllabus=true`);
        } else {
          setLocation(`/courses/${course.id}`);
        }
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to create course.", variant: "destructive" });
      }
    });
  };

  const onJoinSubmit = (data: z.infer<typeof joinCourseSchema>) => {
    joinCourse.mutate({ data }, {
      onSuccess: (course) => {
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setJoinOpen(false);
        joinForm.reset();
        toast({ title: "Joined Course", description: `You have joined ${course.name}.` });
        setLocation(`/courses/${course.id}`);
      },
      onError: () => {
        toast({ title: "Invalid Code", description: "Could not join course. Check the code.", variant: "destructive" });
      }
    });
  };

  const filteredCourses = courses?.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.subject.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];
  const sortedCourses = [...filteredCourses].sort((a, b) => {
    const aNext = getNextClass(a);
    const bNext = getNextClass(b);
    if (!aNext && !bNext) return a.name.localeCompare(b.name);
    if (!aNext) return 1;
    if (!bNext) return -1;
    return aNext.getTime() - bNext.getTime();
  });

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto h-full flex flex-col">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2">
            Courses
          </h1>
          <p className="text-muted-foreground text-lg">
            Manage your classes and access your academic memory.
          </p>
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex-1 md:flex-none" data-testid="button-join-course-modal">
                Join Course
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join a Course</DialogTitle>
                <DialogDescription>
                  Enter the invite code provided by your classmate or professor.
                </DialogDescription>
              </DialogHeader>
              <Form {...joinForm}>
                <form onSubmit={joinForm.handleSubmit(onJoinSubmit)} className="space-y-4">
                  <FormField
                    control={joinForm.control}
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Invite Code</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. A8X9B2" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={joinCourse.isPending}>
                    {joinCourse.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Join
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="flex-1 md:flex-none" data-testid="button-create-course-modal">
                <Plus className="w-4 h-4 mr-2" />
                New Course
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Course</DialogTitle>
                <DialogDescription>
                  Start a new course memory bank to record and store lectures.
                </DialogDescription>
              </DialogHeader>
              <Form {...createForm}>
                <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
                  <FormField
                    control={createForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Course Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Introduction to Psychology" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createForm.control}
                      name="subject"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Subject</FormLabel>
                          <FormControl>
                            <Input placeholder="PSY 101" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="term"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Term</FormLabel>
                          <FormControl>
                            <Input placeholder="Fall 2024" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={createForm.control}
                    name="color"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Theme Color</FormLabel>
                        <FormControl>
                          <div className="flex gap-3">
                            <Input type="color" className="w-16 h-10 p-1 cursor-pointer" {...field} />
                            <Input type="text" className="flex-1 font-mono uppercase" {...field} />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={createCourse.isPending}>
                    {createCourse.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Create Course
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <div className="mb-6 relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search courses..." 
          className="pl-9 h-10"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : sortedCourses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedCourses.map(course => {
            const upcoming = getNextClass(course);
            const nextLabel = upcoming
              ? `${upcoming.toLocaleDateString(undefined, { weekday: "short" })} · ${upcoming.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
              : null;
            return (
            <Link key={course.id} href={`/courses/${course.id}`}>
              <Card className="h-full hover-elevate cursor-pointer border-border transition-all overflow-hidden flex flex-col group shadow-sm">
                <div className="h-3 w-full" style={{ backgroundColor: course.color || 'hsl(var(--primary))' }} />
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {course.subject}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">{course.term}</span>
                  </div>
                  <CardTitle className="text-xl font-serif line-clamp-2 group-hover:text-primary transition-colors leading-tight">
                    {course.name}
                  </CardTitle>
                </CardHeader>
                <div className="px-6 pb-4">
                  {nextLabel ? <div className="flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-sm font-medium text-primary">
                    <CalendarDays className="h-4 w-4 shrink-0" />
                    <span>Next class: {nextLabel}</span>
                  </div> : <div className="text-sm text-muted-foreground">No class times set</div>}
                  {course.meetings?.length ? <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5 shrink-0" />
                    <span className="line-clamp-1">{course.meetings.map(meeting => `${meeting.days.join(", ")} ${meeting.start}–${meeting.end}`).join(" · ")}</span>
                  </div> : null}
                </div>
                <CardContent className="mt-auto pt-4 border-t border-border/50">
                  <div className="flex justify-between text-sm text-muted-foreground font-medium">
                    <div className="flex items-center gap-1.5">
                      <FileText className="w-4 h-4" />
                      <span>{course.lectureCount} Lectures</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Users className="w-4 h-4" />
                      <span>{course.memberCount} Members</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          )})}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-card/50">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Library className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold font-serif mb-2">No courses found</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            {searchQuery 
              ? "We couldn't find any courses matching your search." 
              : "You haven't joined or created any courses yet. Create one to start building your academic memory."}
          </p>
          {!searchQuery && (
            <Button onClick={() => setCreateOpen(true)}>Create your first course</Button>
          )}
        </div>
      )}
    </div>
  );
}
