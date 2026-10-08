import { isRecord } from "./classscribe-legacy-access";
import type { Passage } from "./ask-retrieval";

type Row = { path: string; data: unknown };
const text = (v: unknown): string => typeof v === "string" ? v : "";
const privateRecord = (r: Record<string, unknown>, uid: string) =>
  !r.ex && !r.sharedCopy && !r.eduEnabled && !r.edu &&
  (r.by === undefined || r.by === uid);

// Accept only top-level records inside the verified private namespace. Shared
// classroom copies, imported peer records, and nested documents never qualify.
export function privatePassages(rows: Row[], uid: string, requested: string[]): Passage[] {
  const prefix = `data/users/${uid}/lib/`;
  const records = rows.flatMap(row => {
    if (!row.path.startsWith(prefix) || !isRecord(row.data) || !privateRecord(row.data, uid)) return [];
    const [collection, id, nested] = row.path.slice(prefix.length).split("/");
    if (!id || nested !== undefined || !["courses", "lectures", "notes", "assignments"].includes(collection)) return [];
    return [{ collection, id, data: row.data }];
  });
  const courses = new Set(records.filter(r => r.collection === "courses" && requested.includes(r.id)).map(r => r.id));
  const passages: Passage[] = [];
  for (const { collection, id, data } of records) {
    const courseId = text(data.courseId);
    if (!courses.has(courseId)) continue;
    const base = { id, courseId, title: text(data.title).slice(0, 300) };
    if (collection === "lectures") {
      for (const raw of [...(Array.isArray(data.segs) ? data.segs : []), ...(Array.isArray(data.slides) ? data.slides : [])]) {
        if (!isRecord(raw)) continue;
        const seconds = raw.t;
        // Preserve exact known seconds, including fractional values. Never
        // synthesize a time from untimed summary/analysis text.
        if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;
        const content = text(raw.x) || text(raw.text);
        if (content.trim()) passages.push({ ...base, kind: "lecture", text: content, seconds });
      }
    } else if (collection === "notes") {
      const content = text(data.body);
      if (content.trim()) passages.push({ ...base, kind: "note", text: content });
    } else if (collection === "assignments") {
      const content = [base.title, text(data.type), text(data.due), text(data.body), text(data.sourceText), text(data.description)].filter(Boolean).join("\n");
      if (content.trim()) passages.push({ ...base, kind: "assignment", text: content });
    }
  }
  return passages;
}
