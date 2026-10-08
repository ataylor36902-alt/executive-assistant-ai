import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { 
  useListCourses, 
  useCreateLecture,
  useTranscribeLecture,
  useAnalyzeLecture,
  useUpdateLecture
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Mic, Square, Pause, Play, AlertTriangle, Loader2, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { Progress } from "@/components/ui/progress";
import {
  attachDraftToLecture,
  deleteRecording,
  deleteRecordingDraft,
  getRecordingDrafts,
  RecordingDraft,
  saveRecording,
  saveRecordingDraft
} from "@/lib/recordingStorage";

export default function RecordLecture() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: courses, isLoading: coursesLoading } = useListCourses();
  const createLecture = useCreateLecture();
  const transcribeLecture = useTranscribeLecture();
  const analyzeLecture = useAnalyzeLecture();
  const updateLecture = useUpdateLecture();

  // Form State
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [professor, setProfessor] = useState("");

  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processingState, setProcessingState] = useState<"idle" | "creating" | "transcribing" | "analyzing" | "done" | "failed">("idle");
  const [savedLectureId, setSavedLectureId] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [recordingDrafts, setRecordingDrafts] = useState<RecordingDraft[]>([]);
  const [draftStorageError, setDraftStorageError] = useState("");
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const unmountedRef = useRef(false);

  const stopMicrophone = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };

  const refreshRecordingDrafts = async () => {
    try {
      setRecordingDrafts(await getRecordingDrafts());
      setDraftStorageError("");
    } catch (error) {
      console.error("Could not load local recording drafts:", error);
      setDraftStorageError("This browser could not access saved recording drafts. Download any recording you need to keep.");
    }
  };

  useEffect(() => {
    unmountedRef.current = false;
    void refreshRecordingDrafts();
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      stopMicrophone();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    if (!courseId || !title) {
      toast({ title: "Required fields missing", description: "Please select a course and provide a lecture title.", variant: "destructive" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (unmountedRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstart = () => {
        setIsRecording(true);
        setIsPaused(false);
        setRecordingTime(0);
        timerRef.current = window.setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      };

      mediaRecorder.onpause = () => {
        setIsPaused(true);
        if (timerRef.current) clearInterval(timerRef.current);
      };

      mediaRecorder.onresume = () => {
        setIsPaused(false);
        timerRef.current = window.setInterval(() => {
          setRecordingTime(prev => prev + 1);
        }, 1000);
      };

      mediaRecorder.onerror = () => {
        stopMicrophone();
        if (timerRef.current) clearInterval(timerRef.current);
        toast({
          title: "Recording interrupted",
          description: "The microphone stopped unexpectedly. Saving the audio captured so far.",
          variant: "destructive"
        });
        if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
      };

      mediaRecorder.onstop = async () => {
        if (timerRef.current) clearInterval(timerRef.current);
        stopMicrophone();
        if (unmountedRef.current) return;
        setIsRecording(false);
        setIsPaused(false);

        const audioBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
        if (audioBlob.size > 0) {
          setDownloadUrl(current => {
            if (current) URL.revokeObjectURL(current);
            return URL.createObjectURL(audioBlob);
          });
        }
        const draft: RecordingDraft = {
          draftId: crypto.randomUUID(),
          blob: audioBlob,
          mimeType: audioBlob.type || "audio/webm",
          courseId,
          title,
          professor,
          createdAt: format(new Date(), "yyyy-MM-dd")
        };
        let draftPersisted = false;
        try {
          await saveRecordingDraft(draft);
          draftPersisted = true;
          await refreshRecordingDrafts();
        } catch (storageError) {
          console.error("Could not preserve local recording draft:", storageError);
          setProcessingError("This browser could not save a recoverable draft. Download the audio below to keep it.");
        }
        await processRecordingDraft(draft, draftPersisted);
        stopMicrophone();
      };

      mediaRecorder.start(1000); // collect data every second
    } catch (err) {
      stopMicrophone();
      console.error("Error accessing microphone:", err);
      toast({
        title: "Microphone Access Denied",
        description: "Please allow microphone permissions to record lectures.",
        variant: "destructive"
      });
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          // Remove the data URL prefix (e.g., "data:audio/webm;base64,")
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        } else {
          reject(new Error("Failed to convert blob to base64"));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const processRecordingDraft = async (draft: RecordingDraft, alreadyPersisted: boolean) => {
    setCourseId(draft.courseId);
    setTitle(draft.title);
    setProfessor(draft.professor);
    setSavedLectureId(null);
    setProcessingError("");
    setProcessingState("creating");

    let lectureId: string | null = null;
    let audioSavedLocally = false;
    let transcriptSaved = false;
    try {
      const lecture = await createLecture.mutateAsync({
        data: {
          courseId: draft.courseId,
          title: draft.title,
          professor: draft.professor || "Unknown",
          lectureDate: draft.createdAt
        }
      });
      lectureId = lecture.id;
      setSavedLectureId(lecture.id);

      try {
        if (alreadyPersisted) {
          await attachDraftToLecture(draft.draftId, lecture.id);
        } else {
          await saveRecording(lecture.id, draft.blob);
        }
        audioSavedLocally = true;
        await refreshRecordingDrafts();
      } catch (storageError) {
        console.error("Could not preserve recording after lecture creation:", storageError);
        setProcessingError("The lecture was created, but browser storage could not attach a retry copy. Download the audio below before leaving this page.");
      }

      setProcessingState("transcribing");
      const base64Audio = await blobToBase64(draft.blob);
      const transcriptionRes = await transcribeLecture.mutateAsync({
        id: lecture.id,
        data: {
          audioBase64: base64Audio,
          fileName: "lecture.webm",
          mimeType: draft.mimeType || "audio/webm"
        }
      });

      await updateLecture.mutateAsync({ id: lecture.id, data: { transcript: transcriptionRes.transcript } });
      transcriptSaved = true;
      if (audioSavedLocally) {
        try {
          await deleteRecording(lecture.id);
        } catch (storageError) {
          console.error("Could not remove transcribed audio from browser storage:", storageError);
          toast({ title: "Transcript saved; local cleanup incomplete", description: "The recording could not be removed from this browser's storage.", variant: "destructive" });
        }
      }
      if (alreadyPersisted) {
        try {
          await deleteRecordingDraft(draft.draftId);
          await refreshRecordingDrafts();
        } catch (storageError) {
          console.error("Could not remove the completed recording draft:", storageError);
        }
      }

      setProcessingState("analyzing");
      const analysisRes = await analyzeLecture.mutateAsync({
        id: lecture.id,
        data: { transcript: transcriptionRes.transcript, difficulty: "intermediate" }
      });
      await updateLecture.mutateAsync({
        id: lecture.id,
        data: {
          summary: analysisRes.summary,
          keyPoints: analysisRes.keyPoints,
          definitions: analysisRes.definitions
        }
      });

      if (unmountedRef.current) return;
      setProcessingState("done");
      toast({ title: "Processing Complete", description: "Your lecture is ready!" });
      setLocation(`/lectures/${lecture.id}`);
    } catch (error) {
      console.error("Processing error:", error);
      if (unmountedRef.current) return;
      const message = error instanceof Error ? error.message : "There was an error processing your recording.";
      setProcessingError(lectureId
        ? transcriptSaved
          ? `${message} The transcript is saved; open the lecture to view it.`
          : `${message} Your lecture has been saved. ${audioSavedLocally ? "Retry transcription from its detail page in this browser." : "Download the audio below before leaving this page; no browser retry copy is available."}`
        : alreadyPersisted
          ? `${message} Lecture creation failed. The recording draft remains available below for retry or download.`
          : `${message} Lecture creation failed and this browser could not preserve a draft. Download the audio below to keep it.`);
      setProcessingState("failed");
      toast({ title: "Processing Failed", description: "Your recording is available below; it has not been discarded.", variant: "destructive" });
    }
  };

  const stopRecordingAndProcess = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const progressValue = {
    idle: 0,
    creating: 10,
    transcribing: 40,
    analyzing: 75,
    done: 100,
    failed: 100
  }[processingState];

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto h-full flex flex-col">
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-serif font-bold text-foreground mb-2">
          Record Lecture
        </h1>
        <p className="text-muted-foreground text-lg">
          Capture high-quality audio and generate notes automatically.
        </p>
      </header>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-4 mb-8 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-500 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-900 dark:text-amber-400 leading-relaxed">
          <strong>Important:</strong> Ensure you have the professor's permission before recording a lecture. 
          Audio stays in this browser for a retry until transcription succeeds; only a temporary copy is sent for transcription. It is then removed from this browser and is not stored on ClassScribe servers.
        </div>
      </div>

      {(recordingDrafts.length > 0 || draftStorageError) && (
        <Card className="mb-8 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Saved recordings on this browser</CardTitle>
            <CardDescription>
              Draft audio is kept only on this device until transcription succeeds. Retry lecture creation or download a copy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {draftStorageError && <p className="text-sm text-destructive">{draftStorageError}</p>}
            {recordingDrafts.map(draft => (
              <div key={draft.draftId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border bg-card p-4">
                <div>
                  <p className="font-semibold">{draft.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {draft.professor || "Unknown professor"} · Recorded {draft.createdAt}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void processRecordingDraft(draft, true)}
                    disabled={processingState === "creating" || processingState === "transcribing" || processingState === "analyzing"}
                  >
                    Retry lecture creation
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => downloadBlob(draft.blob, `${draft.title || "lecture-recording"}.webm`)}
                  >
                    Download audio
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-8 flex-1">
        <Card className="shadow-sm border-border">
          <CardHeader>
            <CardTitle>Lecture Details</CardTitle>
            <CardDescription>Select the course and name this lecture before recording.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="course">Course</Label>
              <Select value={courseId} onValueChange={setCourseId} disabled={isRecording || processingState !== "idle"}>
                <SelectTrigger id="course">
                  <SelectValue placeholder={coursesLoading ? "Loading courses..." : "Select a course"} />
                </SelectTrigger>
                <SelectContent>
                  {courses?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="title">Lecture Title</Label>
              <Input 
                id="title" 
                placeholder="e.g. Chapter 3: Cellular Respiration" 
                value={title}
                onChange={e => setTitle(e.target.value)}
                disabled={isRecording || processingState !== "idle"}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="professor">Professor (Optional)</Label>
              <Input 
                id="professor" 
                placeholder="e.g. Dr. Roberts" 
                value={professor}
                onChange={e => setProfessor(e.target.value)}
                disabled={isRecording || processingState !== "idle"}
              />
            </div>
          </CardContent>
        </Card>

        <Card className={`shadow-sm border-border flex flex-col transition-colors duration-500 ${isRecording && !isPaused ? 'border-destructive/30 bg-destructive/5' : ''}`}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className={`w-5 h-5 ${isRecording && !isPaused ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`} />
              Recording Control
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center py-10">
            {processingState === "idle" ? (
              <>
                <div className={`text-6xl font-mono tracking-tighter mb-8 ${isRecording && !isPaused ? 'text-destructive' : 'text-foreground'}`}>
                  {formatTime(recordingTime)}
                </div>
                
                {!isRecording ? (
                  <Button 
                    size="lg" 
                    className="w-48 h-16 text-lg rounded-full shadow-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                    onClick={startRecording}
                    data-testid="button-start-recording"
                  >
                    <Mic className="w-5 h-5 mr-2" /> Start Recording
                  </Button>
                ) : (
                  <div className="flex items-center gap-4">
                    {isPaused ? (
                      <Button size="lg" variant="outline" className="w-16 h-16 rounded-full" onClick={resumeRecording} data-testid="button-resume-recording">
                        <Play className="w-6 h-6 ml-1" />
                      </Button>
                    ) : (
                      <Button size="lg" variant="outline" className="w-16 h-16 rounded-full" onClick={pauseRecording} data-testid="button-pause-recording">
                        <Pause className="w-6 h-6" />
                      </Button>
                    )}
                    
                    <Button 
                      size="lg" 
                      className="w-32 h-16 rounded-full bg-foreground text-background hover:bg-foreground/90"
                      onClick={stopRecordingAndProcess}
                      data-testid="button-stop-recording"
                    >
                      <Square className="w-5 h-5 mr-2" /> Stop
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full max-w-sm flex flex-col items-center text-center space-y-6">
                {processingState === "failed" ? (
                  <AlertTriangle className="w-12 h-12 text-destructive" />
                ) : <BookOpen className="w-12 h-12 text-primary animate-bounce" />}
                <div className="space-y-2 w-full">
                  <h3 className="text-lg font-bold">{processingState === "failed" ? "Recording saved" : "Processing Lecture"}</h3>
                  {processingState !== "failed" && <Progress value={progressValue} className="h-2 w-full" />}
                  <p className={`text-sm ${processingState === "failed" ? "text-destructive" : "text-muted-foreground"} capitalize`}>
                    {processingState === "creating" && "Creating record..."}
                    {processingState === "transcribing" && "Transcribing audio..."}
                    {processingState === "analyzing" && "Generating summary & notes..."}
                    {processingState === "done" && "Finishing up..."}
                    {processingState === "failed" && processingError}
                  </p>
                </div>
                {processingState === "failed" && downloadUrl && (
                  <a className="text-sm font-medium text-primary underline underline-offset-4" href={downloadUrl} download="lecture-recording.webm">Download recorded audio</a>
                )}
                {processingState === "failed" && savedLectureId && (
                  <Button variant="outline" onClick={() => setLocation(`/lectures/${savedLectureId}`)}>
                    Open saved lecture
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
