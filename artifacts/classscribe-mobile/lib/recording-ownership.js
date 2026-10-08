import { Directory, File, Paths } from 'expo-file-system';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';

// Keep metadata in documents even when Expo creates the audio in cache.
// Key by root-relative name: native sandbox prefixes can change between launches.
function recordingPath(uri) {
  const roots = [['document', Paths.document], ['cache', Paths.cache]];
  for (const [kind, path] of roots) {
    if (!path) continue;
    const root = new Directory(path).uri.replace(/\/+$/, '') + '/';
    if (!uri?.startsWith(root)) continue;
    const relative = uri.slice(root.length);
    // Expo Audio uses ExpoAudio on iOS and Audio on Android. Permit only
    // these immediate capture folders and the historical root layout.
    if (!/^(?:(?:ExpoAudio|Audio)\/)?[^/]+$/.test(relative)
      || relative.split('/').some((part) => part === '.' || part === '..')) continue;
    return `${kind}/${relative}`;
  }
  return null;
}

export function hasRecordingOwnershipPath(uri) {
  return recordingPath(uri) !== null;
}

export function recordingCaptureDirectories(path) {
  return [new Directory(path), new Directory(path, 'ExpoAudio'), new Directory(path, 'Audio')];
}

async function ownershipFile(uri) {
  const relative = recordingPath(uri);
  if (relative) {
    const key = await digestStringAsync(CryptoDigestAlgorithm.SHA256, relative);
    return new File(new Directory(Paths.document, 'recording-owners'), `${key}.json`);
  }
  throw new Error('The recording does not have a supported local storage path.');
}

export async function readRecordingOwner(uri) {
  const file = await ownershipFile(uri);
  if (!file.exists) return null; // Only absent metadata is genuinely legacy.
  const metadata = JSON.parse(await file.text());
  if (metadata?.version !== 1 || !/^[a-f0-9]{64}$/.test(metadata?.owner || '')) {
    throw new Error('Recording ownership metadata is damaged. No audio was changed.');
  }
  return metadata.owner;
}

export async function markRecordingOwner(uri, library) {
  if (!library) throw new Error('Open a library before recording.');
  const owner = await digestStringAsync(CryptoDigestAlgorithm.SHA256, library);
  const existing = await readRecordingOwner(uri);
  if (existing && existing !== owner) throw new Error('This recording belongs to a different library.');
  const file = await ownershipFile(uri);
  new Directory(Paths.document, 'recording-owners').create({ intermediates: true, idempotent: true });
  // Synchronous durable write and read-back must complete before recorder.record().
  file.write(JSON.stringify({ version: 1, owner }));
  if (await readRecordingOwner(uri) !== owner) throw new Error('Could not save recording ownership on this phone.');
}

export async function recoverableRootAudio(files, scopes, { allowLegacy = true } = {}) {
  const owners = new Set(scopes.map((uri) => new Directory(uri).name));
  const result = [];
  for (const file of files) {
    const owner = await readRecordingOwner(file.uri);
    if (owner ? owners.has(owner) : allowLegacy) result.push({ file, legacy: !owner });
  }
  return result;
}
