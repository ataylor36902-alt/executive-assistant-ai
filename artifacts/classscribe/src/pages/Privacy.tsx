import { Link } from "wouter";
import { Shield, Check, Mic, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useClerk } from "@clerk/react";

export default function Privacy() {
  const { signOut } = useClerk();

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto flex flex-col h-full space-y-8 pb-20">
      <header>
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-4 flex items-center gap-3">
          <Shield className="w-8 h-8 text-primary" /> Privacy & Trust
        </h1>
        <p className="text-muted-foreground text-lg leading-relaxed">
          ClassScribe is designed as a calm academic memory, not a surveillance tool. 
          Here is exactly how your data is handled.
        </p>
      </header>

      <div className="space-y-6">
        <Card className="border-border">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Mic className="w-5 h-5 text-primary" /> Audio Processing
            </h2>
            <p className="text-muted-foreground">
              When you record a lecture, a copy of its audio is kept in this browser's local storage until transcription succeeds, so you can retry if the request fails. The audio is sent only as a temporary transcription request and is not saved on ClassScribe servers or in external file storage. After transcription succeeds, the local copy is removed. Local recordings are available only in the browser and device where they were recorded; if local storage is unavailable, download the audio to keep a copy.
            </p>
            <div className="bg-muted p-4 rounded-lg mt-4 text-sm font-medium flex items-start gap-3">
              <Check className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <span>Ensure you have your professor's or classmates' consent before recording any lecture material.</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <UsersIcon className="w-5 h-5 text-primary" /> Shared Courses & Access
            </h2>
            <p className="text-muted-foreground">
              ClassScribe allows you to invite classmates to your courses. Please note that at this stage of our beta, 
              <strong> strict course access restrictions are NOT yet fully implemented</strong>. Do not use the platform to share sensitive personal information or claim that courses are private end-to-end encrypted spaces.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-primary/5">
          <CardContent className="p-6 space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" /> Your Data, Your Control
            </h2>
            <p className="text-muted-foreground">
              You can edit or delete lectures from their detail pages. Study plans currently stay only in this browser; they do not sync to other devices.
            </p>
            <div className="flex gap-4 pt-2">
              <Link href="/courses">
                <Button variant="default">Manage Lectures</Button>
              </Link>
              <Button variant="outline" onClick={() => signOut()}>Sign Out</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UsersIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
