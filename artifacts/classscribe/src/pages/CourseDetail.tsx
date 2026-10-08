import { useState } from "react";
import { Link, useParams } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  useListCourses, 
  useUpdateCourse, 
  useListCourseLectures,
  useCreateLecture,
  useListCourseComments,
  useCreateCourseComment,
  useCreateCourseInvite,
  getListCourseLecturesQueryKey,
  getListCourseCommentsQueryKey,
  getListCoursesQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { 
  Card, 
  CardContent, 
  CardDescription, 
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Plus, 
  Settings, 
  Users, 
  FileText, 
  MessageSquare, 
  Calendar, 
  Clock, 
  Copy,
  ChevronLeft,
  Loader2,
  Send
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { AcademicDates } from "@/components/AcademicDates";
import { SyllabusTab } from "@/components/SyllabusTab";
import { CourseGradesPanel } from "@/components/CourseGradesPanel";

const lectureSchema = z.object({
  title: z.string().min(1, "Title is required"),
  professor: z.string().min(1, "Professor is required"),
  lectureDate: z.string().min(1, "Date is required"),
});

const commentSchema = z.object({
  content: z.string().min(1, "Comment cannot be empty"),
});

const updateCourseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  subject: z.string().min(1, "Subject is required"),
  term: z.string().min(1, "Term is required"),
});

