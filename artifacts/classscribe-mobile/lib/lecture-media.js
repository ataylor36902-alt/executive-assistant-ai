import { Directory, File, Paths } from 'expo-file-system';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { Platform } from 'react-native';

const WEB_AUDIO_DB = 'classscribe-audio-v1';
const WEB_AUDIO_STORE = 'lectures';

// Never place the bearer sync code itself in a filename or a synced audio URI.
export async function libraryAudioDirectory(code) {
  if (!code) throw new Error('Open a library before saving audio.');
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, code);
  return new Directory(Paths.document, 'lectures', 'by-library', digest);
}

export async function lectureStorageDirectory(code, lectureId) {
  if (!lectureId || !/^[\w-]+$/.test(lectureId)) throw new Error('Invalid recording ID.');
  return new Directory(await libraryAudioDirectory(code), lectureId);
}

// Copies a linked recording only; never claims an unlinked, ownerless file.
// Retain the source until all references (including pending confirmations) are updated.
export async function scopeLinkedLectureAudio(lecture, code, previousScopes = []) {
  if (!lecture?.audioUri || Platform.OS === 'web') return lecture;
  const folder = await lectureStorageDirectory(code, lecture.id);
  if (lecture.audioUri.startsWith(folder.uri.replace(/\/+$/, '') + '/')) return lecture;
  const scopedRoot = new Directory(Paths.document, 'lectures', 'by-library').uri.replace(/\/+$/, '') + '/';
  if (lecture.audioUri.startsWith(scopedRoot)
    && !previousScopes.some((root) => lecture.audioUri.startsWith(root.replace(/\/+$/, '') + '/'))) {
    return lecture;
  }
  const source = new File(lecture.audioUri);
  if (!source.exists || !source.size) return lecture;
  folder.create({ intermediates: true, idempotent: true });
  const destination = new File(folder, source.name);
  if (!destination.exists || destination.size !== source.size) await source.copy(destination, { overwrite: true });
  if (!destination.exists || destination.size !== source.size) throw new Error('Could not copy the linked recording to this library.');
  return { ...lecture, audioUri: destination.uri, audioName: destination.name,
    legacyAudioUri: lecture.legacyAudioUri || source.uri };
}

function openWebAudioDatabase() {
  if (typeof indexedDB === 'undefined') throw new Error('Durable browser audio storage is unavailable. Keep this page open and try saving again.');
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_AUDIO_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(WEB_AUDIO_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open durable browser audio storage.'));
    request.onblocked = () => reject(new Error('Browser audio storage is busy in another tab. Close the other ClassScribe tab and try saving again.'));
  });
}

function webAudioKey(uri) {
  const prefix = 'idb://classscribe-audio/';
  if (!uri?.startsWith(prefix)) return null;
  return decodeURIComponent(uri.slice(prefix.length));
}

export function webLectureAudioUri(lectureId) {
  return `idb://classscribe-audio/${encodeURIComponent(lectureId)}`;
}

export async function getDurableLectureAudioBlob(uri) {
  const key = webAudioKey(uri);
  if (!key) throw new Error('This is not a durable browser audio URI.');
  const database = await openWebAudioDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(WEB_AUDIO_STORE, 'readonly');
      const request = transaction.objectStore(WEB_AUDIO_STORE).get(key);
      request.onsuccess = () => {
        if (request.result instanceof Blob) resolve(request.result);
        else reject(new Error('The saved browser audio is missing. Re-record the lecture or restore this browser’s site data.'));
      };
      request.onerror = () => reject(request.error || new Error('Could not read the saved browser audio.'));
    });
  } finally {
    database.close();
  }
}

export async function removeDurableLectureAudio(uri) {
  const key = webAudioKey(uri);
  if (!key) return;
  const database = await openWebAudioDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(WEB_AUDIO_STORE, 'readwrite');
      transaction.objectStore(WEB_AUDIO_STORE).delete(key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not remove saved browser audio.'));
      transaction.onabort = () => reject(transaction.error || new Error('Removing browser audio was interrupted.'));
    });
  } finally {
    database.close();
  }
}

export async function resolveLectureAudioUri(uri) {
  if (!webAudioKey(uri)) return uri;
  const blob = await getDurableLectureAudioBlob(uri);
  return URL.createObjectURL(blob);
}

