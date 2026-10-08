import { useState, useRef } from "react";
import { 
  useGetSyllabus, 
  usePreviewSyllabus,
  useConfirmSyllabus,
  getGetSyllabusQueryKey,
  getListCoursesQueryKey,
  useListCourses,
  getGetDashboardGlanceQueryKey,
  getListSyllabusAssignmentsQueryKey,
  getListSyllabusModulesQueryKey,
  SyllabusProposal,
  SyllabusModuleProposal,
  SyllabusAssignmentProposal,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FileUp, FileText, Download, Loader2, CheckSquare, Square, Save } from "lucide-react";
import { SyllabusAssignments } from "./SyllabusAssignments";

export function SyllabusTab({ courseId }: { courseId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: syllabus, isLoading: isSyllabusLoading, isError: isSyllabusError } = useGetSyllabus(courseId);
  const { data: courses } = useListCourses();
  const previewSyllabus = usePreviewSyllabus();
  const confirmSyllabus = useConfirmSyllabus();

  const [uploading, setUploading] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [preview, setPreview] = useState<{
    proposedName: string;
    proposedSubject: string;
    proposedTerm: string;
    dates: SyllabusProposal[];
    modules: SyllabusModuleProposal[];
    assignments: SyllabusAssignmentProposal[];
  } | null>(null);
  const [selectedDates, setSelectedDates] = useState<Set<number>>(new Set());
  const [selectedModules, setSelectedModules] = useState<Set<number>>(new Set());
  const [selectedAssignments, setSelectedAssignments] = useState<Set<number>>(new Set());
  
  // Edit state for metadata
  const [editMeta, setEditMeta] = useState<{name: string, subject: string, term: string} | null>(null);

  const hasSyllabus = Boolean(syllabus?.filename && syllabus?.uploadedAt);

  const uploadFile = async (file: File) => {
    if (!file.size || file.size > 10 * 1024 * 1024) {
      toast({ title: "Invalid file size", description: "Choose a file up to 10MB.", variant: "destructive" });
      return false;
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (!["pdf", "txt", "md", "csv"].includes(extension ?? "")) {
      toast({ title: "Unsupported file", description: "Choose a PDF, TXT, MD, or CSV syllabus.", variant: "destructive" });
      return false;
    }

    try {
      setUploading(true);
      
       const uploadMimeType = extension === "pdf" ? "application/pdf" : "text/plain";

       // The authenticated API stores the file using App Storage's server SDK.
       const uploadRes = await fetch(`/api/courses/${encodeURIComponent(courseId)}/syllabus/upload`, {
         method: "POST",
         credentials: "include",
        body: file,
        headers: {
           "Content-Type": uploadMimeType,
           "X-Filename": encodeURIComponent(file.name),
        }
      });

      if (!uploadRes.ok) {
         const details = await uploadRes.json().catch(() => null) as { error?: string } | null;
         throw new Error(details?.error || "Failed to upload file to storage");
      }

       // Review proposed course details and dates before changing the course.
      const previewData = await previewSyllabus.mutateAsync({ id: courseId });
      setPreview(previewData);
       const existing = courses?.find(course => course.id === courseId);
      setEditMeta({
         name: previewData.proposedName.trim() || existing?.name || "",
         subject: previewData.proposedSubject.trim() || existing?.subject || "",
         term: previewData.proposedTerm.trim() || existing?.term || "",
      });
       // Extracted dates stay unconfirmed until the student selects each one.
       setSelectedDates(new Set());
        setSelectedModules(new Set());
        setSelectedAssignments(new Set());
       return true;
    } catch (err: any) {
      console.error(err);
      toast({ title: "Upload failed", description: err.message || "An error occurred.", variant: "destructive" });
      return false;
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  };

  const handlePastedText = async () => {
    if (!pastedText.trim()) return;
    const file = new File([pastedText.trim()], "Pasted syllabus.txt", { type: "text/plain" });
    if (await uploadFile(file)) setPastedText("");
  };

  const handleConfirm = async () => {
    if (!preview || !editMeta) return;

    const finalDates = preview.dates.filter((_, i) => selectedDates.has(i));
    const finalModules = preview.modules.filter((_, i) => selectedModules.has(i));
    const finalAssignments = preview.assignments.filter((_, i) => selectedAssignments.has(i));
    if (!editMeta.name.trim() || finalDates.some(date => !date.title.trim() || !date.dueDate)) {
      toast({ title: "Review the selected dates", description: "Each selected item needs a title and a calendar date.", variant: "destructive" });
      return;
    }
    if (finalModules.some(module => !module.title.trim()) || finalAssignments.some(item => !item.title.trim())) {
      toast({ title: "Review the selected items", description: "Each selected module and coursework item needs a title.", variant: "destructive" });
      return;
    }

    try {
      const confirmed = await confirmSyllabus.mutateAsync({
        id: courseId,
        data: {
          name: editMeta.name,
          subject: editMeta.subject,
          term: editMeta.term,
          selectedDates: finalDates,
          selectedModules: finalModules,
          selectedAssignments: finalAssignments,
        }
      });
      
      queryClient.invalidateQueries({ queryKey: getGetSyllabusQueryKey(courseId) });
      queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDashboardGlanceQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSyllabusAssignmentsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSyllabusModulesQueryKey() });
      setPreview(null);
      const ambiguousCount = confirmed.dates.filter(date => date.linkStatus === "ambiguous").length;
      toast({
        title: "Syllabus confirmed",
        description: ambiguousCount
          ? `${ambiguousCount} confirmed ${ambiguousCount === 1 ? "date was" : "dates were"} saved separately because the title matched more than one date or coursework item. No due date was assigned to those items.`
          : "Reviewed modules, coursework and dates saved.",
      });
      
      // Remove query param if it exists
      const url = new URL(window.location.href);
      if (url.searchParams.has("importSyllabus")) {
        url.searchParams.delete("importSyllabus");
        window.history.replaceState({}, "", url.toString());
      }
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    }
  };

  const toggleDateSelection = (index: number) => {
    const next = new Set(selectedDates);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedDates(next);
  };
  const toggleSelection = (current: Set<number>, setter: (value: Set<number>) => void, index: number) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    setter(next);
  };

  if (isSyllabusLoading) {
    return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  }
  if (isSyllabusError) {
    return <p role="alert" className="p-8 text-center text-destructive">Could not load this course’s syllabus. Please refresh and try again.</p>;
  }

  if (preview && editMeta) {
    return (
      <div className="bg-card border border-primary/20 rounded-xl p-6 max-w-3xl mx-auto shadow-sm">
        <h2 className="text-xl font-bold font-serif mb-2">Review Syllabus Details</h2>
        <p className="text-muted-foreground text-sm mb-6">
           Review the proposed course details, modules, coursework and dates. Nothing is added until you select it and confirm.
        </p>

        <div className="space-y-4 mb-8 p-4 bg-muted/30 rounded-lg border border-border/50">
          <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Course Metadata</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Course Name</label>
              <Input 
                value={editMeta.name} 
                onChange={e => setEditMeta(prev => ({...prev!, name: e.target.value}))} 
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Subject</label>
              <Input 
                value={editMeta.subject} 
                onChange={e => setEditMeta(prev => ({...prev!, subject: e.target.value}))} 
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Term</label>
              <Input 
                value={editMeta.term} 
                onChange={e => setEditMeta(prev => ({...prev!, term: e.target.value}))} 
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 mb-8">
          <div className="flex justify-between gap-3">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Course modules</h3>
            <span className="text-xs text-muted-foreground">{selectedModules.size} of {preview.modules.length} selected</span>
          </div>
          {preview.modules.length ? preview.modules.map((module, i) => (
            <div key={i} className="flex items-start gap-3 border rounded-md p-3">
              <button type="button" aria-label={`${selectedModules.has(i) ? "Exclude" : "Include"} module ${module.title}`}
                aria-pressed={selectedModules.has(i)} className="mt-1 text-primary"
                onClick={() => toggleSelection(selectedModules, setSelectedModules, i)}>
                {selectedModules.has(i) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-muted-foreground" />}
              </button>
              <div className="flex-1 min-w-0 space-y-2">
                <Input aria-label={`Module ${i + 1} title`} value={module.title} onChange={e => setPreview(current => current && ({
                  ...current, modules: current.modules.map((m, index) => index === i ? { ...m, title: e.target.value } : m),
                }))} />
                <p className="text-xs italic text-muted-foreground">“{module.sourceText}”</p>
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">No modules found in this syllabus.</p>}
        </div>

        <div className="space-y-3 mb-8">
          <div className="flex justify-between gap-3">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Homework, readings, quizzes, exams & projects</h3>
            <span className="text-xs text-muted-foreground shrink-0">{selectedAssignments.size} of {preview.assignments.length} selected</span>
          </div>
          <p className="text-xs text-muted-foreground">Selecting coursework does not confirm its due date. To track a date, select the matching item below; its title must uniquely match one coursework title. Repeated matches are saved as standalone syllabus dates instead.</p>
          {preview.assignments.length ? preview.assignments.map((assignment, i) => (
            <div key={i} className="flex items-start gap-3 border rounded-md p-3">
              <button type="button" aria-label={`${selectedAssignments.has(i) ? "Exclude" : "Include"} ${assignment.title}`}
                aria-pressed={selectedAssignments.has(i)} className="mt-1 text-primary"
                onClick={() => toggleSelection(selectedAssignments, setSelectedAssignments, i)}>
                {selectedAssignments.has(i) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-muted-foreground" />}
              </button>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="grid sm:grid-cols-[1fr_130px] gap-2">
                  <Input aria-label={`Coursework ${i + 1} title`} value={assignment.title} onChange={e => setPreview(current => current && ({
                    ...current, assignments: current.assignments.map((a, index) => index === i ? { ...a, title: e.target.value } : a),
                  }))} />
                  <select className="h-10 rounded-md border bg-background px-2 text-sm" aria-label={`Type for ${assignment.title}`}
                    value={assignment.type} onChange={e => setPreview(current => current && ({
                      ...current, assignments: current.assignments.map((a, index) => index === i ? { ...a, type: e.target.value as SyllabusAssignmentProposal["type"] } : a),
                    }))}>
                    {["homework", "reading", "quiz", "exam", "project"].map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                {assignment.dueDate && <p className="text-xs text-muted-foreground">Proposed due date: {assignment.dueDate} — confirm or correct it in Dates to track below.</p>}
                <p className="text-xs italic text-muted-foreground">“{assignment.sourceText}”</p>
              </div>
            </div>
          )) : <p className="text-sm text-muted-foreground">No coursework found in this syllabus.</p>}
        </div>

        <div className="space-y-3 mb-8">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground">Dates to track</h3>
            <span className="text-xs text-muted-foreground font-medium">{selectedDates.size} of {preview.dates.length} selected</span>
          </div>
          
          {preview.dates.length > 0 ? (
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 border rounded-md divide-y divide-border">
              {preview.dates.map((d, i) => (
                 <div
                  key={i} 
                   className={`p-3 flex items-start gap-3 transition-colors ${selectedDates.has(i) ? 'bg-primary/5' : ''}`}
                >
                   <button type="button" aria-label={`${selectedDates.has(i) ? "Exclude" : "Include"} ${d.title}`}
                     aria-pressed={selectedDates.has(i)} onClick={() => toggleDateSelection(i)}
                     className="mt-0.5 text-primary shrink-0">
                    {selectedDates.has(i) ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-muted-foreground" />}
                   </button>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {d.kind}
                      </span>
                    </div>
                     <div className="grid sm:grid-cols-[1fr_170px] gap-2 mb-2">
                       <Input aria-label={`Title for ${d.kind} ${i + 1}`} value={d.title}
                         onChange={e => setPreview(current => current && ({
                           ...current, dates: current.dates.map((item, index) => index === i ? { ...item, title: e.target.value } : item)
                         }))} />
                       <Input type="date" aria-label={`Date for ${d.title}`} value={d.dueDate ?? ""}
                         onChange={e => setPreview(current => current && ({
                           ...current, dates: current.dates.map((item, index) => index === i ? { ...item, dueDate: e.target.value || null } : item)
                         }))} />
                     </div>
                    <div className="text-xs italic text-muted-foreground border-l-2 pl-2 line-clamp-2">
                      "...{d.sourceText}..."
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic bg-muted/30 p-4 rounded-md border text-center">
              No dates could be automatically extracted.
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => setPreview(null)} disabled={confirmSyllabus.isPending}>
            Cancel
          </Button>
           <Button onClick={handleConfirm} disabled={confirmSyllabus.isPending || !editMeta.name.trim()}>
            {confirmSyllabus.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Confirm & Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {(syllabus?.modules.length || syllabus?.assignments.length || syllabus?.dates.length) ? (
        <div className="max-w-2xl mx-auto mb-6 space-y-5">
          {Boolean(syllabus.modules.length) && <section className="border rounded-xl p-5 bg-card">
            <h3 className="font-serif font-bold text-lg mb-3">Course modules</h3>
            <ol className="list-decimal pl-5 space-y-1">{syllabus.modules.map(module => <li key={module.id}>{module.title}</li>)}</ol>
          </section>}
          {Boolean(syllabus.assignments.length) && <section className="border rounded-xl p-5 bg-card">
            <h3 className="font-serif font-bold text-lg mb-3">Syllabus coursework</h3>
            <p className="text-sm text-muted-foreground mb-3">Your check-offs are private to you.</p>
            <SyllabusAssignments items={syllabus.assignments} />
          </section>}
          {Boolean(syllabus.dates.length) && <section className="border rounded-xl p-5 bg-card">
            <h3 className="font-serif font-bold text-lg mb-3">Confirmed syllabus dates</h3>
            <p className="text-sm text-muted-foreground mb-3">These dates are tracked separately from coursework due dates. Only a unique match sets a coursework due date.</p>
            <ul className="space-y-2">
              {syllabus.dates.map(date => (
                <li key={date.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{date.title} · {date.dueDate}</span>
                    <span className="text-xs text-muted-foreground">
                      {date.linkStatus === "linked" ? "Linked to coursework" : "Standalone syllabus date"}
                    </span>
                  </div>
                  {date.linkStatus === "ambiguous" && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-1" role="status">
                      Title matches more than one date or coursework item. This date was not attached to coursework; no due date was set from it.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>}
        </div>
      ) : null}
      {hasSyllabus ? (
        <div className="bg-card border rounded-xl p-8 max-w-2xl mx-auto shadow-sm flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <FileText className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-bold font-serif mb-2">Syllabus Uploaded</h3>
          <p className="text-muted-foreground mb-6">
             Your confirmed syllabus details are available here. Replace it to review a new version.
          </p>
           <div className="flex gap-3">
            <Button asChild variant="outline">
              <a href={`/api/courses/${courseId}/syllabus/file`} download>
                <Download className="w-4 h-4 mr-2" /> Download Original
              </a>
            </Button>
            <div>
               <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.txt,.md,.csv" onChange={handleFileChange} />
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />}
                Replace Syllabus
              </Button>
            </div>
            </div>
            <div className="w-full mt-6 space-y-2 text-left">
             <label htmlFor="syllabus-paste-existing" className="text-sm font-medium">Or paste a replacement syllabus</label>
             <Textarea id="syllabus-paste-existing" value={pastedText} onChange={e => setPastedText(e.target.value)}
               placeholder="Paste syllabus text here…" rows={4} />
             <Button variant="outline" onClick={handlePastedText} disabled={uploading || !pastedText.trim()}>
               Import pasted text
             </Button>
          </div>
        </div>
      ) : (
        <div className="bg-card border border-dashed rounded-xl p-12 max-w-2xl mx-auto flex flex-col items-center text-center transition-colors hover:bg-muted/10">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <FileUp className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-bold font-serif mb-2">Upload Syllabus</h3>
          <p className="text-muted-foreground mb-6 max-w-md">
              Upload a PDF, TXT, MD, or CSV syllabus (up to 10MB), or paste its text to review course details, modules, coursework and dates.
          </p>
           <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.txt,.md,.csv" onChange={handleFileChange} />
          <Button size="lg" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              "Select File"
            )}
          </Button>
           <div className="w-full mt-6 space-y-2 text-left">
             <label htmlFor="syllabus-paste-new" className="text-sm font-medium">Or paste syllabus text</label>
             <Textarea id="syllabus-paste-new" value={pastedText} onChange={e => setPastedText(e.target.value)}
               placeholder="Paste syllabus text here…" rows={4} />
             <Button variant="outline" onClick={handlePastedText} disabled={uploading || !pastedText.trim()}>
               Import pasted text
             </Button>
           </div>
        </div>
      )}
    </div>
  );
}
