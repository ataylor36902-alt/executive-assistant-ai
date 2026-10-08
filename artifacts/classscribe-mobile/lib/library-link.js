import { getServer, validSyncCode } from './api';
import { Platform } from 'react-native';

function trustedServer() {
  const configured = getServer();
  const official = Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : process.env.EXPO_PUBLIC_SERVER_URL;
  if (!official || !configured) throw new Error('Connect this device to the official ClassScribe server before using account sign-in.');
  let expected;
  let actual;
  try {
    expected = new URL(official);
    actual = new URL(configured);
  } catch {
    throw new Error('The ClassScribe server address is invalid.');
  }
  if (expected.protocol !== 'https:' || actual.origin !== expected.origin || actual.protocol !== 'https:') {
    throw new Error('Account sign-in requires the official secure ClassScribe server. Change the server address in Account first.');
  }
  return expected.origin;
}

async function requestLibraryLink(getToken, method, body) {
  const server = trustedServer();
  const token = await getToken({ skipCache: true });
  if (!token) throw new Error('Finish signing in, then try again.');
  let response;
  try {
    response = await fetch(`${server}/api/library-link`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new Error('Could not reach the ClassScribe server. Your library has not changed.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Could not connect this sign-in to your library.');
  return result;
}

export async function linkCurrentLibrary(getToken, code) {
  if (!validSyncCode(code)) throw new Error('This library has an invalid sync code.');
  return requestLibraryLink(getToken, 'POST', { code });
}

export async function getLinkedLibrary(getToken) {
  const result = await requestLibraryLink(getToken, 'GET');
  if (result.linked && !validSyncCode(result.code)) throw new Error('Your linked library could not be opened. Please use its sync code.');
  return result;
}