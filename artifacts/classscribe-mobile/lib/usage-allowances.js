export function usageAllowanceSummary(status) {
  if (!status) return null;
  const remaining = (used, limit) => typeof used === 'number' && Number.isFinite(used) &&
    typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(0, limit - used) : null;
  const hours = remaining(status.recordingHoursUsed, status.recordingHoursLimit);
  const recordings = remaining(status.recordingCountUsed, status.recordingCountLimit);
  const transcriptions = remaining(status.transcriptionCountUsed, status.transcriptionCountLimit);
  const exhausted = [];
  if (hours === 0) exhausted.push('transcription hours');
  if (recordings === 0) exhausted.push('saved recordings');
  if (transcriptions === 0) exhausted.push('transcriptions');
  return { hours, recordings, exhausted, paid: ['student', 'pro'].includes(status.plan) };
}
