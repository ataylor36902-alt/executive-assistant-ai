import { useState, useRef, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { 
  useGetLecture, 
  useUpdateLecture, 
  useDeleteLecture,
  useAnalyzeLecture,
  useTranscribeLecture,
  useListBookmarks,
  useCreateBookmark,
  useDeleteBookmark,
  getListLectureDatesQueryKey,
  getGetLectureQueryKey,
  getListBookmarksQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AcademicDates } from "@/components/AcademicDates";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  ChevronLeft, 
  Clock, 
  FileText, 
  List, 
  BookOpen, 
  PenTool, 
  Share, 
  Trash2,
  Calendar,
  Users,
  Bookmark,
  BookmarkMinus,
  Loader2
} from "lucide-react";
import { getRecording, deleteRecording } from "@/lib/recordingStorage";

export default function LectureDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: lecture, isLoading } = useGetLecture(id || "");
  const updateLecture = useUpdateLecture();
  const deleteLecture = useDeleteLecture();
  const analyzeLecture = useAnalyzeLecture();
  const transcribeLecture = useTranscribeLecture();
  
  const { data: bookmarks } = useListBookmarks();
  const createBookmark = useCreateBookmark();
  const deleteBookmark = useDeleteBookmark();

  const lectureBookmarks = bookmarks?.filter(b => b.lectureId === id) || [];

  const [notes, setNotes] = useState("");
  const [debouncedNotes, setDebouncedNotes] = useState("");
  const [localAudioState, setLocalAudioState] = useState<"checking" | "available" | "missing" | "unavailable">("checking");
  const [retryingTranscription, setRetryingTranscription] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");
  const initializedForId = useRef<string | null>(null);
  const lastSaved = useRef<string>("");

  useEffect(() => {
    if (lecture && initializedForId.current !== id) {
      initializedForId.current = id || null;
      setNotes(lecture.notes || "");
      lastSaved.current = lecture.notes || "";
    }
  }, [lecture, id]);

  useEffect(() => {
    if (!id || lecture?.transcript) return;
    let active = true;
    setLocalAudioState("checking");
    setTranscriptionError("");
    getRecording(id).then(blob => {
      if (active) setLocalAudioState(blob ? "available" : "missing");
    }).catch(error => {
      console.error("Could not check browser-local lecture audio:", error);
      if (active) setLocalAudioState("unavailable");
    });
    return () => { active = false; };
  }, [id, lecture?.transcript]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNotes(notes);
    }, 1000);
    return () => clearTimeout(timer);
  }, [notes]);

  const mutateFnRef = useRef(updateLecture.mutate);
  mutateFnRef.current = updateLecture.mutate;

  useEffect(() => {
    if (initializedForId.current !== id || !id) return;
    if (debouncedNotes !== lastSaved.current) {
      mutateFnRef.current({ id, data: { notes: debouncedNotes } }, {
        onSuccess: () => {
          lastSaved.current = debouncedNotes;
          queryClient.setQueryData(getGetLectureQueryKey(id), (old: any) => 
            old ? { ...old, notes: debouncedNotes } : old
          );
        }
      });
    }
  }, [debouncedNotes, id, queryClient]);

  const onDelete = () => {
    if (!id) return;
    deleteLecture.mutate({ id }, {
      onSuccess: async () => {
        let audioCleanupFailed = false;
        try {
          await deleteRecording(id);
        } catch (storageError) {
          audioCleanupFailed = true;
          console.error("Could not remove local audio for deleted lecture:", storageError);
          toast({ title: "Lecture deleted; local audio cleanup incomplete", description: "The browser could not remove its retry copy.", variant: "destructive" });
        }
        if (!audioCleanupFailed) toast({ title: "Lecture deleted" });
        if (lecture?.courseId) {
          setLocation(`/courses/${lecture.courseId}`);
        } else {
          setLocation("/courses");
        }
      }
    });
  };

  const handleShare = () => {
    if (!lecture) return;
    const subject = encodeURIComponent(`Lecture Notes: ${lecture.title}`);
    const body = encodeURIComponent(`
Check out these notes for ${lecture.title} (${lecture.professor}):

${lecture.summary ? `SUMMARY\n${lecture.summary}\n\n` : ""}
${lecture.keyPoints && lecture.keyPoints.length > 0 ? `KEY POINTS\n${lecture.keyPoints.map(kp => `- ${kp}`).join("\n")}\n\n` : ""}
${notes ? `MY NOTES\n${notes}` : ""}
    `.trim());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const handleRetryTranscription = async () => {
    if (!id) return;
    setRetryingTranscription(true);
    setTranscriptionError("");
    try {
      const audioBlob = await getRecording(id);
      if (!audioBlob) {
        setLocalAudioState("missing");
        setTranscriptionError("The recording is not available in this browser. Local audio cannot be recovered from the server; return to the browser/device where you recorded, or use a downloaded audio copy.");
        return;
      }

      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (typeof reader.result === "string") resolve(reader.result.split(",")[1]);
          else reject(new Error("Could not read the locally saved recording."));
        };
        reader.onerror = () => reject(new Error("Could not read the locally saved recording."));
        reader.readAsDataURL(audioBlob);
      });

      const result = await transcribeLecture.mutateAsync({
        id,
        data: {
          audioBase64: base64Audio,
          fileName: "lecture.webm",
          mimeType: audioBlob.type || "audio/webm"
        }
      });
      await updateLecture.mutateAsync({ id, data: { transcript: result.transcript } });
      try {
        await deleteRecording(id);
        setLocalAudioState("missing");
      } catch (storageError) {
        console.error("Could not remove successfully transcribed local audio:", storageError);
        toast({ title: "Transcript saved; local cleanup incomplete", description: "The recording could not be removed from this browser's storage.", variant: "destructive" });
      }
      await queryClient.invalidateQueries({ queryKey: getGetLectureQueryKey(id) });
      toast({ title: "Transcription saved", description: "Your lecture transcript is ready." });

      try {
        const analysis = await analyzeLecture.mutateAsync({ id, data: { transcript: result.transcript, difficulty: "intermediate" } });
        await updateLecture.mutateAsync({
          id,
          data: { summary: analysis.summary, keyPoints: analysis.keyPoints, definitions: analysis.definitions }
        });
        await queryClient.invalidateQueries({ queryKey: getGetLectureQueryKey(id) });
      } catch (analysisError) {
        console.error("Could not analyze retried transcript:", analysisError);
        toast({ title: "Transcript saved; analysis incomplete", description: "You can retry analysis later.", variant: "destructive" });
      }
    } catch (error) {
      console.error("Transcription retry failed:", error);
      setTranscriptionError(error instanceof Error ? error.message : "Transcription failed. Your browser-local recording is still available to retry.");
      toast({ title: "Transcription failed", description: "Your local recording has been kept for another retry.", variant: "destructive" });
    } finally {
      setRetryingTranscription(false);
    }
  };

  const findDates = () => {
    if (!id || !lecture?.transcript) return;
    analyzeLecture.mutate({ id, data: { transcript: lecture.transcript, difficulty: "intermediate" } }, {
      onSuccess: result => {
        queryClient.invalidateQueries({ queryKey: getGetLectureQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListLectureDatesQueryKey(id) });
        toast({ title: "Transcript analyzed", description: `${result.dates.length} assignment or exam date${result.dates.length === 1 ? "" : "s"} found. Review them below.` });
      },
      onError: () => toast({ title: "Could not analyze transcript", variant: "destructive" }),
    });
  };

  const [selection, setSelection] = useState<string>("");

  const handleSelection = () => {
    const text = window.getSelection()?.toString().trim();
    if (text && text.length > 0) {
      setSelection(text);
    } else {
      setSelection("");
    }
  };

  const handleBookmarkSelection = () => {
    if (!id || !selection) return;
    createBookmark.mutate({ id, data: { excerpt: selection } }, {
      onSuccess: () => {
        toast({ title: "Bookmark saved", description: "Added to your study materials." });
        queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() });
        setSelection("");
        window.getSelection()?.removeAllRanges();
      }
    });
  };

  const toggleBookmarkKeyPoint = (point: string) => {
    if (!id) return;
    const existing = lectureBookmarks.find(b => b.excerpt === point);
    if (existing) {
      deleteBookmark.mutate({ id: existing.id }, {
        onSuccess: () => {
          toast({ title: "Bookmark removed" });
          queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() });
        }
      });
    } else {
      createBookmark.mutate({ id, data: { excerpt: point } }, {
        onSuccess: () => {
          toast({ title: "Bookmark saved", description: "Key point bookmarked." });
          queryClient.invalidateQueries({ queryKey: getListBookmarksQueryKey() });
        }
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!lecture) {
    return (
      <div className="p-8 text-center flex flex-col items-center justify-center h-full">
        <h2 className="text-2xl font-bold mb-2">Lecture Not Found</h2>
        <Button onClick={() => setLocation("/courses")}>Back to Courses</Button>
      </div>
    );
  }

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "Unknown duration";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto flex flex-col h-full">
      <Link href={`/courses/${lecture.courseId}`}>
        <Button variant="ghost" className="mb-4 pl-0 -ml-2 text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to Course
        </Button>
      </Link>

      <header className="mb-8 border-b pb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-start gap-4">
          <div className="flex-1">
            <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-4 leading-tight">
              {lecture.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground text-sm">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {format(new Date(lecture.lectureDate), "MMMM d, yyyy")}</span>
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {lecture.professor}</span>
              <span className="flex items-center gap-1.5"><Clock className="w-4 h-4" /> {formatDuration(lecture.durationSeconds)}</span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleShare}>
              <Share className="w-4 h-4 mr-2" /> Share
            </Button>
            
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive border-destructive/20 hover:bg-destructive/10">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this lecture?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the lecture, transcript, and all your notes. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-8 flex-1">
        <div className="lg:col-span-2 flex flex-col h-full">
          <Tabs defaultValue="notes" className="flex-1 flex flex-col h-full">
            <TabsList className="mb-4 w-full justify-start">
              <TabsTrigger value="notes" className="flex items-center gap-2">
                <PenTool className="w-4 h-4" /> My Notes
              </TabsTrigger>
              <TabsTrigger value="transcript" className="flex items-center gap-2">
                <FileText className="w-4 h-4" /> Transcript
              </TabsTrigger>
              <TabsTrigger value="summary" className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" /> Summary
              </TabsTrigger>
            </TabsList>

            <TabsContent value="notes" className="flex-1 mt-0 outline-none h-full">
              <div className="bg-card border rounded-xl h-[500px] lg:h-[calc(100vh-320px)] flex flex-col shadow-sm overflow-hidden">
                <div className="flex justify-between items-center p-3 border-b bg-muted/20">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Editor</span>
                  <span className="text-xs text-muted-foreground">
                    {updateLecture.isPending ? "Saving..." : notes !== lastSaved.current ? "Unsaved changes" : "Saved"}
                  </span>
                </div>
                <Textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Take your personal notes here..."
                  className="flex-1 border-0 resize-none focus-visible:ring-0 p-6 text-base leading-relaxed rounded-none shadow-none"
                />
              </div>
            </TabsContent>

            <TabsContent value="transcript" className="flex-1 mt-0 outline-none">
              <div className="bg-card border rounded-xl h-[500px] lg:h-[calc(100vh-320px)] overflow-auto p-6 shadow-sm relative">
                {selection && (
                  <div className="sticky top-0 left-0 right-0 bg-primary/10 border border-primary/20 p-3 rounded-lg mb-4 flex items-center justify-between z-10 backdrop-blur-sm">
                    <p className="text-sm font-medium line-clamp-1 mr-4">"{selection}"</p>
                    <Button size="sm" onClick={handleBookmarkSelection} disabled={createBookmark.isPending}>
                      <Bookmark className="w-4 h-4 mr-2" /> Save Bookmark
                    </Button>
                  </div>
                )}
                {lecture.transcript ? (
                  <div 
                    className="prose prose-slate max-w-none text-foreground/80 leading-relaxed whitespace-pre-wrap"
                    onMouseUp={handleSelection}
                    onTouchEnd={handleSelection}
                  >
                    {lecture.transcript}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                    <FileText className="w-12 h-12 mb-4 opacity-20" />
                    <p>No transcript available for this lecture.</p>
                    <div className="max-w-lg mt-5 space-y-3">
                      <p className="text-sm">
                        {localAudioState === "checking" && "Checking this browser for the local recording…"}
                        {localAudioState === "available" && "A retry copy is saved only in this browser. It will be removed after transcription succeeds."}
                        {localAudioState === "missing" && "No retry audio is available in this browser. Raw audio is never stored on the ClassScribe server."}
                        {localAudioState === "unavailable" && "This browser could not access local recording storage. Retry in the browser where you recorded, if possible."}
                      </p>
                      {localAudioState === "available" && (
                        <Button onClick={handleRetryTranscription} disabled={retryingTranscription}>
                          {retryingTranscription && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                          {retryingTranscription ? "Retrying transcription…" : "Retry transcription"}
                        </Button>
                      )}
                      {transcriptionError && <p className="text-sm text-destructive">{transcriptionError}</p>}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="summary" className="flex-1 mt-0 outline-none">
              <div className="bg-primary/5 border border-primary/10 rounded-xl h-[500px] lg:h-[calc(100vh-320px)] overflow-auto p-6 shadow-sm">
                {lecture.summary ? (
                  <div className="prose prose-slate max-w-none">
                    <h3 className="text-xl font-serif text-primary mb-4">AI Summary</h3>
                    <div className="text-foreground/80 leading-relaxed whitespace-pre-wrap font-medium">
                      {lecture.summary}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                    <BookOpen className="w-12 h-12 mb-4 opacity-20" />
                    <p>No summary generated yet.</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-6 flex flex-col">
           <div className="bg-card border rounded-xl p-5 shadow-sm">
             {lecture.transcript && (
               <Button variant="outline" className="w-full mb-4" disabled={analyzeLecture.isPending}
                 onClick={findDates}>{analyzeLecture.isPending ? "Finding dates…" : "Find dates in transcript"}</Button>
             )}
             <AcademicDates lectureId={id} />
           </div>
          <div className="bg-card border rounded-xl p-5 shadow-sm">
            <h3 className="font-bold flex items-center gap-2 mb-4 text-foreground border-b pb-3">
              <List className="w-4 h-4 text-secondary" /> Key Points
            </h3>
            {lecture.keyPoints && lecture.keyPoints.length > 0 ? (
              <ul className="space-y-3">
                {lecture.keyPoints.map((point, i) => {
                  const isBookmarked = lectureBookmarks.some(b => b.excerpt === point);
                  return (
                    <li key={i} className="flex gap-3 text-sm text-foreground/80 group">
                      <button 
                        onClick={() => toggleBookmarkKeyPoint(point)}
                        className={`mt-0.5 shrink-0 transition-colors ${isBookmarked ? 'text-secondary' : 'text-muted-foreground/30 group-hover:text-secondary/60'}`}
                        title={isBookmarked ? "Remove bookmark" : "Bookmark this point"}
                      >
                        <Bookmark className="w-4 h-4" />
                      </button>
                      <span className="leading-relaxed">{point}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">No key points extracted.</p>
            )}
          </div>

          <div className="bg-card border rounded-xl p-5 shadow-sm flex-1">
            <h3 className="font-bold flex items-center gap-2 mb-4 text-foreground border-b pb-3">
              <BookOpen className="w-4 h-4 text-accent" /> Definitions
            </h3>
            {lecture.definitions && lecture.definitions.length > 0 ? (
              <ul className="space-y-4">
                {lecture.definitions.map((def, i) => {
                  const parts = def.split(":");
                  const term = parts[0];
                  const meaning = parts.slice(1).join(":");
                  return (
                    <li key={i} className="text-sm bg-muted/30 p-3 rounded-lg border border-border/50">
                      <strong className="block text-foreground mb-1">{term}</strong>
                      <span className="text-muted-foreground leading-relaxed">{meaning || def}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">No definitions extracted.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
