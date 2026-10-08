import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getCreditsStatus } from './api';

export function readCreditsStatus(value) {
  const validNumber = (number) => typeof number === 'number' && Number.isFinite(number);
  const currencyCode = value?.currencyCode || value?.currency?.code;
  if (
    !value ||
    !validNumber(value.balance) ||
    typeof currencyCode !== 'string' || !currencyCode.trim() ||
    value.currency && typeof value.currency.name !== 'string' ||
    !Array.isArray(value.packs) ||
    !value.costs ||
    !value.monthlyBonus ||
    !Array.isArray(value.history)
  ) {
    throw new Error('The server returned an invalid Credits response. Update ClassScribe and try again.');
  }
  for (const key of ['transcription10Minutes', 'savedRecording', 'studyGuide', 'askQuestion']) {
    if (!validNumber(value.costs[key])) throw new Error('The server returned invalid Credits costs. Try again later.');
  }
  if (!validNumber(value.monthlyBonus.student) || !validNumber(value.monthlyBonus.pro)) {
    throw new Error('The server returned invalid monthly Credits bonuses. Try again later.');
  }
  for (const pack of value.packs) {
    if (!pack || typeof pack.id !== 'string' || typeof pack.name !== 'string' || !validNumber(pack.credits) || !validNumber(pack.priceCents) || typeof pack.label !== 'string') {
      throw new Error('The server returned invalid Credits pack information. Try again later.');
    }
  }
  if (value.offeringIdentifier !== undefined && (typeof value.offeringIdentifier !== 'string' || !value.offeringIdentifier.trim())) {
    throw new Error('The server returned an invalid Credits store offering. Try again later.');
  }
  for (const entry of value.history) {
    if (!entry || typeof entry.id !== 'string' || typeof entry.date !== 'string' || !validNumber(entry.amount) || typeof entry.reason !== 'string' || typeof entry.source !== 'string') {
      throw new Error('The server returned invalid Credits history. Try again later.');
    }
  }
  return value;
}

export function creditsStatusError(reason) {
  if (reason?.status === 409) return 'Credits are temporarily paused for maintenance. Top-ups and credit use are unavailable right now.';
  if (reason?.status === 503) return 'Credits are temporarily unavailable during maintenance. Top-ups and credit use are unavailable right now.';
  return reason?.message || 'Your Credits could not be loaded. Try again.';
}

export function selectCreditsOffering(offerings, status) {
  const identifier = status?.offeringIdentifier || 'credits';
  const offering = offerings?.all?.[identifier];
  if (!offering) {
    throw new Error(`The Credits store offering "${identifier}" is unavailable. Credits packs cannot be purchased right now.`);
  }
  return offering;
}

export function useCreditsStatus(libraryCode) {
  const [status, setStatus] = useState(null);
  const [statusLibrary, setStatusLibrary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1;
    setStatus(null);
    setStatusLibrary(null);
    setError('');
    setLoading(true);
  }, [libraryCode]);

  const refresh = useCallback(async () => {
    if (!libraryCode) {
      setStatus(null);
      setError('Open a library to check your Credits balance.');
      setLoading(false);
      return null;
    }
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const next = readCreditsStatus(await getCreditsStatus(libraryCode));
      if (requestId.current === currentRequest) {
        setStatus(next);
        setStatusLibrary(libraryCode);
      }
      return next;
    } catch (reason) {
      if (requestId.current === currentRequest) {
        setStatus(null);
        setStatusLibrary(null);
         setError(creditsStatusError(reason));
      }
      return null;
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }, [libraryCode]);

  useFocusEffect(useCallback(() => {
    refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, 30_000);
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refresh();
    });
    return () => {
      requestId.current += 1;
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]));

  return { status: statusLibrary === libraryCode ? status : null, loading, error, refresh };
}