const DATABASE_NAME = "classscribe-recordings";
const STORE_NAME = "recordings";
const DRAFT_STORE_NAME = "recording-drafts";
const DATABASE_VERSION = 2;

export interface RecordingDraft {
  draftId: string;
  blob: Blob;
  mimeType: string;
  courseId: string;
  title: string;
  professor: string;
  createdAt: string;
}

function openRecordingDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local audio storage is not available in this browser."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "lectureId" });
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE_NAME)) {
        database.createObjectStore(DRAFT_STORE_NAME, { keyPath: "draftId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local audio storage."));
    request.onblocked = () => reject(new Error("Local audio storage is blocked by another browser tab."));
  });
}

export async function saveRecordingDraft(draft: RecordingDraft): Promise<void> {
  const database = await openRecordingDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(DRAFT_STORE_NAME).put(draft);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save the recording draft locally."));
      transaction.onabort = () => reject(transaction.error || new Error("Saving the local recording draft was interrupted."));
    });
  } finally {
    database.close();
  }
}

export async function getRecordingDrafts(): Promise<RecordingDraft[]> {
  const database = await openRecordingDatabase();
  try {
    return await new Promise<RecordingDraft[]>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE_NAME, "readonly");
      const request = transaction.objectStore(DRAFT_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as RecordingDraft[]);
      request.onerror = () => reject(request.error || new Error("Could not read local recording drafts."));
    });
  } finally {
    database.close();
  }
}

export async function deleteRecordingDraft(draftId: string): Promise<void> {
  const database = await openRecordingDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
      transaction.objectStore(DRAFT_STORE_NAME).delete(draftId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not remove the local recording draft."));
      transaction.onabort = () => reject(transaction.error || new Error("Removing the local draft was interrupted."));
    });
  } finally {
    database.close();
  }
}

export async function attachDraftToLecture(draftId: string, lectureId: string): Promise<void> {
  const database = await openRecordingDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([STORE_NAME, DRAFT_STORE_NAME], "readwrite");
      const drafts = transaction.objectStore(DRAFT_STORE_NAME);
      const request = drafts.get(draftId);
      let found = false;
      request.onsuccess = () => {
        const draft = request.result as RecordingDraft | undefined;
        if (!draft) return;
        found = true;
        transaction.objectStore(STORE_NAME).put({
          lectureId,
          blob: draft.blob,
          mimeType: draft.mimeType
        });
        drafts.delete(draftId);
      };
      request.onerror = () => reject(request.error || new Error("Could not attach the local audio to its lecture."));
      transaction.oncomplete = () => found
        ? resolve()
        : reject(new Error("The local recording draft is no longer available."));
      transaction.onerror = () => reject(transaction.error || new Error("Could not attach the local audio to its lecture."));
      transaction.onabort = () => reject(transaction.error || new Error("Attaching the local recording was interrupted."));
    });
  } finally {
    database.close();
  }
}

export async function saveRecording(lectureId: string, blob: Blob): Promise<void> {
  const database = await openRecordingDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ lectureId, blob, mimeType: blob.type });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not save audio locally."));
      transaction.onabort = () => reject(transaction.error || new Error("Local audio storage was interrupted."));
    });
  } finally {
    database.close();
  }
}

export async function getRecording(lectureId: string): Promise<Blob | null> {
  const database = await openRecordingDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(lectureId);
      request.onsuccess = () => resolve((request.result?.blob as Blob | undefined) || null);
      request.onerror = () => reject(request.error || new Error("Could not read locally saved audio."));
    });
  } finally {
    database.close();
  }
}

export async function deleteRecording(lectureId: string): Promise<void> {
  const database = await openRecordingDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(lectureId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Could not remove local audio."));
      transaction.onabort = () => reject(transaction.error || new Error("Removing local audio was interrupted."));
    });
  } finally {
    database.close();
  }
}