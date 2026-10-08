import { useState, type FormEvent } from "react";
import { useAuth } from "@clerk/react";
import { eduBlob, fileBase64, type Assignment, type Submission } from "./api";

const TYPES: Record<string, string> = {
  "application/pdf": ".pdf", "text/plain": ".txt", "image/png": ".png", "image/jpeg": ".jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
};
const ACCEPT = Object.keys(TYPES).join(",") + "," + Object.values(TYPES).join(",");

export function SubmissionFile({ submission, base, assignmentId }: {
  submission: Submission; base: string; assignmentId: string;
}) {
  const { getToken } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!submission.filename) return null;
  async function download() {
    setBusy(true); setError("");
    try {
      const blob = await eduBlob(`${base}/assignments/${assignmentId}/submissions/${submission.id}/file`, getToken);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = submission.filename!;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not download the file."); }
    finally { setBusy(false); }
  }
  return <div style={{ marginTop: 12, overflowWrap: "anywhere" }}>
    <button type="button" className="button small" disabled={busy} onClick={() => void download()}
      data-testid={`button-download-submission-${submission.id}`}>
      {busy ? "Downloading…" : `Download ${submission.filename}`}
    </button>
    {error && <p className="notice" role="alert">{error}</p>}
  </div>;
}

export function SubmissionEditor({ assignment, base, api, saved, cancel }: {
  assignment: Assignment; base: string;
  api: <T>(path: string, method?: string, body?: unknown) => Promise<T>;
  saved: (submission: Submission | null, cleanupPending: boolean) => Promise<void>; cancel: () => void;
}) {
  const [text, setText] = useState(assignment.mySubmission?.text ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `${base}/assignments/${assignment.id}/submission`;
  const graded = assignment.mySubmission?.score != null;
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const body: Record<string, unknown> = { text: text.trim() };
      if (file) {
        if (!file.size || file.size > 10 * 1024 * 1024 || !TYPES[file.type] ||
          !file.name.toLowerCase().endsWith(TYPES[file.type])) {
          throw new Error("Choose a PDF, TXT, PNG, JPG, DOCX, or PPTX file no larger than 10 MB.");
        }
        body.attachment = { filename: file.name, mimeType: file.type, data: await fileBase64(file) };
      } else if (removeFile) body.attachment = null;
      if (!text.trim() && !file && !(assignment.mySubmission?.filename && !removeFile)) {
        throw new Error("Add a response or attach a file.");
      }
      const result = await api<{ submission: Submission; cleanupPending?: boolean }>(path, "POST", body);
      await saved(result.submission, !!result.cleanupPending);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your submission."); }
    finally { setBusy(false); }
  }
  async function removeSubmission() {
    if (!window.confirm("Delete your submission? Its response and attached file will be permanently removed.")) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ cleanupPending: boolean }>(path, "DELETE");
      await saved(null, result.cleanupPending);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete your submission."); }
    finally { setBusy(false); }
  }
  return <form className="fields" onSubmit={e => void save(e)}>
    {error && <div className="notice" role="alert">{error}</div>}
    <p className="small-muted">{assignment.instructions}</p>
    <p className="small-muted">Only you and your course instructor can download your file. You can update it until your work is graded.</p>
    {graded && <p className="notice">This submission has already been graded and cannot be changed.</p>}
    <label>Your response (optional with a file)<textarea name="text" value={text}
      onChange={e => setText(e.target.value)} disabled={busy || graded} maxLength={100000}
      data-testid="input-submission-text" style={{ minHeight: 180 }} /></label>
    {assignment.mySubmission?.filename && <>
      <SubmissionFile submission={assignment.mySubmission} base={base} assignmentId={assignment.id} />
      {!graded && <label><input type="checkbox" checked={removeFile} disabled={busy || !!file}
        onChange={e => setRemoveFile(e.target.checked)} data-testid="input-remove-submission-file" />
        Remove current file when saving</label>}
    </>}
    {!graded && <label>{assignment.mySubmission?.filename ? "Replace file" : "Attach a file"} · PDF, TXT, PNG, JPG, DOCX, PPTX · 10 MB max
      <input type="file" accept={ACCEPT} disabled={busy} data-testid="input-submission-file"
        onChange={e => { setFile(e.target.files?.[0] ?? null); setRemoveFile(false); }} />
    </label>}
    <div className="form-actions">
      <button className="button" type="button" disabled={busy} onClick={cancel}>Cancel</button>
      {assignment.mySubmission && !graded && <button className="button danger" type="button"
        disabled={busy} onClick={() => void removeSubmission()} data-testid="button-delete-submission">Delete submission</button>}
      {!graded && <button type="submit" className="button primary" disabled={busy}
        data-testid="button-send-submission">{busy ? "Saving…" : "Save submission"}</button>}
    </div>
  </form>;
}
