export function apiError(result, status) {
  const body = result && typeof result === 'object' ? result : {};
  const details = body.details && typeof body.details === 'object' ? body.details : {};
  return {
    ...body,
    code: body.code || 'unavailable',
    status,
    message: body.error || body.message || `Server error ${status}`,
    ...details,
  };
}

export function creditsOptInBody(body, requestId) {
  if (typeof requestId !== 'string' || !requestId.trim()) {
    throw { code: 'invalid_argument', message: 'The server did not provide a Credits request ID. No Credits were used.' };
  }
  return { ...body, useCredits: true, requestId };
}