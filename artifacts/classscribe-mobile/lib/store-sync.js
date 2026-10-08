export const libraryCacheKey = (uid) => `cs_cache_v2_${uid}`;
export const libraryProfileKey = (uid) => `cs_profile_v2_${uid}`;
export const libraryDeletesKey = (uid) => `cs_pending_deletes_v2_${uid}`;
export const libraryPendingProfileKey = (uid) => `cs_pending_profile_v2_${uid}`;

export function isReplacedSyncCodeError(error) {
  return error?.code === 'not_granted' && error?.message === 'This sync code has been replaced';
}

export function collectPendingRecords(collections, localRecords, failedWrites = new Map()) {
  const pending = Object.fromEntries(collections.map((collection) => [collection, {}]));

  collections.forEach((collection) => {
    for (const record of Object.values(localRecords[collection] || {})) {
      if (record._pending) pending[collection][record.id] = record;
    }
  });

  for (const { col, obj } of failedWrites.values()) {
    if (pending[col] && obj?.id) pending[col][obj.id] = { ...obj, _pending: true };
  }

  return pending;
}

export function mergeRemoteRecords(collections, remoteResults, localRecords, pendingDeletes) {
  const merged = Object.fromEntries(collections.map((collection) => [collection, {}]));

  collections.forEach((collection, index) => {
    for (const document of remoteResults[index] || []) {
      if (!pendingDeletes[collection]?.[document.id]) {
        merged[collection][document.id] = { ...document.data, id: document.id };
      }
    }

    // A dirty local record is an offline edit, even when a stale version of
    // that record still exists remotely. Preserve it until its write succeeds.
    for (const record of Object.values(localRecords[collection] || {})) {
      if (record._pending) merged[collection][record.id] = record;
    }
  });

  return merged;
}

export async function syncPendingRecords(collections, records, write) {
  const written = [];
  const failed = [];

  for (const collection of collections) {
    for (const record of Object.values(records[collection] || {})) {
      if (!record._pending) continue;
      const { _pending, ...clean } = record;
      try {
        const result = await write(collection, record.id, clean);
        if (result === false) continue; // An editor already owns this pending write.
        written.push({ collection, id: record.id, original: record, clean });
      } catch (error) {
        failed.push({ collection, id: record.id, error });
      }
    }
  }

  return { written, failed };
}

export function applySyncedRecords(current, written) {
  const next = { ...current };

  for (const result of written) {
    const { collection, id, original, clean } = result;
    const currentRecord = current[collection]?.[id];
    if (!currentRecord?._pending || JSON.stringify(currentRecord) !== JSON.stringify(original)) continue;
    next[collection] = { ...next[collection], [id]: clean };
  }

  return next;
}