async function persistWebAudio(sourceUri, lectureId) {
  const response = await fetch(sourceUri);
  if (!response.ok) throw new Error('Could not read the browser recording before saving it.');
  const blob = await response.blob();
  if (!blob.size) throw new Error('The browser recording is empty and could not be saved.');
  const database = await openWebAudioDatabase();
  const key = lectureId;
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(WEB_AUDIO_STORE, 'readwrite');
      transaction.objectStore(WEB_AUDIO_STORE).put(blob, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not persist the browser recording.'));
      transaction.onabort = () => reject(transaction.error || new Error('Browser audio storage was interrupted.'));
    });
  } finally {
    database.close();
  }
  const extension = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  return { uri: webLectureAudioUri(lectureId), name: `lecture-${lectureId}.${extension}` };
}

export async function archiveLectureAudio(sourceUri, lectureId, code) {
  if (!sourceUri) return { uri: null, name: '' };
  if (Platform.OS === 'web' && sourceUri.startsWith('blob:')) {
    return persistWebAudio(sourceUri, lectureId);
  }
  const source = new File(sourceUri);
  if (!source.exists) throw new Error('The recording file is missing, so the audio could not be saved.');
  const folder = await lectureStorageDirectory(code, lectureId);
  folder.create({ intermediates: true, idempotent: true });
  const ext = (source.name.match(/\.[a-z0-9]+$/i) || ['.m4a'])[0].toLowerCase();
  const destination = new File(folder, `audio${ext}`);
  try {
    await source.move(destination, { overwrite: true });
  } catch (moveError) {
    try { await source.copy(destination, { overwrite: true }); } catch { throw moveError; }
  }
  if (!destination.exists) throw new Error('The recording could not be copied to permanent phone storage.');
  return { uri: destination.uri, name: destination.name };
}

export async function lectureAudioDirectory(lectureId, code) {
  const folder = await lectureStorageDirectory(code, lectureId);
  folder.create({ intermediates: true, idempotent: true });
  return folder;
}

export async function discardLectureAudioDirectory(lectureId, code) {
  const folder = await lectureStorageDirectory(code, lectureId);
  if (folder.exists) folder.delete();
}

export async function archiveLectureAudioPart(sourceUri, lectureId, index, code) {
  if (!sourceUri) throw new Error('A finished native audio recording has no local file URI.');
  const source = new File(sourceUri);
  const folder = await lectureAudioDirectory(lectureId, code);
  const name = `audio-part-${String(index + 1).padStart(3, '0')}.wav`;
  const destination = new File(folder, name);
  if (!source.exists && destination.exists) return { uri: destination.uri, name };
  if (!source.exists) throw new Error('A finished native audio part is missing from phone storage.');
  if (source.uri !== destination.uri) {
    try {
      await source.move(destination, { overwrite: true });
    } catch (moveError) {
      try { await source.copy(destination, { overwrite: true }); } catch { throw moveError; }
    }
  }
  if (!destination.exists) throw new Error(`Could not save audio part ${index + 1} to permanent phone storage.`);
  return { uri: destination.uri, name };
}

export function parseTranscriptText(input) {
  const text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  const toSeconds = (stamp) => {
    const parts = stamp.split(':').map(Number);
    return parts.reduce((total, part) => total * 60 + part, 0);
  };
  const blocks = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const segments = [];
  blocks.forEach((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length || /^WEBVTT(?:\s|$)/i.test(lines[0]) || /^NOTE(?:\s|$)/i.test(lines[0])) return;
    if (/^\d+$/.test(lines[0]) && lines.length > 1) lines.shift();
    const cueIndex = lines.findIndex((line) => /(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}\s*-->/.test(line));
    let timestamp = null;
    let content = lines;
    if (cueIndex >= 0) {
      const match = lines[cueIndex].match(/((?:\d{1,2}:)?\d{2}:\d{2})[,.]\d{3}\s*-->/);
      if (match) timestamp = toSeconds(match[1]);
      content = lines.slice(cueIndex + 1);
    } else {
      const first = lines[0].match(/^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s+(.*)$/);
      if (first) {
        timestamp = toSeconds(first[1]);
        content = [first[2], ...lines.slice(1)];
      }
    }
    const body = content.join(' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (body) segments.push({ t: timestamp == null ? (segments.length ? segments[segments.length - 1].t + 1 : index) : timestamp, s: 'P', x: body });
  });
  if (!segments.length) {
    return text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
      .map((line, index) => ({ t: index, s: 'P', x: line }));
  }
  return segments.sort((a, b) => a.t - b.t);
}