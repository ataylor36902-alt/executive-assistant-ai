import { useListCourses } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Users, BookOpen, ChevronRight, MessageSquare, Copy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCreateCourseInvite } from "@workspace/api-client-react";

export default function Classmates() {
  const { data: courses, isLoading } = useListCourses();
  const createInvite = useCreateCourseInvite();
  const { toast } = useToast();

  const handleGenerateInvite = (courseId: string) => {
    createInvite.mutate({ id: courseId }, {
      onSuccess: (res) => {
        navigator.clipboard.writeText(res.code);
        toast({ title: "Invite code copied", description: res.code });
      }
    });
  };

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto flex flex-col h-full space-y-8">
      <header>
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2 flex items-center gap-3">
          <Users className="w-8 h-8 text-primary" /> Classmates
        </h1>
        <p className="text-muted-foreground text-lg">
          Collaborate with your peers and access shared course discussions.
        </p>
      </header>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
      ) : courses?.length ? (
        <div className="grid md:grid-cols-2 gap-6">
          {courses.map((course) => (
            <Card key={course.id} className="border-border hover-elevate group">
              <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: course.color }} />
                      <span className="text-xs font-semibold text-muted-foreground">{course.subject} • {course.term}</span>
                    </div>
                    <h3 className="font-bold text-xl font-serif">{course.name}</h3>
                  </div>
                  <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" /> {course.memberCount}
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-6">
                  <Link href={`/courses/${course.id}?tab=discussion`} className="flex-1">
                    <Button variant="default" className="w-full justify-between group-hover:bg-primary/90 transition-colors">
                      <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4" /> Go to Discussions</span>
                      <ChevronRight className="w-4 h-4 opacity-50" />
                    </Button>
                  </Link>
                  <Button 
                    variant="outline" 
                    title="Copy Invite Code"
                    onClick={() => handleGenerateInvite(course.id)}
                    disabled={createInvite.isPending}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-xl bg-card/50">
          <BookOpen className="w-10 h-10 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-bold mb-2">No active courses</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            Join or create a course to start collaborating with classmates.
          </p>
          <Link href="/courses">
            <Button>Manage Courses</Button>
          </Link>
        </div>
      )}
    </div>
  );
}
