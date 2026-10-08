import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListCourseDatesQueryKey,
  getListLectureDatesQueryKey,
  useListCourseDates,
  useListLectureDates,
  useUpdateAcademicDate,
} from "@workspace/api-client-react";
import type { AcademicDate } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const escapeIcs = (value: string) => value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n")
  .replace(/,/g, "\\,").replace(/;/g, "\\;");

function downloadCalendar(items: AcademicDate[], filename: string) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events = items.map(item => {
    const day = item.dueDate!;
    const nextDay = new Date(`${day}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return [
      "BEGIN:VEVENT",
      `UID:${item.id}@classscribe`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${nextDay.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${escapeIcs(`${item.kind === "exam" ? "Exam" : "Assignment"}: ${item.title}`)}`,
      `DESCRIPTION:${escapeIcs(item.sourceText)}`,
      "END:VEVENT",
    ].join("\r\n");
  });
  const content = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClassScribe//Academic Dates//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function DateRow({ item, onSaved, selected, onSelect }: {
  item: AcademicDate;
  onSaved: () => void;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(item.title);
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const update = useUpdateAcademicDate();

  useEffect(() => {
    setTitle(item.title);
    setDueDate(item.dueDate ?? "");
  }, [item.title, item.dueDate]);

  const changed = title.trim() !== item.title || (dueDate || null) !== item.dueDate;
  const save = (confirm: boolean) => {
    update.mutate({
      id: item.id,
      data: { title: title.trim(), dueDate: dueDate || null, confirmed: confirm },
    }, {
      onSuccess: () => {
        onSaved();
        toast({ title: confirm ? "Date confirmed" : "Date saved" });
      },
      onError: () => toast({ title: "Could not save date", variant: "destructive" }),
    });
  };

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide font-bold text-primary">{item.kind}</span>
        <span className="text-xs text-muted-foreground">{item.confirmed ? "Confirmed" : "Needs review"}</span>
      </div>
      <div className="grid sm:grid-cols-[1fr_170px] gap-2">
        <Input aria-label={`${item.kind} title`} value={title} onChange={e => setTitle(e.target.value)} />
        <Input aria-label={`Date for ${item.title}`} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">From transcript: “{item.sourceText}”</p>
      <div className="flex gap-2 items-center">
        {(!item.confirmed || changed) && (
          <Button size="sm" disabled={update.isPending || !title.trim() || !dueDate}
            onClick={() => save(true)}>{item.confirmed ? "Save & confirm" : "Confirm date"}</Button>
        )}
        {item.confirmed && !changed && item.dueDate && (
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)} />
            Add to calendar export
          </label>
        )}
      </div>
    </div>
  );
}

export function AcademicDates({ courseId, lectureId }: { courseId?: string; lectureId?: string }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const courseQuery = useListCourseDates(courseId ?? "", {
    query: { queryKey: getListCourseDatesQueryKey(courseId ?? ""), enabled: !!courseId },
  });
  const lectureQuery = useListLectureDates(lectureId ?? "", {
    query: { queryKey: getListLectureDatesQueryKey(lectureId ?? ""), enabled: !!lectureId },
  });
  const items = courseId ? courseQuery.data : lectureQuery.data;
  const loading = courseId ? courseQuery.isLoading : lectureQuery.isLoading;
  const error = courseId ? courseQuery.isError : lectureQuery.isError;

  const refresh = () => {
    if (courseId) queryClient.invalidateQueries({ queryKey: getListCourseDatesQueryKey(courseId) });
    if (lectureId) queryClient.invalidateQueries({ queryKey: getListLectureDatesQueryKey(lectureId) });
  };
  const exportItems = (items ?? []).filter(item => selected.includes(item.id) && item.confirmed && item.dueDate);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold font-serif">Assignments & exams</h2>
        <p className="text-sm text-muted-foreground">
          Review dates extracted from lecture transcripts. Correct any mistakes before adding them to your calendar.
        </p>
      </div>
      {loading ? <p className="text-sm text-muted-foreground">Loading dates…</p> :
        error ? <p role="alert" className="text-sm text-destructive">Could not load dates. Please try again.</p> :
        items?.length ? (
          <>
            <div className="space-y-3">
              {items.map(item => (
                <DateRow key={item.id} item={item} onSaved={() => {
                  setSelected(current => current.filter(id => id !== item.id));
                  refresh();
                }} selected={selected.includes(item.id)}
                  onSelect={checked => setSelected(current => checked
                    ? [...current, item.id] : current.filter(id => id !== item.id))} />
              ))}
            </div>
            <Button disabled={!exportItems.length}
              onClick={() => downloadCalendar(exportItems, "classscribe-dates.ics")}>
              Download {exportItems.length} selected date{exportItems.length === 1 ? "" : "s"} for calendar
            </Button>
            <p className="text-xs text-muted-foreground">Open the downloaded .ics file in Apple Calendar, Outlook, Google Calendar, or another calendar app to import it. No dates are sent automatically.</p>
          </>
        ) : <p className="text-sm text-muted-foreground border rounded-lg p-5">No assignment or exam dates extracted yet. Analyze a lecture with a transcript to find them.</p>}
    </section>
  );
}