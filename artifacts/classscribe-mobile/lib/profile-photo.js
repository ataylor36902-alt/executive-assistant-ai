import { useCallback, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getServer, getUid } from './api';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

function photoUrl(server) {
  return `${server.replace(/\/+$/, '')}/api/profile-photo`;
}

function activeLibrary(uid, server = getServer()) {
  if (!uid || uid !== getUid()) throw new Error('The active library changed. Reopen Account and try again.');
  if (server !== getServer()) throw new Error('The server changed. Reopen Account and try again.');
  if (!server) throw new Error('Connect to the ClassScribe server in Account before using a profile photo.');
  return photoUrl(server);
}

async function changePhoto(uid, method, body, server = getServer()) {
  const url = activeLibrary(uid, server);
  let response;
  try {
    response = await (method === 'POST' && Platform.OS !== 'web' ? expoFetch : fetch)(url, {
      method,
      headers: { 'X-CS-User': uid, ...(body ? { 'Content-Type': 'image/jpeg' } : {}) },
      ...(body ? { body } : {}),
    });
  } catch {
    throw new Error('Could not reach the ClassScribe server. Check your connection and try again.');
  }
  const result = response.ok ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Could not update the profile photo. Please try again.');
  if (uid !== getUid() || server !== getServer()) throw new Error('The library connection changed. Reopen Account to see its photo.');
}

export async function uploadProfilePhoto(uid, asset, server = getServer()) {
  activeLibrary(uid, server);
  if (!asset?.uri || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    throw new Error('Choose a valid image from your photo library.');
  }
  // HEIC photos from iPhone are converted locally. Bound both axes without
  // stretching portrait images; the server validates the actual JPEG bytes.
  const resize = asset.width >= asset.height ? { width: Math.min(512, asset.width) } : { height: Math.min(512, asset.height) };
  const result = await manipulateAsync(asset.uri, [{ resize }], { format: SaveFormat.JPEG, compress: 0.84 });
  const file = Platform.OS === 'web' ? await (await fetch(result.uri)).blob() : new File(result.uri);
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo smaller than 3 MB.');
  await changePhoto(uid, 'POST', file, server);
}

export async function removeProfilePhoto(uid, server = getServer()) {
  await changePhoto(uid, 'DELETE', null, server);
}

export function useProfilePhoto(uid, server, revision = 0) {
  const scope = `${server || ''}|${uid || ''}|${revision}`;
  const [state, setState] = useState({ scope: '', source: null, error: '' });

  useFocusEffect(useCallback(() => {
    let active = true;
    let objectUrl = null;
    const controller = new AbortController();
    setState(previous => previous.scope === scope ? previous : { scope, source: null, error: '' });
    if (!server || !uid || uid !== getUid()) return () => { active = false; };

    const url = photoUrl(server);
    const isCurrent = () => active && uid === getUid() && server === getServer();
    let loading = false;
    const load = async () => {
      if (loading || !isCurrent()) return;
      loading = true;
      try {
        const response = await fetch(url, {
          headers: { 'X-CS-User': uid },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 404) {
          if (isCurrent()) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = null;
            setState({ scope, source: null, error: '' });
          }
          return;
        }
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          throw new Error(detail?.error || 'Could not load your profile photo.');
        }
        const blob = await response.blob();
        if (!blob.size || blob.size > MAX_PHOTO_BYTES || !['image/webp', 'image/jpeg', 'image/png'].includes(blob.type)) {
          throw new Error('The server returned an invalid profile photo. Choose another photo or try again.');
        }
        if (!isCurrent()) return;
        // Fetch private bytes once. A native Image URL would make a second
        // request and may persist authenticated content in the image cache.
        const uri = Platform.OS === 'web' ? URL.createObjectURL(blob) : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not display your profile photo.'));
          reader.readAsDataURL(blob);
        });
        if (!isCurrent()) {
          if (Platform.OS === 'web') URL.revokeObjectURL(uri);
          return;
        }
        const previousUrl = objectUrl;
        objectUrl = Platform.OS === 'web' ? uri : null;
        setState({ scope, source: { uri }, error: '' });
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      } catch (error) {
        if (isCurrent() && !controller.signal.aborted) setState({ scope, source: null, error: error?.message || 'Could not load your profile photo.' });
      } finally {
        loading = false;
      }
    };
    void load();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void load();
    });
    // Another device can replace/remove the photo while this screen is open.
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, 60_000);
    return () => {
      active = false;
      controller.abort();
      subscription.remove();
      clearInterval(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [scope, uid, server]));

  return state.scope === scope && uid === getUid() && server === getServer() ? state : { source: null, error: '' };
}