export default function CourseDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [createLectureOpen, setCreateLectureOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Queries
  const { data: courses, isLoading: coursesLoading } = useListCourses();
  const { data: lectures, isLoading: lecturesLoading } = useListCourseLectures(id || "");
  const { data: comments, isLoading: commentsLoading } = useListCourseComments(id || "");

  // Mutations
  const createLecture = useCreateLecture();
  const createComment = useCreateCourseComment();
  const createInvite = useCreateCourseInvite();
  const updateCourse = useUpdateCourse();

  const course = courses?.find(c => c.id === id);

  const lectureForm = useForm<z.infer<typeof lectureSchema>>({
    resolver: zodResolver(lectureSchema),
    defaultValues: { title: "", professor: "", lectureDate: format(new Date(), "yyyy-MM-dd") },
  });

  const commentForm = useForm<z.infer<typeof commentSchema>>({
    resolver: zodResolver(commentSchema),
    defaultValues: { content: "" },
  });

  const updateForm = useForm<z.infer<typeof updateCourseSchema>>({
    resolver: zodResolver(updateCourseSchema),
    values: {
      name: course?.name || "",
      subject: course?.subject || "",
      term: course?.term || "",
    },
  });

  const onCreateLecture = (data: z.infer<typeof lectureSchema>) => {
    if (!id) return;
    createLecture.mutate({ data: { courseId: id, ...data } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCourseLecturesQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setCreateLectureOpen(false);
        lectureForm.reset();
        toast({ title: "Lecture added successfully" });
      }
    });
  };

  const onUpdateCourse = (data: z.infer<typeof updateCourseSchema>) => {
    if (!id) return;
    updateCourse.mutate({ id, data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setSettingsOpen(false);
        toast({ title: "Course updated successfully" });
      }
    });
  };

  const onAddComment = (data: z.infer<typeof commentSchema>) => {
    if (!id) return;
    createComment.mutate({ id, data: { content: data.content, authorName: "Student" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCourseCommentsQueryKey(id) });
        commentForm.reset();
      }
    });
  };

  const onGenerateInvite = () => {
    if (!id) return;
    createInvite.mutate({ id }, {
      onSuccess: (res) => {
        setInviteCode(res.code);
        navigator.clipboard.writeText(res.code);
        toast({ title: "Invite code copied to clipboard", description: res.code });
      }
    });
  };

  if (coursesLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="p-8 text-center flex flex-col items-center justify-center h-full">
        <h2 className="text-2xl font-bold mb-2">Course Not Found</h2>
        <p className="text-muted-foreground mb-4">This course may have been deleted or you don't have access.</p>
        <Link href="/courses">
          <Button>Back to Courses</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto flex flex-col h-full">
      <Link href="/courses">
        <Button variant="ghost" className="mb-4 pl-0 -ml-2 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Courses
        </Button>
      </Link>

      <header className="mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: course.color }} />
              <span className="text-sm font-semibold px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {course.subject} • {course.term}
              </span>
            </div>
            <h1 className="text-3xl md:text-5xl font-serif font-bold text-foreground mb-4">
              {course.name}
            </h1>
            <div className="flex items-center gap-6 text-muted-foreground text-sm">
              <span className="flex items-center gap-1.5"><FileText className="w-4 h-4" /> {course.lectureCount} Lectures</span>
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {course.memberCount} Members</span>
            </div>
          </div>

          <div className="flex gap-2">
            {course.isOwner && (
            <Button variant="outline" onClick={onGenerateInvite} disabled={createInvite.isPending}>
              {createInvite.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
              Invite
            </Button>
            )}
            {course.isOwner && (
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon">
                  <Settings className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Course Settings</DialogTitle>
                </DialogHeader>
                <Form {...updateForm}>
                  <form onSubmit={updateForm.handleSubmit(onUpdateCourse)} className="space-y-4">
                    <FormField
                      control={updateForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Course Name</FormLabel>
                          <FormControl><Input {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={updateForm.control}
                        name="subject"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Subject</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={updateForm.control}
                        name="term"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Term</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={updateCourse.isPending}>
                      {updateCourse.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Save Changes
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
            )}
          </div>
        </div>
      </header>

      {inviteCode && (
        <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg flex items-center justify-between">
          <div>
            <p className="font-semibold text-primary">Invite Code Generated</p>
            <p className="text-sm text-muted-foreground">Share this code with classmates to let them join.</p>
          </div>
          <div className="flex items-center gap-2">
            <code className="px-3 py-1.5 bg-background rounded border font-mono text-lg font-bold">{inviteCode}</code>
            <Button variant="ghost" size="icon" onClick={() => navigator.clipboard.writeText(inviteCode)}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue={(() => {
        const params = new URLSearchParams(window.location.search);
        const tab = params.get("tab");
        return tab === "discussion" || tab === "dates" || tab === "syllabus" || tab === "grades"
          ? tab : params.get("importSyllabus") === "true" ? "syllabus" : "lectures";
      })()} className="flex-1 flex flex-col">
        <TabsList className="mb-6 h-auto max-w-full flex-wrap self-start gap-1">
          <TabsTrigger value="lectures" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Lectures
          </TabsTrigger>
          <TabsTrigger value="syllabus" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Syllabus
          </TabsTrigger>
          <TabsTrigger value="grades" className="flex items-center gap-2">
            <FileText className="w-4 h-4" /> Grades
          </TabsTrigger>
          <TabsTrigger value="discussion" className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4" /> Class Memory
          </TabsTrigger>
          <TabsTrigger value="dates" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Dates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lectures" className="flex-1 flex flex-col m-0 outline-none">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold">All Lectures</h2>
            <Dialog open={createLectureOpen} onOpenChange={setCreateLectureOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" /> Add Lecture
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Lecture</DialogTitle>
                </DialogHeader>
                <Form {...lectureForm}>
                  <form onSubmit={lectureForm.handleSubmit(onCreateLecture)} className="space-y-4">
                    <FormField
                      control={lectureForm.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl><Input placeholder="Week 1: Introduction" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={lectureForm.control}
                      name="professor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Professor</FormLabel>
                          <FormControl><Input placeholder="Dr. Smith" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={lectureForm.control}
                      name="lectureDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={createLecture.isPending}>
                      {createLecture.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Add Lecture
                    </Button>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {lecturesLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : lectures && lectures.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {lectures.map(lecture => (
                <Link key={lecture.id} href={`/lectures/${lecture.id}`}>
                  <Card className="hover-elevate cursor-pointer transition-all border-border hover:border-primary/30 group">
                    <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <h3 className="font-bold text-lg font-serif group-hover:text-primary transition-colors mb-1">
                          {lecture.title}
                        </h3>
                        <p className="text-sm text-muted-foreground flex items-center gap-3">
                          <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {format(new Date(lecture.lectureDate), "MMM d, yyyy")}</span>
                          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {lecture.professor}</span>
                          {lecture.durationSeconds && (
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {Math.round(lecture.durationSeconds / 60)} min</span>
                          )}
                        </p>
                      </div>
                      
                      <div className="flex gap-2">
                        {lecture.summary && <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-md font-medium">Summary Available</span>}
                        {lecture.transcript && <span className="text-xs bg-secondary/10 text-secondary px-2 py-1 rounded-md font-medium">Transcript</span>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-card/50">
              <FileText className="w-10 h-10 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-lg font-bold mb-2">No lectures yet</h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Add a past lecture manually or record a new one to start building the class memory.
              </p>
              <div className="flex gap-3">
                <Button onClick={() => setCreateLectureOpen(true)} variant="outline">Add Manually</Button>
                <Link href="/record">
                  <Button>Record New</Button>
                </Link>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="syllabus" className="m-0 outline-none flex-1">
          {id && <SyllabusTab courseId={id} />}
        </TabsContent>

        <TabsContent value="grades" className="m-0 outline-none flex-1">
          {id && <CourseGradesPanel courseId={id} />}
        </TabsContent>

        <TabsContent value="dates" className="m-0 outline-none">
          <AcademicDates courseId={id} />
        </TabsContent>

        <TabsContent value="discussion" className="flex-1 flex flex-col m-0 outline-none">
          <div className="bg-card border rounded-xl flex flex-col h-[600px] max-h-full">
            <div className="p-4 border-b bg-muted/30">
              <h2 className="font-bold font-serif">Class Discussion</h2>
              <p className="text-sm text-muted-foreground">Share notes, ask questions, and collaborate with your classmates.</p>
            </div>
            
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {commentsLoading ? (
                <div className="space-y-4">
                  {[1, 2].map(i => <Skeleton key={i} className="h-20 w-3/4 rounded-xl" />)}
                </div>
              ) : comments && comments.length > 0 ? (
                comments.map(comment => (
                  <div key={comment.id} className="bg-muted/50 p-4 rounded-xl max-w-[85%] self-start border border-border/50">
                    <div className="flex justify-between items-baseline mb-2">
                      <span className="font-semibold text-sm">{comment.authorName}</span>
                      <span className="text-xs text-muted-foreground">{format(new Date(comment.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                    <p className="text-sm leading-relaxed">{comment.content}</p>
                  </div>
                ))
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <MessageSquare className="w-8 h-8 text-muted-foreground opacity-30 mb-3" />
                  <p className="text-muted-foreground">No discussions yet. Be the first to share a thought!</p>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t bg-muted/10">
              <Form {...commentForm}>
                <form onSubmit={commentForm.handleSubmit(onAddComment)} className="flex gap-3">
                  <FormField
                    control={commentForm.control}
                    name="content"
                    render={({ field }) => (
                      <FormItem className="flex-1 m-0 space-y-0">
                        <FormControl>
                          <Textarea 
                            placeholder="Share a thought or ask a question..." 
                            className="min-h-[44px] h-[44px] resize-none py-3"
                            {...field}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <Button type="submit" size="icon" className="shrink-0 h-[44px] w-[44px]" disabled={createComment.isPending || !commentForm.formState.isValid}>
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              </Form>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
