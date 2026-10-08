import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getBillingStatus, refreshRevenueCatBilling } from './api';
import { isRevenueCatRenewalStatus } from './renewal-copy';

const PLANS = new Set(['free', 'student', 'pro']);
const BILLING_SOURCES = new Set(['web', 'app_store', 'play_store', 'test_store', null]);

export function readBillingStatus(value) {
  if (
    !value ||
    !PLANS.has(value.plan) ||
    typeof value.status !== 'string' ||
    typeof value.recordingHoursLimit !== 'number' ||
    !Number.isFinite(value.recordingHoursLimit) ||
    (value.recordingHoursUsed != null && (typeof value.recordingHoursUsed !== 'number' || !Number.isFinite(value.recordingHoursUsed))) ||
    typeof value.recordingCountUsed !== 'number' ||
    !Number.isInteger(value.recordingCountUsed) ||
    value.recordingCountUsed < 0 ||
    typeof value.recordingCountLimit !== 'number' ||
    !Number.isInteger(value.recordingCountLimit) ||
    value.recordingCountLimit < 1 ||
    typeof value.transcriptionCountUsed !== 'number' ||
    !Number.isInteger(value.transcriptionCountUsed) ||
    value.transcriptionCountUsed < 0 ||
    typeof value.transcriptionCountLimit !== 'number' ||
    !Number.isInteger(value.transcriptionCountLimit) ||
    value.transcriptionCountLimit < 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'courseLimit') ||
    (value.courseLimit !== null && (typeof value.courseLimit !== 'number' || !Number.isFinite(value.courseLimit))) ||
    (Object.prototype.hasOwnProperty.call(value, 'billingSource') && !BILLING_SOURCES.has(value.billingSource)) ||
    (Object.prototype.hasOwnProperty.call(value, 'billingConflict') && typeof value.billingConflict !== 'boolean') ||
    (Object.prototype.hasOwnProperty.call(value, 'renewalStatus') && value.renewalStatus !== null && !isRevenueCatRenewalStatus(value.renewalStatus))
  ) {
    throw new Error('The server returned an invalid plan status. Update ClassScribe and try again.');
  }
  return value;
}

export function useBillingStatus(libraryCode) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1;
    setStatus(null);
    setError('');
    setLoading(true);
  }, [libraryCode]);

  const refresh = useCallback(async ({ forceRefresh = false } = {}) => {
    if (!libraryCode) {
      setStatus(null);
      setError('Open a library to check its plan.');
      setLoading(false);
      return;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const next = readBillingStatus(await getBillingStatus(libraryCode, { forceRefresh }));
      if (requestId.current === currentRequest) setStatus(next);
      return next;
    } catch (reason) {
      if (requestId.current === currentRequest) {
        setStatus(null);
        setError(reason?.message || 'Your plan could not be loaded. Try again.');
      }
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [libraryCode]);

  const refreshFromRevenueCat = useCallback(async () => {
    if (!libraryCode) {
      const reason = { code: 'no_library', message: 'Open a library to verify its subscription.' };
      setError(reason.message);
      setLoading(false);
      throw reason;
    }

    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const next = readBillingStatus(await refreshRevenueCatBilling(libraryCode));
      if (requestId.current === currentRequest) setStatus(next);
      return next;
    } catch (reason) {
      if (requestId.current === currentRequest) {
        setError(reason?.message || 'The server could not verify your in-app subscription. Try again.');
      }
      throw reason;
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [libraryCode]);

  useFocusEffect(useCallback(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refresh();
    });
    return () => {
      requestId.current += 1;
      subscription.remove();
    };
  }, [refresh]));

  return { status, loading, error, refresh, refreshFromRevenueCat };
}

export function planName(plan) {
  return ({ free: 'Free', student: 'Student', pro: 'Pro' })[plan] || 'Unknown';
}

export function billingStatusLabel(status) {
  return ({
    active: 'Active',
    trialing: 'Trial',
    past_due: 'Payment needs attention',
    unpaid: 'Payment needed',
    canceled: 'Canceled',
    cancelled: 'Canceled',
    incomplete: 'Not active',
    incomplete_expired: 'Not active',
    free: 'Free plan',
  })[status] || status;
}

export function formatBillingDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}