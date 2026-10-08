import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useConfirmScheduleImport,
  useListCourses,
  usePreviewScheduleImport,
  useUpdateCourse,
  getListCoursesQueryKey,
} from "@workspace/api-client-react";
import type { Course, CourseMeeting, ScheduleImportInput, ScheduleProposal } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock3, FileUp, Loader2, MapPin, Pencil, Plus, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const DAYS: CourseMeeting["days"] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LABELS: Record<CourseMeeting["days"][number], string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
  Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
const TYPES: CourseMeeting["type"][] = ["Lecture", "Lab", "Discussion", "Seminar", "Recitation", "Office hours"];
const EMPTY_MEETING: CourseMeeting = { days: [], start: "", end: "", location: "", type: "Lecture" };
const COLORS = ["#1F2A93", "#6558d3", "#14867a", "#b45309", "#be3853", "#3c6ca8"];
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

function meetingTime(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const date = new Date(2000, 0, 1, hour, minute);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function nextClass(course: Course, now = new Date()) {
  let next: Date | null = null;
  for (const meeting of course.meetings ?? []) {
    for (const day of meeting.days) {
      const offset = (DAYS.indexOf(day) - ((now.getDay() + 6) % 7) + 7) % 7;
      const [hours, minutes] = meeting.start.split(":").map(Number);
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      if (candidate <= now) candidate.setDate(candidate.getDate() + 7);
      if (!next || candidate < next) next = candidate;
    }
  }
  return next;
}

function describeNext(date: Date) {
  const today = new Date();
  const diff = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
    new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  const label = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : date.toLocaleDateString(undefined, { weekday: "short" });
  return `${label} · ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function meetingSummary(meeting: CourseMeeting) {
  const days = DAYS.filter(day => meeting.days.includes(day)).join(", ");
  return `${days} · ${meetingTime(Number(meeting.start.slice(0, 2)) * 60 + Number(meeting.start.slice(3)))}–${meetingTime(Number(meeting.end.slice(0, 2)) * 60 + Number(meeting.end.slice(3)))}`;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return error instanceof Error ? error.message : "Please try again.";
}

export default function Schedule() {
  const { data: courses, isLoading, isError } = useListCourses();
  const updateCourse = useUpdateCourse();
  const previewImport = usePreviewScheduleImport();
  const confirmImport = useConfirmScheduleImport();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editCourse, setEditCourse] = useState<Course | null>(null);
  const [meetingRows, setMeetingRows] = useState<CourseMeeting[]>([]);
  const [meetingError, setMeetingError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [scheduleText, setScheduleText] = useState("");
  const [scheduleFile, setScheduleFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ScheduleProposal[] | null>(null);
  const [selectedProposals, setSelectedProposals] = useState<number[]>([]);
  const [proposalTargets, setProposalTargets] = useState<Record<number, string>>({});
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [importError, setImportError] = useState("");
  const [confirmationPhrase, setConfirmationPhrase] = useState("");

  const sortedCourses = useMemo(() => [...(courses ?? [])].sort((a, b) => {
    const aNext = nextClass(a);
    const bNext = nextClass(b);
    if (!aNext && !bNext) return a.name.localeCompare(b.name);
    if (!aNext) return 1;
    if (!bNext) return -1;
    return aNext.getTime() - bNext.getTime();
  }), [courses]);
  const courseById = useMemo(() => new Map((courses ?? []).map(course => [course.id, course])), [courses]);

  const startEditing = (course: Course) => {
    setEditCourse(course);
    setMeetingRows(course.meetings?.length ? course.meetings.map(meeting => ({ ...meeting, days: [...meeting.days] })) : [{ ...EMPTY_MEETING }]);
    setMeetingError("");
  };

  const saveMeetings = () => {
    if (!editCourse) return;
    const completed = meetingRows.filter(row => row.days.length > 0 || row.start || row.end || row.location);
    if (completed.some(row => !row.days.length || !row.start || !row.end || !row.type ||
      Number(row.end.replace(":", "")) <= Number(row.start.replace(":", "")))) {
      setMeetingError("Each meeting needs at least one day, a start time, and an end time after its start.");
      return;
    }
    updateCourse.mutate({ id: editCourse.id, data: { meetings: completed } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        toast({ title: "Class times saved", description: `${editCourse.name} is on your weekly schedule.` });
        setEditCourse(null);
      },
      onError: error => setMeetingError(errorMessage(error)),
    });
  };

  const startImport = () => {
    setPreview(null);
    setScheduleFile(null);
    setScheduleText("");
    setImportError("");
    setReplaceExisting(false);
    setConfirmationPhrase("");
    setImportOpen(true);
  };

  const previewSchedule = async () => {
    setImportError("");
    try {
      let text = scheduleText.trim();
      let mimeType: ScheduleImportInput["mimeType"] = null;
      let contentBase64: string | null = null;
      let filename: string | null = null;
      if (scheduleFile) {
        filename = scheduleFile.name;
        if (scheduleFile.size > 8 * 1024 * 1024) {
          setImportError("Schedule files must be no larger than 8 MB.");
          return;
        }
        const extension = scheduleFile.name.toLowerCase().split(".").pop();
        const inferredMime = extension === "pdf" ? "application/pdf"
          : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
            : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : null;
        const acceptedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
        mimeType = acceptedTypes.includes(scheduleFile.type as typeof acceptedTypes[number])
          ? scheduleFile.type as typeof acceptedTypes[number]
          : inferredMime as typeof acceptedTypes[number] | null;
        if (mimeType === "application/pdf" || mimeType?.startsWith("image/")) {
          const encoded = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Unable to read the selected file."));
            reader.onload = () => {
              const result = String(reader.result ?? "");
              resolve(result.slice(result.indexOf(",") + 1));
            };
            reader.readAsDataURL(scheduleFile);
          });
          contentBase64 = encoded;
        } else if (["txt", "csv", "ics"].includes(extension ?? "") || mimeType?.startsWith("text/")) {
          text = [text, await scheduleFile.text()].filter(Boolean).join("\n\n");
          mimeType = null;
        } else {
          setImportError("Choose a PDF, schedule image, calendar file, CSV, or text file.");
          return;
        }
      }
      if (!text && !contentBase64) {
        setImportError("Paste schedule details or choose a file first.");
        return;
      }
      const result = await previewImport.mutateAsync({ data: { text: text || undefined, filename, mimeType, contentBase64 } });
      setPreview(result.courses);
      const targets = Object.fromEntries(result.courses.map((proposal, index) => [
        index,
        proposal.courseId ?? (proposal.matchingCourses.length ? "" : "new"),
      ]));
      setProposalTargets(targets);
      setSelectedProposals(result.courses.flatMap((proposal, index) => {
        const target = targets[index];
        const match = proposal.matchingCourses.find(candidate => candidate.courseId === target);
        return target === "new" || (match?.ownerWritable && proposal.courseId === match.courseId) ? [index] : [];
      }));
    } catch (error) {
      setImportError(errorMessage(error));
    }
  };

  const applyImport = () => {
    if (!preview?.length || selectedProposals.length === 0) return;
    const selected = selectedProposals.map(index => ({
      proposal: preview[index],
      target: proposalTargets[index],
    })).filter((item): item is { proposal: ScheduleProposal; target: string } => Boolean(item.proposal));
    if (selected.some(item => !item.target)) {
      setImportError("Choose an existing course or explicitly create a new course for every ambiguous match.");
      return;
    }
    const containsExistingMeetings = selected.some(({ proposal, target }) =>
      proposal.matchingCourses.find(course => course.courseId === target)?.meetings.length ||
      (proposal.courseId === target ? proposal.existingMeetings.length : 0),
    );
    if (containsExistingMeetings && (!replaceExisting || confirmationPhrase !== "REPLACE")) {
      setImportError("Review the existing schedule warning and type REPLACE to confirm.");
      return;
    }
    const currentDate = new Date();
    const month = currentDate.getMonth();
    const season = month >= 7 ? "Fall" : month >= 4 ? "Summer" : "Spring";
    const term = courses?.[0]?.term || `${season} ${currentDate.getFullYear()}`;
    const payload = selected.map(({ proposal, target }, index) => {
      const existingMatch = proposal.matchingCourses.find(course => course.courseId === target);
      const existing = target !== "new" ? courseById.get(target) : undefined;
      return {
        courseId: target === "new" ? null : target,
        name: existing?.name ?? proposal.name,
        subject: existing?.subject ?? proposal.subject,
        term: existingMatch?.term ?? existing?.term ?? (proposal.term || term),
        color: existing?.color ?? COLORS[((courses?.length ?? 0) + index) % COLORS.length],
        meetings: proposal.meetings,
      };
    });
    setImportError("");
    confirmImport.mutate({ data: { courses: payload, replaceExisting } }, {
      onSuccess: result => {
        queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        setImportOpen(false);
        setPreview(null);
        toast({ title: "Schedule added", description: `${result.savedCount} course schedule${result.savedCount === 1 ? "" : "s"} saved.` });
      },
      onError: error => setImportError(errorMessage(error)),
    });
  };

  const toggleProposal = (index: number, checked: boolean) => {
    setSelectedProposals(current => checked ? [...new Set([...current, index])] : current.filter(item => item !== index));
  };
  const chooseTarget = (index: number, target: string) => {
    setProposalTargets(current => ({ ...current, [index]: target }));
    const proposal = preview?.[index];
    const chosenCourse = proposal?.matchingCourses.find(course => course.courseId === target);
    const canWrite = target === "new" || (target && chosenCourse?.ownerWritable);
    if (canWrite) setSelectedProposals(current => [...new Set([...current, index])]);
    else setSelectedProposals(current => current.filter(item => item !== index));
  };
  const courseForTarget = (proposal: ScheduleProposal, index: number) => {
    const target = proposalTargets[index];
    return proposal.matchingCourses.find(course => course.courseId === target) ??
      (proposal.courseId === target && proposal.existingName ? {
        courseId: proposal.courseId,
        name: proposal.existingName,
        subject: proposal.subject,
        term: proposal.existingTerm ?? "",
        meetings: proposal.existingMeetings,
        ownerWritable: proposal.ownerWritable,
      } : undefined);
  };

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col p-5 md:p-10">
      <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-primary">
            <CalendarDays className="h-4 w-4" /> Your week
          </p>
          <h1 className="font-serif text-3xl font-bold md:text-4xl">Class schedule</h1>
          <p className="mt-2 text-muted-foreground">See your next class at a glance, or set up recurring meeting times.</p>
        </div>
        <Button onClick={startImport}><Upload className="mr-2 h-4 w-4" /> Import schedule</Button>
      </header>

      {isLoading ? <div className="rounded-xl border p-8 text-muted-foreground">Loading your courses…</div> : isError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive">We couldn’t load your schedule. Refresh to try again.</div>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="next-classes-heading">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="next-classes-heading" className="font-serif text-2xl font-bold">Next classes</h2>
              <span className="text-sm text-muted-foreground">Ordered by upcoming class time</span>
            </div>
            {sortedCourses.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedCourses.map(course => {
                const next = nextClass(course);
                const meetings = course.meetings ?? [];
                return (
                  <Card key={course.id} className="overflow-hidden">
                    <div className="h-1.5" style={{ backgroundColor: course.color }} />
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-muted-foreground">{course.subject} · {course.term}</p>
                          <CardTitle className="mt-1 line-clamp-2 text-lg">{course.name}</CardTitle>
                        </div>
                        {course.isOwner && <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Edit ${course.name} times`} onClick={() => startEditing(course)}><Pencil className="h-4 w-4" /></Button>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {next ? <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
                        <Clock3 className="h-4 w-4 shrink-0" /> Next class · {describeNext(next)}
                      </div> : <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">No class times set</p>}
                      {meetings.length > 0 ? <div className="space-y-2">
                        {meetings.map((meeting, index) => (
                          <div key={`${meeting.start}-${meeting.days.join("")}-${index}`} className="text-sm">
                            <div className="flex items-center gap-2 font-medium"><CalendarDays className="h-4 w-4 text-muted-foreground" />{meetingSummary(meeting)}</div>
                            <div className="ml-6 text-xs text-muted-foreground">{meeting.type}{meeting.location ? ` · ${meeting.location}` : ""}</div>
                          </div>
                        ))}
                      </div> : course.isOwner ? <Button variant="outline" size="sm" onClick={() => startEditing(course)}><Plus className="mr-2 h-4 w-4" /> Add meeting times</Button> :
                        <p className="text-xs text-muted-foreground">Only the course owner can edit these shared class times.</p>}
                      {!course.isOwner && meetings.length > 0 && <p className="text-xs text-muted-foreground">Shared by the course owner.</p>}
                    </CardContent>
                  </Card>
                );
              })}
            </div> : <Card><CardContent className="py-12 text-center">
              <CalendarDays className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <p className="font-semibold">No courses on your schedule yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Add course times or import a schedule to see your week here.</p>
              <Button className="mt-5" onClick={startImport}>Import a schedule</Button>
            </CardContent></Card>}
          </section>

          <section aria-labelledby="week-heading">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="week-heading" className="font-serif text-2xl font-bold">Weekly overview</h2>
              <Link href="/courses"><Button variant="ghost" size="sm">All courses</Button></Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {DAYS.map(day => {
                const sessions = sortedCourses.flatMap(course => (course.meetings ?? [])
                  .filter(meeting => meeting.days.includes(day))
                  .map(meeting => ({ course, meeting })))
                  .sort((a, b) => a.meeting.start.localeCompare(b.meeting.start));
                return <Card key={day} className="min-h-36">
                  <CardHeader className="px-4 pb-2 pt-4"><CardTitle className="text-base">{DAY_LABELS[day]}</CardTitle></CardHeader>
                  <CardContent className="space-y-2 px-4 pb-4">
                    {sessions.length ? sessions.map(({ course, meeting }, index) => <div key={`${course.id}-${index}`} className="border-l-2 pl-2.5" style={{ borderColor: course.color }}>
                      <p className="text-xs font-semibold text-muted-foreground">{meeting.start}–{meeting.end}</p>
                      <p className="text-sm font-medium leading-snug">{course.subject}</p>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{course.name}</p>
                      {meeting.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{meeting.location}</p>}
                    </div>) : <p className="py-2 text-sm text-muted-foreground">Nothing scheduled</p>}
                  </CardContent>
                </Card>;
              })}
            </div>
          </section>
        </div>
      )}

      <Dialog open={Boolean(editCourse)} onOpenChange={open => !open && setEditCourse(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Class times {editCourse && `· ${editCourse.name}`}</DialogTitle>
            <DialogDescription>Set repeating meeting days, time, location, and class type. These shared times are visible to everyone in this course.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {meetingRows.map((meeting, index) => <div key={index} className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <Label className="mb-2 block">Meets on</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map(day => <Button key={day} type="button" size="sm" variant={meeting.days.includes(day) ? "default" : "outline"}
                    aria-pressed={meeting.days.includes(day)}
                    onClick={() => setMeetingRows(current => current.map((row, rowIndex) => rowIndex === index ? {
                      ...row, days: row.days.includes(day) ? row.days.filter(item => item !== day) : DAYS.filter(item => [...row.days, day].includes(item)),
                    } : row))}>{day}</Button>)}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><Label htmlFor={`meeting-start-${index}`}>Starts</Label><Input id={`meeting-start-${index}`} type="time" value={meeting.start} onChange={event => setMeetingRows(rows => rows.map((row, i) => i === index ? { ...row, start: event.target.value } : row))} /></div>
                <div><Label htmlFor={`meeting-end-${index}`}>Ends</Label><Input id={`meeting-end-${index}`} type="time" value={meeting.end} onChange={event => setMeetingRows(rows => rows.map((row, i) => i === index ? { ...row, end: event.target.value } : row))} /></div>
                <div><Label htmlFor={`meeting-type-${index}`}>Meeting type</Label><select id={`meeting-type-${index}`} className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={meeting.type} onChange={event => setMeetingRows(rows => rows.map((row, i) => i === index ? { ...row, type: event.target.value as CourseMeeting["type"] } : row))}>{TYPES.map(type => <option key={type}>{type}</option>)}</select></div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1"><Label htmlFor={`meeting-room-${index}`}>Location (optional)</Label><Input id={`meeting-room-${index}`} maxLength={160} placeholder="Science Hall 101" value={meeting.location} onChange={event => setMeetingRows(rows => rows.map((row, i) => i === index ? { ...row, location: event.target.value } : row))} /></div>
                {meetingRows.length > 1 && <Button type="button" variant="ghost" size="icon" className="mt-6" aria-label="Remove meeting" onClick={() => setMeetingRows(rows => rows.filter((_, i) => i !== index))}><X className="h-4 w-4" /></Button>}
              </div>
            </div>)}
            {meetingError && <p role="alert" className="text-sm text-destructive">{meetingError}</p>}
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setMeetingRows(rows => [...rows, { ...EMPTY_MEETING }])}><Plus className="mr-2 h-4 w-4" /> Add another meeting</Button>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditCourse(null)}>Cancel</Button>
                <Button type="button" onClick={saveMeetings} disabled={updateCourse.isPending}>{updateCourse.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save times</Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">To clear all times, remove each meeting row before saving.</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={open => { setImportOpen(open); if (!open) setPreview(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview ? "Review schedule import" : "Import your class schedule"}</DialogTitle>
            <DialogDescription>{preview
              ? "Nothing changes until you choose courses and confirm below. Existing class meetings are never replaced without a separate confirmation."
              : "Paste schedule text or upload a calendar/text export, PDF, or schedule image. ClassScribe will propose course meeting times for your review."}</DialogDescription>
          </DialogHeader>
          {!preview ? <div className="space-y-4">
            <div><Label htmlFor="schedule-text">Paste schedule text</Label><Textarea id="schedule-text" value={scheduleText} maxLength={30000} onChange={event => setScheduleText(event.target.value)} rows={6} placeholder={"BIO 101 · Intro Biology · Mon/Wed 9:00–9:50 · Science Hall 101\nCHEM 110 · General Chemistry · Tue/Thu 11:00–12:15"} /></div>
            <div className="rounded-xl border border-dashed p-4">
              <Label htmlFor="schedule-file" className="mb-2 flex items-center gap-2"><FileUp className="h-4 w-4" /> Optional schedule file (up to 8 MB)</Label>
              <Input id="schedule-file" type="file" accept=".ics,.txt,.csv,.pdf,.jpg,.jpeg,.png,.webp,text/plain,text/calendar,text/csv,application/pdf,image/jpeg,image/png,image/webp" onChange={event => setScheduleFile(event.target.files?.[0] ?? null)} />
              {scheduleFile && <p className="mt-2 text-xs text-muted-foreground">{scheduleFile.name} · {(scheduleFile.size / 1024 / 1024).toFixed(2)} MB</p>}
              <p className="mt-2 text-xs text-muted-foreground">Images and PDFs are analyzed securely on the server. File contents are used only to suggest class meetings.</p>
            </div>
            {importError && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{importError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setImportOpen(false)}>Cancel</Button>
              <Button onClick={previewSchedule} disabled={previewImport.isPending}>
                {previewImport.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {previewImport.isPending ? "Reading schedule…" : "Preview proposals"}
              </Button>
            </div>
          </div> : <div className="space-y-4">
            <div className="space-y-3">
              {preview.map((proposal, index) => {
                const selected = selectedProposals.includes(index);
                const target = proposalTargets[index] ?? "";
                const chosenCourse = courseForTarget(proposal, index);
                const targetWritable = target === "new" || Boolean(chosenCourse?.ownerWritable);
                return <div key={`${proposal.subject}-${index}`} className={`rounded-xl border p-4 ${selected ? "border-primary/40 bg-primary/[0.025]" : "bg-muted/20"}`}>
                  <div className="flex items-start gap-3">
                    <Checkbox id={`schedule-proposal-${index}`} checked={selected} disabled={!target || !targetWritable}
                      onCheckedChange={checked => toggleProposal(index, checked === true)} />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={`schedule-proposal-${index}`} className="cursor-pointer text-base font-semibold">{proposal.subject} · {proposal.name}</Label>
                      <p className="mt-1 text-xs text-muted-foreground">Proposed term: <span className="font-medium text-foreground">{proposal.term || "Not identified"}</span></p>
                      {proposal.matchingCourses.length > 0 && <div className="mt-3 space-y-3">
                        <Label htmlFor={`schedule-target-${index}`} className="block">Existing courses with this course code</Label>
                        <select id={`schedule-target-${index}`} value={target} onChange={event => chooseTarget(index, event.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                          <option value="">Choose an existing course or create a new one…</option>
                          <option value="new">Create a new course</option>
                          {proposal.matchingCourses.map(match => <option key={match.courseId} value={match.courseId}>{match.name} · {match.term}{match.ownerWritable ? "" : " · owner only"}</option>)}
                        </select>
                        {proposal.requiresExplicitMatchChoice && !target && <p className="text-xs font-medium text-amber-700">No existing course is preselected because its term could not be matched safely. Choose deliberately.</p>}
                        <div className="space-y-2">
                          {proposal.matchingCourses.map(match => <div key={match.courseId} className={`rounded-md border p-3 text-xs ${target === match.courseId ? "border-primary/50 bg-primary/5" : "bg-background"}`}>
                            <p className="font-semibold">{match.name} · {match.subject} · {match.term}{match.ownerWritable ? " · owner can edit" : " · owner-only edits"}</p>
                            {match.meetings.length ? <div className="mt-1.5 space-y-1">
                              {match.meetings.map((meeting, meetingIndex) => <p key={meetingIndex} className="text-muted-foreground">Existing: {meetingSummary(meeting)} · {meeting.type}{meeting.location ? ` · ${meeting.location}` : ""}</p>)}
                            </div> : <p className="mt-1 text-muted-foreground">Existing: no meetings yet</p>}
                          </div>)}
                        </div>
                      </div>}
                      {proposal.matchingCourses.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No existing course has this course code. A new course will be created for the proposed term.</p>}
                      {target === "new" && <p className="mt-2 text-xs font-medium">This proposal creates a new course for {proposal.term || "the current term"}.</p>}
                      {target && target !== "new" && chosenCourse && <p className="mt-2 text-xs font-medium text-primary">Selected existing course term: {chosenCourse.term}{proposal.term && normalize(proposal.term) !== normalize(chosenCourse.term) ? " (different from the proposed term)" : ""}</p>}
                      <div className="mt-3 rounded-md bg-primary/5 p-3">
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">Proposed meetings · {proposal.term || "term not identified"}</p>
                        <div className="space-y-1.5">{proposal.meetings.map((meeting, meetingIndex) => <p key={meetingIndex} className="text-sm">
                          <span className="font-medium">{meetingSummary(meeting)}</span><span className="text-muted-foreground"> · {meeting.type}{meeting.location ? ` · ${meeting.location}` : ""}</span>
                        </p>)}</div>
                      </div>
                      {!targetWritable && <p className="mt-2 text-xs text-amber-700">Only this course’s owner can apply these shared meeting changes. Choose “Create a new course” to keep a separate schedule.</p>}
                      {chosenCourse?.meetings.length ? <p className="mt-2 text-xs font-medium text-amber-700">Applying this choice replaces {chosenCourse.meetings.length} existing meeting{chosenCourse.meetings.length === 1 ? "" : "s"} for {chosenCourse.term}. Review both schedules above before confirming.</p> : null}
                    </div>
                  </div>
                </div>;
              })}
            </div>
            {selectedProposals.some(index => Boolean(courseForTarget(preview[index], index)?.meetings.length)) && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <label className="flex items-start gap-2"><Checkbox checked={replaceExisting} onCheckedChange={checked => setReplaceExisting(checked === true)} />
                <span>I reviewed the existing times above and intentionally want to replace them for selected courses.</span>
              </label>
              {replaceExisting && <Input aria-label="Type REPLACE to confirm" value={confirmationPhrase} onChange={event => setConfirmationPhrase(event.target.value)} placeholder="Type REPLACE to confirm" />}
            </div>}
            {importError && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{importError}</p>}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>Back</Button>
              <Button onClick={applyImport} disabled={confirmImport.isPending || !selectedProposals.length}>
                {confirmImport.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm {selectedProposals.length} selected
              </Button>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}