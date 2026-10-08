const FRIENDLY_MESSAGES = {
  offerings: 'We couldn’t load subscription options. Please try again. If the problem continues, contact support.',
  purchase: 'The store couldn’t complete this purchase. Your current plan changes only after the library server confirms them. Please try again.',
  restore: 'Purchases couldn’t be restored. Your server-confirmed plan remains unchanged. Please try again.',
};

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

const SENSITIVE_PROPERTY = /api.?key|authorization|auth.?token|access.?token|refresh.?token|id.?token|token|secret|password|credential|cookie|session/i;
const TOKEN_PATTERNS = [
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{12,}\b/g,
  /\btest_[a-zA-Z0-9_-]{12,}\b/g,
  /\b(?:gh[pousr]_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,})\b/g,
  /\b(?:appl|goog)_[a-zA-Z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

function redactString(value) {
  const bearerRedacted = value.replace(/\b(Bearer\s+)(?!\[REDACTED\])[^\s"'`,;]+/gi, '$1[REDACTED]');
  const patternRedacted = TOKEN_PATTERNS.reduce((safe, pattern) => safe.replace(pattern, '[REDACTED]'), bearerRedacted);
  const configuredKeys = [
    process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY,
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  ];
  return configuredKeys.reduce((safe, key) =>
    typeof key === 'string' && key.length >= 8 ? safe.replaceAll(key, '[REDACTED]') : safe, patternRedacted);
}

export function redactRevenueCatError(error) {
  const visited = new WeakMap();
  const redact = (value, propertyName = '') => {
    if (SENSITIVE_PROPERTY.test(propertyName)) return '[REDACTED]';
    if (typeof value === 'string') return redactString(value);
    if (value == null || typeof value !== 'object') return value;
    if (visited.has(value)) return '[Circular]';
    const safe = Array.isArray(value) ? [] : {};
    visited.set(value, safe);
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) continue;
      safe[key] = redact(descriptor.value, key);
    }
    return safe;
  };
  return redact(error);
}

export function formatRevenueCatError(error, operation) {
  const safeError = redactRevenueCatError(error);
  const message = nonEmptyString(safeError?.message);
  const underlyingErrorMessage = nonEmptyString(safeError?.underlyingErrorMessage);
  const readableErrorCode = nonEmptyString(safeError?.readableErrorCode) ||
    (safeError?.code == null ? '' : String(safeError.code));
  return {
    friendlyMessage: FRIENDLY_MESSAGES[operation] || 'The in-app purchase service could not complete this request. Please try again.',
    underlyingErrorMessage,
    readableErrorCode,
    message,
  };
}

export function logRevenueCatError(operation, error) {
  const safeError = redactRevenueCatError(error);
  console.error(`RevenueCat ${operation} failed`, safeError);
  return formatRevenueCatError(error, operation);
}

export function canUseNativeRevenueCat({ platform, expoGo }) {
  return platform !== 'web' && !expoGo;
}