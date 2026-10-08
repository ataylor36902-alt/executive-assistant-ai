import { isRecord } from "./classscribe-legacy-access";

type Segment = { t: number; x: string };

// Scribe supplies the start of each word. Group those words into readable
// phrases, but use only the first provider-supplied word start for each phrase.
export function timedScribeSegments(result: unknown): Segment[] {
  if (!isRecord(result) || typeof result.text !== "string" || !Array.isArray(result.words)) {
    throw new Error("Transcription provider omitted timed words");
  }

  const segments: Segment[] = [];
  let text = "";
  let start: number | null = null;
  let count = 0;
  const flush = () => {
    if (start !== null && text.trim()) segments.push({ t: start, x: text.trim() });
    text = "";
    start = null;
    count = 0;
  };

  for (const entry of result.words) {
    if (!isRecord(entry) || typeof entry.text !== "string" ||
      !["word", "spacing", "audio_event"].includes(String(entry.type))) {
      throw new Error("Transcription provider returned invalid timed words");
    }
    if (entry.type === "spacing") {
      text += entry.text;
      continue;
    }
    if (!entry.text.trim()) continue;
    if (typeof entry.start !== "number" || !Number.isFinite(entry.start) || entry.start < 0) {
      throw new Error("Transcription provider omitted word timestamps");
    }
    if (start === null) start = entry.start;
    if (text && !/\s$/.test(text) && !/^\s|^[.,!?;:)\]]/.test(entry.text)) text += " ";
    text += entry.text;
    count += 1;
    if (/[.!?]["')\]]?$/.test(entry.text.trim()) || count >= 16) flush();
  }
  flush();
  if (result.text.trim() && !segments.length) {
    throw new Error("Transcription provider omitted word timestamps");
  }
  return segments;
}