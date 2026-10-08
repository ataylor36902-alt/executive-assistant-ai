// Local persistence and server acknowledgement are separate confirmations.
export function createNoteSaver({ getLibrary, getRecord, applyRecord, persistLocal, writeRemote }) {
  const queues = new Map();
  function save(record, { libraryCode = getLibrary(), onLocalSaved } = {}) {
    if (!libraryCode || libraryCode !== getLibrary()) {
      return Promise.resolve({ localSaved: false, synced: false, error: new Error('Your library changed. Reopen the note in its original library.') });
    }
    const key = `${libraryCode}:${record.id}`;
    const { _pending, ...clean } = record;
    const pending = { ...clean, _pending: true };
    applyRecord(pending);
    // Persist every edit immediately, even if an older server request is slow.
    const local = persistLocal(libraryCode).then(() => {
      onLocalSaved?.();
      return { localSaved: true };
    }, error => ({ localSaved: false, synced: false, error }));
    const previous = queues.get(key) || Promise.resolve();
    const current = () => libraryCode === getLibrary() &&
      JSON.stringify(getRecord(record.id)) === JSON.stringify(pending);
    const request = previous.catch(() => {}).then(async () => {
      const result = await local;
      if (!result.localSaved) return result;
      if (!current()) return { localSaved: true, synced: false, superseded: true };
      try {
        await writeRemote(libraryCode, clean);
        if (current()) {
          applyRecord(clean);
          // The confirmed draft is already durable. A failed cleanup leaves a
          // harmless pending flag on disk, to be retried rather than lost.
          await persistLocal(libraryCode).catch(() => {});
        }
        return { localSaved: true, synced: true };
      } catch (error) {
        return { localSaved: true, synced: false, error };
      }
    });
    queues.set(key, request);
    request.finally(() => { if (queues.get(key) === request) queues.delete(key); }).catch(() => {});
    return request;
  }
  return { save, isBusy: (libraryCode, id) => queues.has(`${libraryCode}:${id}`) };
}

export function noteSaveMessage(state) {
  if (state.phase === 'saving') return 'Saving…';
  if (state.phase === 'syncing') return 'Saved on this phone · syncing…';
  if (state.phase === 'synced') return 'Saved and synced';
  if (state.phase === 'pending') return 'Saved on this phone · sync pending';
  if (state.phase === 'error') return 'Couldn’t save on this phone';
  if (state.phase === 'restored_pending') return 'Sync pending';
  return 'Autosave on';
}
