import { useRef } from 'react';

// Keep a distinct identity for each observed session change, even A -> B -> A.
export function useLibraryLinkSession({ isSignedIn, userId, sessionId }) {
  const current = useRef(null);
  if (!current.current || current.current.isSignedIn !== isSignedIn ||
      current.current.userId !== userId || current.current.sessionId !== sessionId) {
    current.current = { isSignedIn, userId, sessionId };
  }

  return () => {
    const started = current.current;
    return () => {
      if (!started.isSignedIn || !started.userId || !started.sessionId || current.current !== started) {
        throw new Error('Your signed-in account changed. Your library has not changed. Try again with the account you want to use.');
      }
    };
  };
}
