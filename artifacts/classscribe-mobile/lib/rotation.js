// The new code must be durable before the request: a committed migration may
// have a lost response, and the revoked old code cannot upload notes again.
export async function rotateWithRecovery({ storage, oldCode, createCode, uploadPending, rotate, activate }) {
  const saved = await storage.getItem('cs_rotation');
  let pending = null;
  try { pending = saved && JSON.parse(saved); } catch { /* propose a new code */ }
  let nextCode;
  if (pending?.old === oldCode && typeof pending.next === 'string') {
    nextCode = pending.next;
  } else {
    await uploadPending();
    nextCode = createCode();
    await storage.setItem('cs_rotation', JSON.stringify({ old: oldCode, next: nextCode }));
  }
  await rotate(nextCode);
  await activate(nextCode);
  await storage.removeItem('cs_rotation');
  return nextCode;
}